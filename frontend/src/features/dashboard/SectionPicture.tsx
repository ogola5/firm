import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { type User } from "../../auth";
import { Button } from "../../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../components/ui/card";
import { api } from "../../offline/api";
import { SummaryTile, type SummaryMeasure } from "../analytics/SummaryTile";

const HEADLINE = ["restore_h", "first_time_fix_pct", "repeat_pct", "open_at_end"];

/**
 * The Chief Engineer's view of their section: the last 4 weeks against the 4 before,
 * and the equipment that keeps coming back. The server holds it to their own section.
 */
export function SectionPicture({ user }: { user: User }) {
  const summary = useQuery({
    queryKey: ["analytics", "section-picture", "summary"],
    queryFn: () => {
      const end = new Date();
      const start = new Date(end);
      start.setDate(start.getDate() - 27);
      const day = (value: Date) => `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
      return api<{ measures: SummaryMeasure[]; min_n_to_compare: number }>(`/api/v1/analytics/summary?start=${day(start)}&end=${day(end)}`);
    },
  });
  const attention = useQuery({
    queryKey: ["analytics", "section-picture", "attention"],
    queryFn: () => api<{ equipment: Array<{ equipment_id: string; equipment_tag: string; equipment_name: string; reasons: string[] }> }>(
      "/api/v1/analytics/equipment-attention?limit=5"),
  });
  const measures = (summary.data?.measures ?? []).filter((item) => HEADLINE.includes(item.key));

  return (
    <section aria-label={`${user.section} section picture`} className="grid gap-4">
      {measures.length > 0 && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {measures.map((measure) => (
            <SummaryTile key={measure.key} measure={measure} rangeWords="previous 4 weeks" minN={summary.data?.min_n_to_compare ?? 5} />
          ))}
        </div>
      )}
      <Card>
        <CardHeader>
          <CardTitle>{user.section} equipment needing attention</CardTitle>
          <CardDescription>Last 12 weeks: faults, repeats and faults that came back after a fix.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-2 text-sm">
          {attention.data && !attention.data.equipment.length && <p className="m-0 text-muted-foreground">Nothing stands out.</p>}
          {attention.data?.equipment.map((item) => (
            <div key={item.equipment_id} className="grid gap-0.5 border-b border-border pb-2 last:border-0">
              <strong>{item.equipment_tag} · <span className="font-normal">{item.equipment_name}</span></strong>
              <span className="text-muted-foreground">{item.reasons.join(" · ")}</span>
            </div>
          ))}
          <Button asChild variant="outline" className="mt-1 justify-self-start"><Link to="/analytics">Section analytics</Link></Button>
        </CardContent>
      </Card>
    </section>
  );
}
