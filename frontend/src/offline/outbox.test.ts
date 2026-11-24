import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../db";
import {
  applyServerResults, deviceId, enqueue, outboxCounts, pendingFor, queueDiagnosis, queueFaultAction, queueFaultReport,
} from "./outbox";

const actor = { id: "USER-automation", display_name: "Demo Automation" };

beforeEach(async () => {
  await db.delete();
  await db.open();
});

describe("event outbox", () => {
  it("persists events with unique ids, a stable device id and increasing sequence numbers", async () => {
    const first = await enqueue({ eventType: "OPERATOR_UPDATE", actorId: actor.id, faultId: "F1", payload: { note: "a" } });
    const second = await enqueue({ eventType: "OPERATOR_UPDATE", actorId: actor.id, faultId: "F1", payload: { note: "b" } });
    expect(first.event_id).not.toBe(second.event_id);
    expect(second.sequence_number).toBe(first.sequence_number + 1);
    expect(first.device_id).toBe(await deviceId());
    expect(first.device_id).toMatch(/^DEVICE-/);
    expect((await pendingFor(actor.id)).map((event) => event.payload.note)).toEqual(["a", "b"]);
    expect(await pendingFor("someone-else")).toEqual([]);
  });

  it("shows an offline report immediately and adopts the server reference once acknowledged", async () => {
    const { faultId, event } = await queueFaultReport(actor, { symptom: "Valve stuck", severity: "High", operational_impact: "Delay" });
    expect((await db.faults.get(faultId))?.reference).toBe("Pending sync");
    await applyServerResults([{ event_id: event.event_id, status: "APPLIED", result: { id: faultId, reference: "KPC-DMO-00999", status: "ASSIGNED" } }]);
    const fault = await db.faults.get(faultId);
    expect(fault?.reference).toBe("KPC-DMO-00999");
    expect(fault?.offline_pending).toBe(false);
    expect((await db.pendingEvents.get(event.event_id))?.sync_status).toBe("SYNCED");
  });

  it("records the status the user saw as base_status and advances the local status", async () => {
    await db.faults.put({ id: "F2", status: "ASSIGNED" });
    const acknowledge = await queueFaultAction(actor.id, "F2", "acknowledge");
    const onSite = await queueFaultAction(actor.id, "F2", "on_site");
    expect(acknowledge.base_status).toBe("ASSIGNED");
    expect(onSite.base_status).toBe("ACKNOWLEDGED");
    expect((await db.faults.get("F2"))?.status).toBe("ON_SITE");
  });

  it("adds a pending diagnosis to the cached investigation with a client id", async () => {
    await db.faultContexts.put({ id: "F3", context: { fault: { id: "F3", status: "ON_SITE" }, diagnoses: [] }, cached_at: "" });
    const { diagnosisId, event } = await queueDiagnosis(actor, "F3", { possible_cause: "Loose terminal", diagnostic_method: "Inspection" });
    expect(event.payload.diagnosis_id).toBe(diagnosisId);
    const context = (await db.faultContexts.get("F3"))!.context as { fault: { status: string }; diagnoses: Array<Record<string, unknown>> };
    expect(context.fault.status).toBe("DIAGNOSED");
    expect(context.diagnoses[0]).toMatchObject({ id: diagnosisId, pending_sync: true });
  });

  it("maps duplicates to their stored outcome and keeps conflicts for reconciliation", async () => {
    const applied = await enqueue({ eventType: "OPERATOR_UPDATE", actorId: actor.id, faultId: "F4", payload: {} });
    const conflict = await enqueue({ eventType: "FAULT_ACTION", actorId: actor.id, faultId: "F4", payload: {} });
    const rejected = await enqueue({ eventType: "FAULT_ACTION", actorId: actor.id, faultId: "F4", payload: {} });
    await applyServerResults([
      { event_id: applied.event_id, status: "DUPLICATE", stored_status: "APPLIED" },
      { event_id: conflict.event_id, status: "CONFLICT", detail: "moved" },
      { event_id: rejected.event_id, status: "REJECTED", detail: "no permission" },
    ]);
    expect(await outboxCounts(actor.id)).toEqual({ pending: 0, conflicts: 1, rejected: 1 });
    expect((await db.pendingEvents.get(conflict.event_id))?.server_detail).toBe("moved");
  });
});
