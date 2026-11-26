import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { can, type User } from "../../auth";
import { spokenTime } from "../../lib/format";
import { db } from "../../db";
import { similarFaults, type Case, type CaseIndex } from "../../lib/similarity";
import { api, isOfflineError } from "../../offline/api";
import { cachedFaultContext } from "../../offline/cache";

type Answer = { similar: Similar[]; note: string; offline_from?: string };

/** No connection: rank from the case index saved on this device, with the server's own rules. */
async function similarOffline(faultId: string, limit: number): Promise<Answer | null> {
  const index = (await db.syncMeta.get("case_index"))?.value as CaseIndex | undefined;
  if (!index?.cases?.length) return null;
  let target: Case | undefined = index.cases.find((item) => item.id === faultId);
  if (!target) {
    // A fault this device has not indexed yet (e.g. reported offline): build it from the local copies.
    const fault = ((await cachedFaultContext(faultId))?.context?.fault ?? (await db.faults.get(faultId))) as Record<string, unknown> | undefined;
    if (!fault) return null;
    const equipment = fault.equipment_id ? await db.equipment.get(String(fault.equipment_id)) : undefined;
    const tag = String(equipment?.tag ?? fault.equipment_tag ?? "");
    target = {
      id: faultId, reference: String(fault.reference ?? ""), equipment_id: equipment ? String(equipment.id) : null, equipment_tag: tag,
      equipment_name: String(equipment?.name ?? ""), equipment_type: (tag.toUpperCase().match(/[A-Z]+/g) ?? [""])[0] ?? "",
      system_id: equipment?.system_id ? String(equipment.system_id) : null, system_name: "", category: String(fault.category ?? ""),
      symptom: String(fault.symptom ?? ""), description: String(fault.description ?? ""),
      reported_at: String(fault.created_at ?? new Date().toISOString()), causes: [], worked: [], did_not_work: [],
    };
  }
  return { similar: similarFaults(target, index, limit), note: "Similar is not the same cause. Check before you act.", offline_from: index.generated_at };
}


type Similar = {
  fault_id: string; reference: string; equipment_tag: string; equipment_name: string; reported_at: string; symptom: string;
  causes: string[]; worked: string[]; did_not_work: string[]; score: number; reasons: string[];
};

export function canSeeSimilar(user: User): boolean {
  return can(user, "similar.view");
}

/**
 * Earlier faults most like this one, each with the reasons it ranked.
 * Online: computed by the server over every earlier fault. Offline: the same rules, on this device, from the saved case index.
 */
export function SimilarFaults({ user, faultId, compact = false }: { user: User; faultId: string; compact?: boolean }) {
  const query = useQuery({
    queryKey: ["fault", faultId, "similar"],
    enabled: canSeeSimilar(user),
    retry: false,
    queryFn: async (): Promise<Answer> => {
      const limit = compact ? 3 : 5;
      try {
        return await api<Answer>(`/api/v1/intelligence/similar-faults?fault_id=${encodeURIComponent(faultId)}&limit=${limit}`);
      } catch (reason) {
        const local = isOfflineError(reason) ? await similarOffline(faultId, limit) : null;
        if (local) return local;
        throw reason;
      }
    },
  });
  if (!canSeeSimilar(user)) return null;

  return (
    <section aria-label="Similar earlier faults" className="grid content-start gap-3 rounded-xl border border-border bg-card p-5 text-sm">
      <div>
        <h2 className="m-0 text-base">Similar earlier faults</h2>
        <p className="m-0 text-xs text-muted-foreground">{query.data?.note ?? "Similar is not the same cause. Check before you act."}</p>
      </div>
      {query.isLoading && <p className="m-0 text-muted-foreground">Looking…</p>}
      {query.isError && <p className="m-0 text-muted-foreground">Not on this device yet. Open the app once while connected and it will work offline too.</p>}
      {query.data?.offline_from && (
        <p className="m-0 rounded-md bg-warning/10 px-2 py-1 text-xs">Offline: ranked on this phone from the copy saved {spokenTime(query.data.offline_from)}.</p>
      )}
      {query.data && !query.data.similar.length && <p className="m-0 text-muted-foreground">Nothing similar enough in earlier records.</p>}
      {query.data?.similar.map((item) => (
        <div key={item.fault_id} className="grid gap-1 border-b border-border pb-3 last:border-0 last:pb-0">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <Link to={`/faults?mode=history&fault=${encodeURIComponent(item.fault_id)}`} className="font-bold text-foreground">
              {item.equipment_tag} · {spokenTime(item.reported_at).replace(/ \d\d:\d\d$/, "")}
            </Link>
            <span className="text-xs text-muted-foreground">{item.reference}</span>
          </div>
          <span className="text-muted-foreground">{item.reasons.join(" · ")}</span>
          {item.causes.length > 0 && <span><strong>Cause found:</strong> {item.causes.join("; ")}</span>}
          {item.worked.map((action, index) => <span key={`w${index}`} className="text-success">Worked: {action}</span>)}
          {item.did_not_work.map((action, index) => <span key={`f${index}`} className="text-destructive">Didn't work: {action}</span>)}
        </div>
      ))}
    </section>
  );
}
