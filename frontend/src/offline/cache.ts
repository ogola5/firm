/**
 * Local copies of server data used while offline.
 *
 * Caches are refreshed in the background after an online sign-in and whenever
 * a screen loads data online. Locally created records (offline reports) are
 * never overwritten by a refresh until the server has acknowledged them.
 */
import { db } from "../db";
import { api } from "./api";

type Row = Record<string, unknown> & { id: string };

async function putPreservingLocal(rows: Row[]) {
  const local = await db.faults.filter((row) => Boolean(row.offline_pending)).primaryKeys();
  const pending = new Set(local);
  await db.faults.bulkPut(rows.filter((row) => !pending.has(row.id)));
}

export async function cacheEquipment(rows: Row[]) {
  await db.equipment.bulkPut(rows);
}

export async function cacheFaults(rows: Row[]) {
  await putPreservingLocal(rows);
}

export async function cacheFaultContext(id: string, context: Record<string, unknown>) {
  await db.faultContexts.put({ id, context, cached_at: new Date().toISOString() });
}

export async function cachedFaultContext(id: string) {
  return db.faultContexts.get(id);
}

/** Pulls the datasets a user needs offline. Each part fails independently. */
export async function refreshOfflineCache(permissions: string[]): Promise<{ refreshed: string[]; failed: string[] }> {
  const jobs: Array<[string, () => Promise<void>]> = [];
  if (permissions.includes("equipment.read")) {
    jobs.push(["equipment", async () => cacheEquipment(await api<Row[]>("/api/v1/equipment"))]);
  }
  if (permissions.includes("faults.read")) {
    jobs.push(["faults", async () => cacheFaults(await api<Row[]>("/api/v1/faults"))]);
  }
  if (permissions.includes("knowledge.read")) {
    jobs.push(["knowledge", async () => {
      await db.knowledge.bulkPut(await api<Row[]>("/api/v1/knowledge"));
    }]);
    jobs.push(["procedures", async () => {
      const library = await api<Row[] | { procedures?: Row[] }>("/api/v1/procedure-updates/library");
      await db.procedures.bulkPut(Array.isArray(library) ? library : library.procedures ?? []);
    }]);
  }
  const outcomes = await Promise.allSettled(jobs.map(([, job]) => job()));
  const refreshed = jobs.filter((_, index) => outcomes[index].status === "fulfilled").map(([name]) => name);
  const failed = jobs.filter((_, index) => outcomes[index].status === "rejected").map(([name]) => name);
  await db.syncMeta.put({ key: "cache_refreshed_at", value: new Date().toISOString() });
  return { refreshed, failed };
}

/** Indexed local equipment search: tag prefix via the index, then name/station text match. */
export async function searchCachedEquipment(query: string, section?: string, limit = 25): Promise<Row[]> {
  const term = query.trim().toLowerCase();
  const scoped = (row: Row) => !section || row.section === section;
  if (!term) return (await db.equipment.limit(limit * 4).toArray()).filter(scoped).slice(0, limit);
  const byTag = await db.equipment.where("tag").startsWithIgnoreCase(term).limit(limit).toArray();
  const seen = new Set(byTag.map((row) => row.id));
  const remaining = limit - byTag.length;
  const byText = remaining > 0
    ? await db.equipment
      .filter((row) => !seen.has(row.id) && [row.name, row.station, row.category, row.location]
        .some((value) => String(value ?? "").toLowerCase().includes(term)))
      .limit(remaining)
      .toArray()
    : [];
  return [...byTag, ...byText].filter(scoped);
}
