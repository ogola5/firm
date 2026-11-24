import Dexie, { type Table } from "dexie";

/** Outbox status of an event recorded on this device. */
export type LocalSyncStatus = "PENDING" | "SYNCED" | "CONFLICT" | "REJECTED" | "RESOLVED";

export type OfflineEventType =
  | "FAULT_REPORTED"
  | "FAULT_ACTION"
  | "DIAGNOSIS_RECORDED"
  | "INTERVENTION_RECORDED"
  | "OPERATOR_UPDATE";

export interface PendingEvent {
  event_id: string;
  fault_id?: string;
  event_type: OfflineEventType | string;
  actor_id: string;
  device_id: string;
  client_timestamp: string;
  sequence_number: number;
  base_status?: string;
  sync_status: LocalSyncStatus;
  payload: Record<string, unknown>;
  attempts?: number;
  server_status?: string;
  server_detail?: string;
  server_result?: Record<string, unknown>;
  acknowledged_at?: string;
}

export interface PendingAttachment {
  id: string;
  fault_id: string;
  actor_id: string;
  name: string;
  type: string;
  blob: Blob;
  status: "PENDING" | "UPLOADED" | "FAILED";
  detail?: string;
  created_at: string;
}

export interface OfflineSession {
  username: string;
  salt: string;
  verifier: string;
  iterations: number;
  user: Record<string, unknown>;
  token: string;
  token_expires_at: string | null;
  verified_online_at: string;
}

export interface SyncLogEntry {
  id?: number;
  at: string;
  trigger: string;
  outcome: "SYNCED" | "NOTHING_TO_SYNC" | "UNREACHABLE" | "AUTH_REQUIRED" | "ERROR";
  sent: number;
  applied: number;
  conflicts: number;
  rejected: number;
  duplicates: number;
  detail?: string;
}

type Row = Record<string, unknown>;

class KpcDatabase extends Dexie {
  equipment!: Table<Row & { id: string }, string>;
  faults!: Table<Row & { id: string }, string>;
  faultContexts!: Table<{ id: string; context: Row; cached_at: string }, string>;
  knowledge!: Table<Row & { id: string }, string>;
  procedures!: Table<Row & { id: string }, string>;
  notifications!: Table<Row & { id: string }, string>;
  pendingEvents!: Table<PendingEvent, string>;
  pendingAttachments!: Table<PendingAttachment, string>;
  syncMeta!: Table<{ key: string; value: unknown }, string>;
  syncLog!: Table<SyncLogEntry, number>;
  offlineSessions!: Table<OfflineSession, string>;

  constructor() {
    super("kpcMaintenance");
    this.version(1).stores({
      equipment: "id,tag,name,station,category",
      faults: "id,reference,equipment_id,status",
      knowledge: "id,reference,status,symptom",
      pendingEvents: "event_id, sync_status, fault_id",
    });
    this.version(2)
      .stores({
        equipment: "id,tag,name,station,category,section",
        faults: "id,reference,equipment_id,status,assigned_section,created_at",
        faultContexts: "id",
        knowledge: "id,reference,status,symptom,source_type",
        procedures: "id,reference,status,section",
        notifications: "id,created_at,read",
        pendingEvents: "event_id,sync_status,fault_id,sequence_number,actor_id",
        pendingAttachments: "id,fault_id,status",
        syncMeta: "key",
        syncLog: "++id,at",
        offlineSessions: "username",
      })
      .upgrade((tx) =>
        tx.table("pendingEvents").toCollection().modify((event: PendingEvent) => {
          event.device_id ??= "";
          event.sequence_number ??= 0;
        }),
      );
  }
}

export const db = new KpcDatabase();
