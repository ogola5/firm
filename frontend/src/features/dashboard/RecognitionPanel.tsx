import { useQuery } from "@tanstack/react-query";
import { Badge } from "../../components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../components/ui/card";
import { type DataRow } from "../../lib/types";
import { api } from "../../offline/api";

type Recognition = {
  platform?: string;
  recognition_rule?: string;
  integration_status?: string;
  leaderboard?: DataRow[];
};

export function RecognitionPanel() {
  const { data } = useQuery({
    queryKey: ["recognition", "leaderboard"],
    queryFn: () => api<Recognition>("/api/v1/recognition/leaderboard"),
  });
  if (!data) return null;
  const leaderboard = data.leaderboard || [];
  return (
    <Card className="mt-4">
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="m-0 text-2xs font-extrabold uppercase tracking-[0.12em] text-muted-foreground">{data.platform}</p>
            <CardTitle className="mt-1">Contributor recognition</CardTitle>
          </div>
          <Badge variant="success">Verified contribution</Badge>
        </div>
        <CardDescription>{data.recognition_rule} · {data.integration_status}</CardDescription>
      </CardHeader>
      <CardContent>
        <ol className="m-0 grid list-none gap-0 p-0">
          {leaderboard.slice(0, 8).map((row) => (
            <li key={String(row.rank)} className="grid grid-cols-[40px_1fr_auto] items-center gap-3 border-t border-border py-2.5 first:border-0">
              <span className="grid size-9 place-items-center rounded-full bg-secondary text-sm font-extrabold">#{String(row.rank)}</span>
              <div className="grid min-w-0">
                <strong className="truncate">{String(row.employee_name)}</strong>
                <small className="text-muted-foreground">{String(row.role)} · {String(row.section || "Cross-section")}</small>
              </div>
              <div className="grid text-right">
                <strong>{String(row.points)} pts</strong>
                <small className="text-muted-foreground">{String(row.verified_reuses)} verified reuse · {String(row.approved_procedures)} approved · {String(row.approved_revisions)} revisions</small>
              </div>
            </li>
          ))}
        </ol>
        <p className="mb-0 text-xs text-muted-foreground">Point values are illustrative; final recognition and appraisal weighting require organisational approval.</p>
      </CardContent>
    </Card>
  );
}
