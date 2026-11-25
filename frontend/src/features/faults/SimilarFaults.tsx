import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { type User } from "../../auth";
import { spokenTime } from "../../lib/format";
import { api } from "../../offline/api";

// Mirrors the roles allowed by GET /api/v1/intelligence/similar-faults.
const ALLOWED = [
  "systems_automation", "technician_st", "technician_pt", "technician_ct", "assistant_engineer", "engineer",
  "senior_engineer", "chief_engineer", "maintenance_manager", "general_manager_om", "supervisor", "system_administrator",
];

type Similar = {
  fault_id: string; reference: string; equipment_tag: string; equipment_name: string; reported_at: string; symptom: string;
  causes: string[]; worked: string[]; did_not_work: string[]; score: number; reasons: string[];
};

export function canSeeSimilar(user: User): boolean {
  return ALLOWED.includes(user.role);
}

/**
 * Earlier faults most like this one, each with the reasons it ranked.
 * Needs the server: similarity is computed over every earlier fault, not the offline cache.
 */
export function SimilarFaults({ user, faultId, compact = false }: { user: User; faultId: string; compact?: boolean }) {
  const query = useQuery({
    queryKey: ["fault", faultId, "similar"],
    enabled: canSeeSimilar(user),
    retry: false,
    queryFn: () => api<{ similar: Similar[]; note: string }>(`/api/v1/intelligence/similar-faults?fault_id=${encodeURIComponent(faultId)}&limit=${compact ? 3 : 5}`),
  });
  if (!canSeeSimilar(user)) return null;

  return (
    <section aria-label="Similar earlier faults" className="grid content-start gap-3 rounded-xl border border-border bg-card p-5 text-sm">
      <div>
        <h2 className="m-0 text-base">Similar earlier faults</h2>
        <p className="m-0 text-xs text-muted-foreground">{query.data?.note ?? "Similar is not the same cause. Check before you act."}</p>
      </div>
      {query.isLoading && <p className="m-0 text-muted-foreground">Looking…</p>}
      {query.isError && <p className="m-0 text-muted-foreground">Not available offline. Shown when you are connected.</p>}
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
