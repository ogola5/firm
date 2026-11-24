/**
 * Measurement hooks for the performance report (frontend/e2e/performance.spec.ts).
 *
 * Attached to `window.__kpcPerf` only when localStorage["kpc-perf"] === "1", so
 * normal sessions never expose it. Each function times the app's own offline
 * code path (Dexie queries and the outbox), not a re-implementation.
 */
import { db } from "../db";
import { cachedFaultContext, searchCachedEquipment } from "./cache";
import { enqueue } from "./outbox";

const PROBE_ACTOR = "PERF-PROBE"; // never the signed-in user, so probe events are never synchronised

async function timed<T>(work: () => Promise<T>): Promise<{ ms: number; result: T }> {
  const start = performance.now();
  const result = await work();
  return { ms: performance.now() - start, result };
}

export const perfProbe = {
  /** Adds synthetic equipment rows (tag PERF-xxxxx) to the device cache. */
  async seedEquipment(count: number) {
    const rows = Array.from({ length: count }, (_, index) => ({
      id: `PERF-EQ-${index}`,
      tag: `PERF-${String(index).padStart(5, "0")}`,
      name: `Synthetic perf asset ${index}`,
      station: ["PS01", "PS02", "DEPOT01"][index % 3],
      category: "Perf",
      section: "Electrical",
      location: `Synthetic bay ${index % 40}`,
    }));
    await db.equipment.bulkPut(rows);
    return db.equipment.count();
  },
  async clearSeed() {
    await db.equipment.where("tag").startsWith("PERF-").delete();
    await db.pendingEvents.where("actor_id").equals(PROBE_ACTOR).delete();
  },
  async searchEquipment(query: string) {
    const { ms, result } = await timed(() => searchCachedEquipment(query));
    return { ms, count: result.length };
  },
  async faultHistory(faultId: string) {
    const { ms, result } = await timed(() => cachedFaultContext(faultId));
    return { ms, found: Boolean(result) };
  },
  async persistEvent() {
    const { ms } = await timed(() => enqueue({
      eventType: "OPERATOR_UPDATE", actorId: PROBE_ACTOR, faultId: "PERF-FAULT", payload: { note: "perf probe" },
    }));
    return { ms };
  },
  async cachedFaultIds() {
    return db.faultContexts.toCollection().primaryKeys();
  },
};

export function attachPerfProbe() {
  if (typeof window !== "undefined" && localStorage.getItem("kpc-perf") === "1") {
    (window as unknown as { __kpcPerf: typeof perfProbe }).__kpcPerf = perfProbe;
  }
}
