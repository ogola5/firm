import { useQuery } from "@tanstack/react-query";
import { ChevronRight } from "lucide-react";
import { Link } from "react-router-dom";
import { type User } from "../../auth";
import { Alert } from "../../components/ui/alert";
import { Button } from "../../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../components/ui/card";
import { Page, PageHeader, Stat } from "../../components/ui/page";
import { api } from "../../offline/api";
import { PeopleSummary } from "../people/People";

type Request = { account_status: string };
type Summary = { total_accounts: number; active_accounts: number; inactive_accounts: number };
type Health = {
  database: { ok: boolean; migration: { up_to_date: boolean; current: string | null } };
  scheduler: { enabled: boolean; last_error: string };
  storage: { persistent: boolean; warning: string };
  sync: { conflicts_waiting: number };
  errors: unknown[];
};

const AREAS: Array<{ tab: string; title: string; text: string; developer?: boolean }> = [
  { tab: "health", title: "Health", text: "Version, database, background timer, files, offline devices, recent errors." },
  { tab: "rules", title: "Rules", text: "Response targets, when untaken jobs are flagged, escalation timings, sign-in rules." },
  { tab: "organisation", title: "Organisation", text: "Sections, regions, stations and how many people work in each." },
  { tab: "equipment", title: "Equipment register", text: "Add or edit demo equipment, or import a spreadsheet." },
  { tab: "audit", title: "Audit trail", text: "Sign-ins, access changes, rule changes and equipment changes." },
  { tab: "developer", title: "Developer tools", text: "View as someone (read-only), banner, feature switches, reset demo data.", developer: true },
];

/** The System Administrator's home: account requests, how the system is doing, and the console. */
export function AdminHome({ user }: { user: User }) {
  const requests = useQuery({ queryKey: ["people", "requests"], queryFn: () => api<Request[]>("/api/v1/enrolment/requests") });
  const summary = useQuery({ queryKey: ["people", "summary"], queryFn: () => api<Summary>("/api/v1/users/summary") });
  const health = useQuery({ queryKey: ["admin", "health"], queryFn: () => api<Health>("/api/v1/admin/health") });
  const waiting = (requests.data ?? []).filter((item) => item.account_status === "PENDING_APPROVAL").length;
  const h = health.data;
  const problems = h ? [
    !h.database.ok && "the database is not answering",
    h.database.migration.current !== null && !h.database.migration.up_to_date && "the database needs its latest migration",
    h.scheduler.enabled && h.scheduler.last_error && "the background timer failed last time",
    h.sync.conflicts_waiting > 0 && `${h.sync.conflicts_waiting} offline change(s) wait for a decision`,
    h.errors.length > 0 && `${h.errors.length} recent error(s)`,
  ].filter(Boolean) as string[] : [];

  return (
    <Page>
      <PageHeader eyebrow={`${user.access.level} · ${user.role_label}`} title={user.access.home_title} description={user.access.home_purpose} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Waiting for approval" value={requests.data ? waiting : "—"} />
        <Stat label="Active accounts" value={summary.data?.active_accounts ?? "—"} />
        <Stat label="Disabled accounts" value={summary.data?.inactive_accounts ?? "—"} />
        <Stat label="All accounts" value={summary.data?.total_accounts ?? "—"} />
      </div>
      {h && (
        <div className="mt-4 grid gap-2">
          {problems.length
            ? <Alert variant="destructive">Needs attention: {problems.join("; ")}. <Link to="/admin?tab=health" className="font-bold">Open Health</Link></Alert>
            : <Alert variant="success">The system is healthy.</Alert>}
          {h.storage.warning && <Alert variant="warning">{h.storage.warning}</Alert>}
        </div>
      )}
      <Card className="mt-4">
        <CardHeader>
          <CardTitle>Account requests</CardTitle>
          <CardDescription>Staff enrol with their KPC email. You confirm their level (ST, PT, CT, AE, E, SE, CE, MM, GM, HR…), section and region; that decides everything they see.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          {waiting > 0
            ? <Alert variant="warning">{waiting} request(s) waiting for your decision.</Alert>
            : requests.data && <p className="m-0 text-sm text-muted-foreground">No requests waiting.</p>}
          <Button asChild className="justify-self-start"><Link to="/people">Open user management</Link></Button>
        </CardContent>
      </Card>
      <section aria-label="Admin console" className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {AREAS.filter((area) => !area.developer || user.developer).map((area) => (
          <Link key={area.tab} to={`/admin?tab=${area.tab}`} className="flex items-center justify-between gap-3 rounded-xl border border-border bg-card p-4 text-foreground no-underline hover:border-primary">
            <span className="grid gap-0.5"><strong>{area.title}</strong><span className="text-sm text-muted-foreground">{area.text}</span></span>
            <ChevronRight className="size-5 shrink-0 text-primary" aria-hidden />
          </Link>
        ))}
      </section>
      <PeopleSummary />
    </Page>
  );
}
