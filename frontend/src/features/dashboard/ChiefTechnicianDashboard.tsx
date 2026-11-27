import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronRight } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { type User } from "../../auth";
import { Alert } from "../../components/ui/alert";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../components/ui/card";
import { Input } from "../../components/ui/form-controls";
import { Page, PageHeader, Stat } from "../../components/ui/page";
import { KnowledgeImpactPanel } from "../library/TypeLibrary";
import { NeedsYouNow } from "./NeedsYouNow";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../../components/ui/table";
import { type DataRow } from "../../lib/types";
import { errorMessage } from "../../lib/query";
import { api } from "../../offline/api";

type Workspace = { counts?: Record<string, number>; faults?: DataRow[]; technicians?: DataRow[] };

const PRIORITY: Record<string, number> = { Critical: 0, High: 1, Medium: 2, Low: 3 };
const prioritize = (left: DataRow, right: DataRow) =>
  Number(right.overdue === true) - Number(left.overdue === true)
  || (PRIORITY[String(left.severity)] ?? 4) - (PRIORITY[String(right.severity)] ?? 4)
  || String(left.created_at).localeCompare(String(right.created_at));

function FaultQueue({ rows, empty }: { rows: DataRow[]; empty: string }) {
  if (!rows.length) return <p className="m-0 text-sm text-muted-foreground">{empty}</p>;
  return (
    <div className="grid gap-2">
      {rows.slice(0, 6).map((fault) => (
        <Link
          key={String(fault.id)}
          to={`/faults?mode=history&fault=${encodeURIComponent(String(fault.id))}`}
          className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2.5 text-foreground no-underline hover:bg-muted"
        >
          <span className="grid min-w-0">
            <strong className="truncate">{String(fault.reference)} · {String(fault.equipment_tag)}</strong>
            <small className="truncate text-muted-foreground">{String(fault.symptom)} · {String(fault.status).replace(/_/g, " ")}</small>
          </span>
          <span className="flex shrink-0 flex-col items-end gap-1 text-right">
            <span className="flex gap-1">
              {fault.overdue === true && <Badge variant="destructive">Overdue</Badge>}
              {String(fault.severity) === "Critical" && <Badge variant="destructive">Critical</Badge>}
            </span>
            <small className="text-muted-foreground">
              {fault.handover_review ? "Hand-over to approve" : fault.write_up_to_check ? "Write-up to check" : fault.awaiting_assignment ? "Nobody has taken it yet" : `Taken by ${String(fault.assigned_user_name || fault.assigned_section)}`}
            </small>
          </span>
        </Link>
      ))}
    </div>
  );
}

function QueueCard({ title, description, rows, empty, footer }: { title: string; description: string; rows: DataRow[]; empty: string; footer?: React.ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div><CardTitle>{title}</CardTitle><CardDescription>{description}</CardDescription></div>
          <Badge>{rows.length}</Badge>
        </div>
      </CardHeader>
      <CardContent><FaultQueue rows={rows} empty={empty} />{footer}</CardContent>
    </Card>
  );
}

export function ChiefTechnicianDashboard({ user }: { user: User }) {
  const queryClient = useQueryClient();
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [message, setMessage] = useState("");

  const workspace = useQuery({ queryKey: ["chief", "workspace"], queryFn: () => api<Workspace>("/api/v1/chief/workspace") });
  const team = workspace.data?.technicians ?? [];

  useEffect(() => {
    setDrafts(Object.fromEntries(team.map((person) => [String(person.id), ((person.competencies || []) as string[]).join(", ")])));
  }, [workspace.data]);

  const saveCompetencies = useMutation({
    mutationFn: (userId: string) => api(`/api/v1/chief/team/${encodeURIComponent(userId)}/competencies`, {
      method: "PATCH",
      body: JSON.stringify({ competencies: (drafts[userId] || "").split(",") }),
    }),
    onSuccess: async () => {
      setMessage("Technician competencies updated.");
      await queryClient.invalidateQueries({ queryKey: ["chief"] });
    },
  });

  const header = (
    <PageHeader
      eyebrow={`${user.section} · technical supervision`}
      title="Section oversight"
      description="Anyone free takes new work. You see who took what, check write-ups after the fix, and step in when nobody has taken something."
    />
  );
  if (!workspace.data) {
    return (
      <Page>
        {header}
        {workspace.isError
          ? <Alert variant="destructive">{errorMessage(workspace.error, "Section oversight could not be loaded.")}</Alert>
          : <p className="text-muted-foreground">Loading section work…</p>}
      </Page>
    );
  }

  const counts = workspace.data.counts || {};
  const active = (workspace.data.faults || []).filter((fault) => !["RESTORED", "CLOSED"].includes(String(fault.status)));
  const sectionFaults = active.filter((fault) => fault.assigned_section === user.section).sort(prioritize);
  // Write-ups are checked after the fix, so working and closed faults can be waiting for a check too.
  const reviewFaults = (workspace.data.faults || []).filter((fault) => fault.awaiting_review).sort(prioritize);
  const escalatedFaults = active.filter((fault) => fault.escalated).sort(prioritize);

  return (
    <Page>
      {header}
      {/* First what needs you, then your section today in three numbers; everything else is folded below. */}
      <div className="mb-4"><NeedsYouNow /></div>
      {message && <Alert variant="success" className="mb-3">{message}</Alert>}
      {saveCompetencies.isError && <Alert variant="destructive" className="mb-3">{errorMessage(saveCompetencies.error, "Competencies could not be saved.")}</Alert>}

      <section aria-label="Your section today" className="mb-4 grid gap-3">
        <h2 className="m-0 text-xl">Your section today</h2>
        <div className="grid grid-cols-3 gap-3">
          <Stat label="Not taken yet" value={counts.awaiting_assignment || 0} />
          <Stat label="Being worked on" value={counts.investigating || 0} />
          <Stat label="To check" value={counts.awaiting_review || 0} />
        </div>
        {(counts.overdue || counts.critical) ? (
          <Alert variant="warning">{[counts.overdue && `${counts.overdue} past the response time`, counts.critical && `${counts.critical} critical not yet working again`].filter(Boolean).join(" · ")}</Alert>
        ) : null}
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <QueueCard title="To check" description="Write-ups to check (already working again) and hand-overs to another section." rows={reviewFaults} empty="Nothing to check." />
        <QueueCard
          title="Active section work"
          description="Not taken yet, taken and in progress in your section."
          rows={sectionFaults}
          empty="No active faults in your section."
          footer={<Button variant="link" asChild className="mt-2"><Link to="/faults">Browse section faults</Link></Button>}
        />
      </div>

      <details className="mt-4 rounded-lg border border-border bg-card">
        <summary className="cursor-pointer list-none p-5 font-bold">More about your section</summary>
        <div className="grid gap-4 px-5 pb-5">
          <ol className="m-0 flex list-none flex-wrap items-center gap-1 rounded-lg border border-border bg-muted px-4 py-3 text-sm text-muted-foreground" aria-label="Fault responsibility flow">
            {["Operations reports to a section", "Anyone free takes it", "Working again", "Operations confirms", "You check the write-up"].map((step, index) => (
              <li key={step} className="flex items-center gap-1">
                {index > 0 && <ChevronRight className="size-4" aria-hidden />}
                <span className={index % 2 ? "font-bold text-ring" : ""}>{step}</span>
              </li>
            ))}
          </ol>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
            <Stat label={`Active in ${user.section}`} value={counts.active_section || 0} />
            <Stat label="Overdue" value={counts.overdue || 0} />
            <Stat label="Critical unresolved" value={counts.critical || 0} />
          </div>
          <QueueCard
            title={`Escalated from ${user.section}`}
            description="The original fault remains visible with all section findings and evidence."
            rows={escalatedFaults}
            empty="No active fault has been escalated from your section."
          />
          <KnowledgeImpactPanel user={user} />
        </div>
      </details>

      <details className="mt-4 rounded-lg border border-border bg-card">
        <summary className="flex cursor-pointer list-none items-start justify-between gap-3 p-5">
          <div>
            <h3 className="m-0">Technician pool</h3>
            <p className="m-0 text-sm text-muted-foreground">ST/PT availability, active workload and competencies for assignment decisions.</p>
          </div>
          <Badge>{team.filter((person) => person.active).length} active</Badge>
        </summary>
        <div className="px-5 pb-5">
          <Table>
            <TableHeader><TableRow><TableHead>Technician</TableHead><TableHead>Availability</TableHead><TableHead>Active work</TableHead><TableHead>Competencies</TableHead><TableHead /></TableRow></TableHeader>
            <TableBody>
              {team.map((person) => {
                const id = String(person.id);
                return (
                  <TableRow key={id}>
                    <TableCell><strong>{String(person.display_name)}</strong><br /><small className="text-muted-foreground">{String(person.role_label)}</small></TableCell>
                    <TableCell>{person.active ? String(person.availability_status).toLowerCase() : "Inactive account"}</TableCell>
                    <TableCell>{String(person.active_workload)}</TableCell>
                    <TableCell>
                      <Input
                        aria-label={`Competencies for ${String(person.display_name)}`}
                        value={drafts[id] || ""}
                        onChange={(event) => setDrafts({ ...drafts, [id]: event.target.value })}
                        placeholder="SCADA, actuator controls, valve mechanisms"
                      />
                    </TableCell>
                    <TableCell>
                      <Button variant="outline" disabled={saveCompetencies.isPending && saveCompetencies.variables === id} onClick={() => saveCompetencies.mutate(id)}>Save</Button>
                    </TableCell>
                  </TableRow>
                );
              })}
              {!team.length && <TableRow><TableCell colSpan={5}>No Senior or Principal Technicians are configured for this section.</TableCell></TableRow>}
            </TableBody>
          </Table>
        </div>
      </details>
    </Page>
  );
}
