import { useQuery } from "@tanstack/react-query";
import { Activity, AlertTriangle, BookOpen, FileText, Network, Plus } from "lucide-react";
import { Link, useParams } from "react-router-dom";
import { can, type User } from "../../auth";
import { Alert } from "../../components/ui/alert";
import { Badge, statusVariant, statusWords } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../components/ui/card";
import { Page, PageHeader } from "../../components/ui/page";
import { Skeleton } from "../../components/ui/skeleton";
import { spokenTime } from "../../lib/format";
import { errorMessage } from "../../lib/query";
import { api } from "../../offline/api";

type Summary = {
  id: string; tag: string; name: string; station: string; region: string; location: string; section: string; criticality: string;
  type_code: string; type_name: string; system: { id: string; name: string; legacy: boolean } | null;
  watch: { reasons: string[]; level: string } | null;
  open_faults: Array<{ id: string; reference: string; symptom: string; status: string; safety_hazard: boolean; created_at: string }>;
  past_faults: Array<{ id: string; reference: string; symptom: string; reported_at: string | null; cause: string; worked: string; did_not_work: string[] }>;
  fault_count: number;
  usual_causes: Array<{ cause: string; times: number; confirmed: number }>;
  drawings: Array<{ id: string; number: string; title: string; revision: string; status_label: string }>;
  drawing_differences: Array<{ id: string; description: string; status: string; drawing_number: string }>;
};

const day = (value: string | null) => (value ? spokenTime(value).replace(/ \d\d:\d\d$/, "") : "");

/** Everything about one piece of equipment on one page. */
export function EquipmentPage({ user }: { user: User }) {
  const { id = "" } = useParams();
  const query = useQuery({ queryKey: ["equipment", id, "summary"], queryFn: () => api<Summary>(`/api/v1/equipment/${encodeURIComponent(id)}/summary`) });
  const data = query.data;
  return (
    <Page>
      <Link to="/equipment" className="text-sm font-bold">‹ Equipment</Link>
      <PageHeader className="mt-2" eyebrow={data ? `${data.type_name} · ${data.section}` : "Equipment"} title={data ? `${data.tag} · ${data.name}` : "Loading…"}
        description={data ? `${data.location}, ${data.station}${data.region ? ` (${data.region})` : ""} · ${data.fault_count} fault(s) on record` : undefined}
        actions={data && can(user, "faults.report") ? (
          <Button asChild><Link to={`/report?equipment=${encodeURIComponent(data.tag)}`}><Plus />Report a fault on this</Link></Button>
        ) : undefined} />
      {query.isError && <Alert variant="destructive">{errorMessage(query.error, "This equipment is not available.")}</Alert>}
      {query.isLoading && <div className="grid gap-4 md:grid-cols-2" aria-busy="true"><Skeleton className="h-40" /><Skeleton className="h-40" /><Skeleton className="h-56 md:col-span-2" /></div>}
      {data && (
        <div className="grid gap-4 xl:grid-cols-[1.5fr_1fr]">
          <div className="grid content-start gap-4">
            <Card aria-label="Open now">
              <CardHeader className="pb-2"><CardTitle className="text-base">Open now</CardTitle></CardHeader>
              <CardContent className="grid gap-2 pt-0 text-sm">
                {data.open_faults.length ? data.open_faults.map((item) => (
                  <Link key={item.id} to={`/faults?mode=history&fault=${item.id}`} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border p-2.5 text-foreground no-underline hover:border-primary">
                    <span>{item.safety_hazard && <Badge variant="destructive" className="mr-2">SAFETY</Badge>}<strong>{item.reference}</strong> · {item.symptom}</span>
                    <Badge variant={statusVariant(item.status)} className="normal-case">{statusWords(item.status)}</Badge>
                  </Link>
                )) : <p className="m-0 text-muted-foreground">No open faults.</p>}
              </CardContent>
            </Card>
            <Card aria-label="What has happened before">
              <CardHeader className="pb-2"><CardTitle className="text-base">What has happened before</CardTitle>
                <CardDescription>Its own history: what was found, what worked and what didn't.</CardDescription></CardHeader>
              <CardContent className="grid gap-2 pt-0 text-sm">
                {data.past_faults.length ? data.past_faults.map((item) => (
                  <div key={item.id} className="border-b border-border pb-2 last:border-0">
                    <Link to={`/faults?mode=history&fault=${item.id}`} className="font-bold">{item.reference}</Link> · {item.symptom} <span className="text-xs text-muted-foreground">· {day(item.reported_at)}</span>
                    {item.cause && <span className="block">Cause: {item.cause}</span>}
                    {item.did_not_work.map((action) => <span key={action} className="block text-destructive">Didn't work: {action}</span>)}
                    {item.worked && <span className="block text-success">Worked: {item.worked}</span>}
                  </div>
                )) : <p className="m-0 text-muted-foreground">No finished faults yet.</p>}
              </CardContent>
            </Card>
          </div>
          <div className="grid content-start gap-4">
            {data.watch && (
              <Alert variant={data.watch.level === "HIGH" ? "destructive" : "warning"}>
                <Activity /><span><strong>{data.watch.level === "HIGH" ? "Check soon" : "Keep an eye on it"}:</strong> {data.watch.reasons.join("; ")}</span>
              </Alert>
            )}
            {data.usual_causes.length > 0 && (
              <Card>
                <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-base"><AlertTriangle className="size-4 text-warning" />Usual causes here</CardTitle></CardHeader>
                <CardContent className="pt-0 text-sm">
                  <ol className="m-0 grid gap-1 pl-5">{data.usual_causes.map((row) => <li key={row.cause}><strong>{row.cause}</strong> <span className="text-muted-foreground">({row.times}×, fixed {row.confirmed}×)</span></li>)}</ol>
                </CardContent>
              </Card>
            )}
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-base">Knowledge</CardTitle></CardHeader>
              <CardContent className="grid gap-2 pt-0 text-sm">
                <Link to={`/library/${data.type_code}`} className="flex items-center gap-2 font-semibold"><BookOpen className="size-4" />Everything we know about {data.type_name.toLowerCase()}</Link>
                {data.system && <Link to={`/library/systems/${data.system.id}`} className="flex items-center gap-2 font-semibold"><Network className="size-4" />Part of {data.system.name}{data.system.legacy ? " (legacy)" : ""}</Link>}
              </CardContent>
            </Card>
            {(data.drawings.length > 0 || data.drawing_differences.length > 0) && (
              <Card>
                <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-base"><FileText className="size-4" />Drawings</CardTitle></CardHeader>
                <CardContent className="grid gap-1.5 pt-0 text-sm">
                  {data.drawings.map((item) => <div key={item.id}><strong>{item.number}</strong> rev {item.revision} · {item.title} <span className="text-xs text-muted-foreground">({item.status_label})</span></div>)}
                  {data.drawing_differences.map((item) => <div key={item.id} className="text-warning"><strong>Differs from drawing:</strong> {item.description}</div>)}
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      )}
    </Page>
  );
}
