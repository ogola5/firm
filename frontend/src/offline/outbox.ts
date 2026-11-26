/**
 * Durable local event outbox.
 *
 * Every offline change is written to IndexedDB first, with a client-generated
 * event id (the server's idempotency key), this device's id and a per-device
 * sequence number (the server applies events in this order). The local cache
 * is then updated optimistically so the user sees their own work immediately;
 * the server remains authoritative and its acknowledgement replaces it.
 */
import { db, type OfflineEventType, type PendingEvent } from "../db";

type Row = Record<string, unknown>;

const listeners = new Set<() => void>();
export function subscribeOutbox(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
function notify() {
  listeners.forEach((listener) => listener());
}

const uuid = () => crypto.randomUUID();
const nowIso = () => new Date().toISOString();

export async function deviceId(): Promise<string> {
  const existing = await db.syncMeta.get("device_id");
  if (existing) return String(existing.value);
  const created = `DEVICE-${uuid().slice(0, 8).toUpperCase()}`;
  await db.syncMeta.put({ key: "device_id", value: created });
  return created;
}

export async function enqueue(input: {
  eventType: OfflineEventType;
  actorId: string;
  faultId?: string;
  payload: Row;
  baseStatus?: string;
}): Promise<PendingEvent> {
  const device = await deviceId();
  const event = await db.transaction("rw", db.pendingEvents, db.syncMeta, async () => {
    const counter = await db.syncMeta.get("sequence");
    const sequence = Number(counter?.value ?? 0) + 1;
    await db.syncMeta.put({ key: "sequence", value: sequence });
    const created: PendingEvent = {
      event_id: uuid(),
      fault_id: input.faultId,
      event_type: input.eventType,
      actor_id: input.actorId,
      device_id: device,
      client_timestamp: nowIso(),
      sequence_number: sequence,
      base_status: input.baseStatus,
      sync_status: "PENDING",
      payload: input.payload,
      attempts: 0,
    };
    await db.pendingEvents.put(created);
    return created;
  });
  notify();
  return event;
}

export async function pendingFor(actorId: string): Promise<PendingEvent[]> {
  const rows = await db.pendingEvents.where("sync_status").equals("PENDING").toArray();
  return rows.filter((row) => row.actor_id === actorId).sort((a, b) => a.sequence_number - b.sequence_number);
}

export async function outboxCounts(actorId?: string): Promise<{ pending: number; conflicts: number; rejected: number }> {
  const all = await db.pendingEvents.toArray();
  const mine = actorId ? all.filter((row) => row.actor_id === actorId) : all;
  return {
    pending: mine.filter((row) => row.sync_status === "PENDING").length,
    conflicts: mine.filter((row) => row.sync_status === "CONFLICT").length,
    rejected: mine.filter((row) => row.sync_status === "REJECTED").length,
  };
}

export type ServerEventResult = {
  event_id: string;
  status: "APPLIED" | "DUPLICATE" | "CONFLICT" | "REJECTED" | string;
  stored_status?: string;
  detail?: string;
  result?: Row;
};

function localStatus(result: ServerEventResult): PendingEvent["sync_status"] {
  const status = result.status === "DUPLICATE" ? result.stored_status ?? "APPLIED" : result.status;
  if (status === "APPLIED") return "SYNCED";
  if (status === "CONFLICT") return "CONFLICT";
  if (status === "REJECTED") return "REJECTED";
  if (status.startsWith("RESOLVED")) return "RESOLVED";
  return "SYNCED";
}

/** Records the server's acknowledgement of each event. */
export async function applyServerResults(results: ServerEventResult[]): Promise<void> {
  await db.transaction("rw", db.pendingEvents, db.faults, async () => {
    for (const result of results) {
      const event = await db.pendingEvents.get(result.event_id);
      if (!event) continue;
      const status = localStatus(result);
      await db.pendingEvents.put({
        ...event,
        sync_status: status,
        server_status: result.status === "DUPLICATE" ? result.stored_status : result.status,
        server_detail: result.detail ?? "",
        server_result: result.result ?? {},
        acknowledged_at: nowIso(),
      });
      // An offline-reported fault receives its official reference from the server.
      if (event.event_type === "FAULT_REPORTED" && status === "SYNCED" && event.fault_id && result.result) {
        const local = await db.faults.get(event.fault_id);
        if (local) {
          await db.faults.put({
            ...local,
            reference: result.result.reference ?? local.reference,
            status: result.result.status ?? local.status,
            offline_pending: false,
          });
        }
      }
    }
  });
  notify();
}

export async function markEventResolved(eventId: string, serverStatus: string): Promise<void> {
  const event = await db.pendingEvents.get(eventId);
  if (event) {
    await db.pendingEvents.put({ ...event, sync_status: "RESOLVED", server_status: serverStatus, acknowledged_at: nowIso() });
    notify();
  }
}

export async function incrementAttempts(events: PendingEvent[]): Promise<void> {
  await db.pendingEvents.bulkPut(events.map((event) => ({ ...event, attempts: (event.attempts ?? 0) + 1 })));
}

/* ---------- Optimistic local mirror ---------- */

const ACTION_STATUS: Record<string, string> = {
  acknowledge: "ACKNOWLEDGED",
  on_site: "ON_SITE",
  diagnose: "DIAGNOSED",
  restore: "RESTORED", // working again at once; the Chief Technician checks the write-up later
};

async function currentLocalStatus(faultId: string): Promise<string | undefined> {
  const cachedContext = await db.faultContexts.get(faultId);
  const fromContext = (cachedContext?.context?.fault as Row | undefined)?.status;
  if (fromContext) return String(fromContext);
  const summary = await db.faults.get(faultId);
  return summary?.status ? String(summary.status) : undefined;
}

async function updateLocalFault(faultId: string, changes: Row, contextChanges?: (context: Row) => Row) {
  const summary = await db.faults.get(faultId);
  if (summary) await db.faults.put({ ...summary, ...changes });
  const cached = await db.faultContexts.get(faultId);
  if (cached) {
    let context: Row = { ...cached.context, fault: { ...(cached.context.fault as Row), ...changes } };
    if (contextChanges) context = contextChanges(context);
    await db.faultContexts.put({ ...cached, context });
  }
}

export async function queueFaultReport(actor: { id: string; display_name?: string }, payload: Row, extra: Row = {}) {
  const faultId = uuid();
  const event = await enqueue({ eventType: "FAULT_REPORTED", actorId: actor.id, faultId, payload });
  await db.faults.put({
    id: faultId,
    reference: "Pending sync",
    status: "PENDING_SYNC",
    symptom: payload.symptom,
    severity: payload.severity,
    equipment_id: payload.equipment_id ?? null,
    equipment_tag: extra.equipment_tag ?? payload.reported_equipment_text ?? "Asset not identified",
    assigned_section: payload.send_to || extra.section || "Systems Automation",
    reporter_id: actor.id,
    created_at: event.client_timestamp,
    offline_pending: true,
  });
  return { faultId, event };
}

export async function queueFaultAction(actorId: string, faultId: string, action: string) {
  const baseStatus = await currentLocalStatus(faultId);
  const event = await enqueue({ eventType: "FAULT_ACTION", actorId, faultId, payload: { action }, baseStatus });
  if (ACTION_STATUS[action]) {
    await updateLocalFault(faultId, { status: ACTION_STATUS[action] }, action === "acknowledge"
      ? (context) => ({
        ...context,
        assignments: ((context.assignments as Row[]) ?? []).map((item) => (
          item.is_active ? { ...item, assigned_user_id: actorId, status: "ACKNOWLEDGED", pending_sync: true } : item
        )),
      })
      : undefined);
  }
  return event;
}

const pendingRow = (event: PendingEvent, row: Row): Row => ({
  ...row,
  created_at: event.client_timestamp,
  pending_sync: true,
  sync_event_id: event.event_id,
});

export async function queueDiagnosis(actor: { id: string; display_name?: string }, faultId: string, diagnosis: Row) {
  const diagnosisId = uuid();
  const event = await enqueue({
    eventType: "DIAGNOSIS_RECORDED", actorId: actor.id, faultId,
    payload: { ...diagnosis, diagnosis_id: diagnosisId },
  });
  await updateLocalFault(faultId, { status: "DIAGNOSED" }, (context) => ({
    ...context,
    diagnoses: [
      ...((context.diagnoses as Row[]) ?? []),
      pendingRow(event, { ...diagnosis, id: diagnosisId, author_name: actor.display_name ?? "You", verification_status: "UNVERIFIED" }),
    ],
  }));
  return { diagnosisId, event };
}

export async function queueIntervention(actor: { id: string; display_name?: string }, faultId: string, intervention: Row) {
  const interventionId = uuid();
  const event = await enqueue({
    eventType: "INTERVENTION_RECORDED", actorId: actor.id, faultId,
    payload: { ...intervention, intervention_id: interventionId },
  });
  await updateLocalFault(faultId, {}, (context) => ({
    ...context,
    interventions: [
      ...((context.interventions as Row[]) ?? []),
      pendingRow(event, { ...intervention, id: interventionId, actor_name: actor.display_name ?? "You" }),
    ],
  }));
  return { interventionId, event };
}

export async function queueOperatorUpdate(actor: { id: string; display_name?: string }, faultId: string, note: string) {
  const event = await enqueue({ eventType: "OPERATOR_UPDATE", actorId: actor.id, faultId, payload: { note } });
  await updateLocalFault(faultId, {}, (context) => ({
    ...context,
    operator_updates: [
      ...((context.operator_updates as Row[]) ?? []),
      pendingRow(event, { note, actor_name: actor.display_name ?? "You" }),
    ],
  }));
  return event;
}

/** A whole site visit written up offline; the server applies it with the same rules. */
export async function queueVisit(actor: { id: string }, faultId: string, visit: Row & { request_signoff?: boolean }) {
  const event = await enqueue({ eventType: "VISIT_RECORDED", actorId: actor.id, faultId, payload: visit });
  await updateLocalFault(faultId, { status: visit.request_signoff ? "RESTORED" : "DIAGNOSED", visit_pending_sync: true });
  return event;
}

export async function queueAttachment(actorId: string, faultId: string, file: File) {
  await db.pendingAttachments.put({
    id: uuid(),
    fault_id: faultId,
    actor_id: actorId,
    name: file.name,
    type: file.type,
    blob: file,
    status: "PENDING",
    created_at: nowIso(),
  });
  notify();
}
