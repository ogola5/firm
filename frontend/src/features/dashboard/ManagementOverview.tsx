import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { can, type User } from "../../auth";
import { Alert } from "../../components/ui/alert";
import { RankedBars } from "../../components/charts/RankedBars";
import { Card, CardContent, CardHeader, CardTitle } from "../../components/ui/card";
import { EmptyState, Page, PageHeader, Stat } from "../../components/ui/page";
import { type WorkflowReport } from "../../lib/types";
import { api } from "../../offline/api";
import { PeopleSummary } from "../people/People";
import { RecognitionPanel } from "./RecognitionPanel";
import { WorkflowPanel } from "./WorkflowPanel";

type Overview = {
  view_level?: string;
  total_faults?: number;
  open_faults?: number;
  resolved_faults?: number;
  resolved_rate_percent?: number;
  approved_knowledge?: number;
  knowledge_entries?: number;
  mean_time_acknowledge_minutes?: number | null;
  mean_time_restore_hours?: number | null;
  by_category?: Record<string, number>;
  workflow?: WorkflowReport;
};

/** Management and executive analytics (loaded on demand: it carries the chart library). */
export function ManagementOverview({ user }: { user: User }) {
  const executive = user.access.home === "executive";
  const { data, isLoading } = useQuery({
    queryKey: ["analytics", "overview"],
    queryFn: () => api<Overview>("/api/v1/analytics/overview"),
  });
  const title = user.access.home_title;
  const eyebrow = `${user.access.level} · ${user.role_label} · illustrative demonstration data`;

  if (!data) {
    return (
      <Page>
        <PageHeader eyebrow={eyebrow} title={title} />
        <EmptyState>{isLoading ? "Loading summary…" : "Summary data is unavailable. Reconnect and try again."}</EmptyState>
      </Page>
    );
  }
  const categories = Object.entries(data.by_category || {}).map(([label, value]) => ({ label, value }));
  return (
    <Page>
      <PageHeader eyebrow={eyebrow} title={title} description={`${user.access.home_purpose} ${data.view_level || "Summary"} · not verified operating performance.`} />
      {user.access.home === "supervision" && (
        <Alert variant="warning" className="mb-4">
          Procedures that chiefs have approved wait for your publication. <Link to="/approvals" className="font-bold">Open procedure review</Link>
        </Alert>
      )}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Total faults" value={data.total_faults ?? 0} />
        <Stat label="Open faults" value={data.open_faults ?? 0} />
        <Stat label="Resolved faults" value={data.resolved_faults ?? 0} />
        {executive
          ? <Stat label="Resolved rate" value={`${data.resolved_rate_percent ?? 0}%`} />
          : <Stat label="Approved knowledge" value={data.approved_knowledge ?? 0} />}
      </div>
      {!executive && (
        <div className="mt-4 grid gap-4 lg:grid-cols-[1.4fr_1fr]">
          <Card>
            <CardHeader><CardTitle>Faults by category</CardTitle></CardHeader>
            <CardContent><RankedBars title="Faults by category" data={categories} /></CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>Maintenance performance</CardTitle></CardHeader>
            <CardContent>
              <dl className="m-0 grid">
                {[
                  ["Mean acknowledgement", data.mean_time_acknowledge_minutes == null ? "—" : `${data.mean_time_acknowledge_minutes} min`],
                  ["Mean restoration", data.mean_time_restore_hours == null ? "—" : `${data.mean_time_restore_hours} h`],
                  ["Knowledge entries", String(data.knowledge_entries ?? 0)],
                ].map(([label, value]) => (
                  <div key={label} className="flex justify-between border-b border-border py-3 last:border-0">
                    <dt className="text-muted-foreground">{label}</dt>
                    <dd className="m-0 font-extrabold">{value}</dd>
                  </div>
                ))}
              </dl>
            </CardContent>
          </Card>
        </div>
      )}
      {data.workflow && <WorkflowPanel workflow={data.workflow} />}
      {can(user, "people.counts") && <PeopleSummary />}
      {can(user, "recognition.view") && <RecognitionPanel />}
      {executive && (
        <Card className="mt-4">
          <CardHeader><CardTitle>Access level</CardTitle></CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            Enterprise summary KPIs only. Individual fault timelines, equipment records, and employee directory details are restricted to operational and HR roles.
          </CardContent>
        </Card>
      )}
    </Page>
  );
}
