import Dexie, { type Table } from "dexie";

export interface PendingEvent {
  event_id: string;
  fault_id?: string;
  event_type: string;
  actor_id: string;
  client_timestamp: string;
  sequence_number: number;
  sync_status: "PENDING" | "SYNCED" | "FAILED";
  payload: Record<string, unknown>;
}

class KpcDatabase extends Dexie {
  equipment!: Table<{ id: string; tag: string; name: string; station: string; category: string; section: string }, string>;
  faults!: Table<Record<string, unknown>, string>;
  knowledge!: Table<Record<string, unknown>, string>;
  pendingEvents!: Table<PendingEvent, string>;

  constructor() {
    super("kpcMaintenance");
    this.version(1).stores({
      equipment: "id,tag,name,station,category",
      faults: "id,reference,equipment_id,status",
      knowledge: "id,reference,status,symptom",
      pendingEvents: "event_id, sync_status, fault_id",
    });
  }
}

export const db = new KpcDatabase();
