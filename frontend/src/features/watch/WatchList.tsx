import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Gauge } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { can, type User } from "../../auth";
import { Alert } from "../../components/ui/alert";
import { Badge } from "../../components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../components/ui/card";
import { NativeSelect } from "../../components/ui/form-controls";
import { Page, PageHeader } from "../../components/ui/page";
import { spokenTime } from "../../lib/format";
import { errorMessage } from "../../lib/query";
import { api } from "../../offline/api";

const SECTIONS = ["Systems Automation", "Electrical", "Mechanical"];

type WatchRow = {
  equipment_id: string; equipment_tag: string; equipment_name: string; section: string; score: number; level: "HIGH" | "WATCH";
  reasons: string[]; faults_on_record: number; last_fault: string; likely_cause: string | null;
  common_cause_category: string | null; procedure: { id: string; title: string; reference: string } | null;
};
type Accuracy = { listed: number; hits: number; hit_rate_pct: number | null; base_rate_pct: number | null; verdict: string; method: string; horizon_days: number };
type Watch = { scope: string; equipment: WatchRow[]; accuracy: Accuracy; how: string };

function useWatch(section: string, limit: number) {
  return useQuery({
    queryKey: ["watch", section, limit],
    queryFn: () => api<Watch>(`/api/v1/analytics/watch-list?limit=${limit}${section ? `&section=${encodeURIComponent(section)}` : ""}`),
  });
}

function WatchItem({ row }: { row: WatchRow }) {
  return (
    <article aria-label={`${row.equipment_tag} likely to need attention`} className="grid gap-1.5 border-b border-border py-3 last:border-0">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <strong>{row.equipment_tag} · <span className="font-normal">{row.equipment_name}</span> <span className="text-xs text-muted-foreground">· {row.section}</span></strong>
        <Badge variant={row.level === "HIGH" ? "destructive" : "warning"} className="normal-case">{row.level === "HIGH" ? "Check soon" : "Keep an eye on it"}</Badge>
      </div>
      <ul className="m-0 grid gap-0.5 pl-5 text-sm">
        {row.reasons.map((reason) => <li key={reason}>{reason}</li>)}
      </ul>
      <div className="text-sm text-muted-foreground">
        {row.common_cause_category || row.likely_cause ? <>Usual cause: <span className="text-foreground">{row.common_cause_category ?? row.likely_cause}</span>{row.likely_cause && row.common_cause_category ? ` (${row.likely_cause})` : ""}. </> : null}
        {row.procedure ? <>Procedure: <Link to="/knowledge" className="font-semibold">{row.procedure.reference}</Link> “{row.procedure.title}”.</> : "No procedure yet."}
        {" "}Last fault {spokenTime(row.last_fault).replace(/ \d\d:\d\d$/, "")}; {row.faults_on_record} on record.
      </div>
    </article>
  );
}

/** A few items above My jobs: what to look at on the next round. */
export function WatchPanel({ user }: { user: User }) {
  const watch = useWatch("", 5);
  if (!can(user, "watch.view") || !watch.data || !watch.data.equipment.length) return null;
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base"><AlertTriangle className="size-4 text-warning" /> Likely to need attention in {watch.data.scope.toLowerCase().replace(" section", "")}</CardTitle>
        <CardDescription>Worth a look on your next round. <Link to="/watch" className="font-semibold">See the full list</Link></CardDescription>
      </CardHeader>
      <CardContent className="pt-0">
        {watch.data.equipment.slice(0, 3).map((row) => <WatchItem key={row.equipment_id} row={row} />)}
      </CardContent>
    </Card>
  );
}

export function WatchList({ user }: { user: User }) {
  const orgWide = can(user, "analytics.org") || user.role === "general_manager_om";
  const [section, setSection] = useState("");
  const watch = useWatch(section, 25);
  const accuracy = watch.data?.accuracy;

  return (
    <Page>
      <PageHeader
        eyebrow={`${user.access.level} · ${watch.data?.scope ?? user.access.scope}`}
        title="Likely to fail"
        description="Equipment that may need attention soon, each with the reasons. A guide for preventive checks, not a prediction to blame anyone with."
      />
      {orgWide && (
        <div className="mb-4">
          <NativeSelect aria-label="Section" className="w-auto" value={section} onChange={(event) => setSection(event.target.value)}>
            <option value="">All sections</option>
            {SECTIONS.map((item) => <option key={item}>{item}</option>)}
          </NativeSelect>
        </div>
      )}
      {watch.isError && <Alert variant="destructive">{errorMessage(watch.error, "The list is not available.")}</Alert>}
      <div className="grid gap-4 xl:grid-cols-[1.6fr_1fr]">
        <Card>
          <CardHeader>
            <CardTitle>{watch.data ? `${watch.data.equipment.length} item(s)` : "Loading…"}</CardTitle>
            <CardDescription>Equipment already broken and being worked on is not listed.</CardDescription>
          </CardHeader>
          <CardContent className="pt-0">
            {watch.data && !watch.data.equipment.length && <p className="m-0 text-sm text-muted-foreground">Nothing stands out right now.</p>}
            {watch.data?.equipment.map((row) => <WatchItem key={row.equipment_id} row={row} />)}
          </CardContent>
        </Card>
        <div className="grid content-start gap-4">
          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2 text-base"><Gauge className="size-4" /> How often has this list been right?</CardTitle></CardHeader>
            <CardContent className="grid gap-2 text-sm">
              {accuracy && (
                <>
                  {accuracy.hit_rate_pct != null && (
                    <div className="grid grid-cols-2 gap-3">
                      <div className="rounded-lg border border-border p-3"><div className="text-2xl font-extrabold">{accuracy.hit_rate_pct}%</div><div className="text-xs text-muted-foreground">of listed equipment failed within {accuracy.horizon_days} days ({accuracy.hits} of {accuracy.listed})</div></div>
                      <div className="rounded-lg border border-border p-3"><div className="text-2xl font-extrabold">{accuracy.base_rate_pct}%</div><div className="text-xs text-muted-foreground">of all equipment did (the comparison)</div></div>
                    </div>
                  )}
                  <p className="m-0 font-semibold">{accuracy.verdict}</p>
                  <p className="m-0 text-xs text-muted-foreground">{accuracy.method}</p>
                </>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle className="text-base">Why something is listed</CardTitle></CardHeader>
            <CardContent className="text-sm text-muted-foreground">{watch.data?.how}</CardContent>
          </Card>
        </div>
      </div>
    </Page>
  );
}
