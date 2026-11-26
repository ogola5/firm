import { Link } from "react-router-dom";
import { Badge, statusVariant, statusWords } from "../../../components/ui/badge";
import { Button } from "../../../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../../../components/ui/card";
import { type DataRow } from "../../../lib/types";
import { cn } from "../../../lib/utils";
import { api } from "../../../offline/api";
import { useDetail, type Revision } from "./context";

const when = (value: unknown) => new Date(String(value)).toLocaleString();

function Entry({ className, children }: { className?: string; children: React.ReactNode }) {
  return <article className={cn("grid gap-1 border-t border-border py-3 text-sm first:border-0 first:pt-0", className)}>{children}</article>;
}

const failedStyle = "border-l-[3px] border-l-destructive bg-destructive/5 pl-2.5";

/** Timeline entries in plain words; anything else is shown tidied. */
const EVENT_WORDS: Record<string, string> = {
  FAULT_REPORTED: "Reported", FAULT_ASSIGNED: "Sent to a section", FAULT_TRIAGED: "Sorted", FAULT_ACKNOWLEDGE: "Taken",
  TAKEN_FROM_OTHER_SECTION: "Taken by someone free in another section", HELPER_ADDED: "Called someone in to help",
  HELPER_REMOVED: "Helper no longer on the job", FAULT_ON_SITE: "On site", FAULT_DIAGNOSE: "Cause found",
  FAULT_RESTORE: "Working again", TECHNICAL_COMPLETION_SUBMITTED_FOR_REVIEW: "Write-up sent to the Chief Technician",
  TECHNICAL_COMPLETION_APPROVED: "Write-up checked", TECHNICAL_COMPLETION_RETURNED: "More detail asked for",
  WRITE_UP_ADDED: "Added to the write-up", FAULT_OPERATOR_CONFIRMED: "Operations confirmed it works", FAULT_CLOSE: "Closed",
  FAULT_OPERATOR_REJECTED_RESTORATION: "Operations says it is not fixed", VISIT_RECORDED: "Visit written up",
};

export function RankedCauses() {
  const { context } = useDetail();
  if (!context.ranked_causes?.length) return null;
  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <p className="m-0 text-2xs font-extrabold uppercase tracking-[0.12em] text-muted-foreground">From earlier faults</p>
            <CardTitle className="mt-1">Most likely causes</CardTitle>
          </div>
          <span className="text-sm text-muted-foreground">{context.repeat_routing?.seen_before ? "This equipment has failed before: start here" : "From similar faults"}</span>
        </div>
      </CardHeader>
      <CardContent>
        <ol className="m-0 grid list-none gap-2 p-0">
          {context.ranked_causes.map((cause, index) => (
            <li key={String(cause.possible_cause)} className={cn("grid grid-cols-[32px_1fr] gap-3 rounded-lg border border-border p-3 text-sm", Boolean(cause.recurrence_warning) && "border-warning/40 bg-warning/10")}>
              <span className="grid size-8 place-items-center rounded-full bg-primary text-xs font-extrabold text-primary-foreground">{index + 1}</span>
              <div className="grid gap-1">
                <strong>{String(cause.possible_cause)}</strong>
                <p className="m-0"><b>Quick check:</b> {String(cause.quick_check || "No quick check recorded")}</p>
                <p className="m-0"><b>Fix:</b> {String(cause.fix || "No fix summary recorded")}</p>
                <div className="flex flex-wrap gap-1.5">
                  <Badge variant="success">Confirmed {String(cause.confirmed_count || 0)}×</Badge>
                  <Badge variant="destructive">Failed {String(cause.failed_count || 0)}×</Badge>
                  <Badge>Recurrences {String(cause.recurrence_count || 0)}</Badge>
                </div>
                {Boolean(cause.recurrence_warning) && <p className="m-0 font-semibold text-warning">Recurring workaround: deeper investigation is required before this becomes a permanent fix.</p>}
                {Boolean(cause.supervisor_required) && <p className="m-0 font-semibold text-destructive">Risk level: {String(cause.risk_level)} — supervisor approval is required for this fix.</p>}
              </div>
            </li>
          ))}
        </ol>
      </CardContent>
    </Card>
  );
}

export function EquipmentHistory() {
  const { faultId, context, can, offline, done, fail } = useDetail();

  async function reuse(procedureId: string) {
    try {
      await api(`/api/v1/faults/${encodeURIComponent(faultId)}/procedure-reuse`, { method: "POST", body: JSON.stringify({ procedure_update_id: procedureId }) });
      await done("Procedure use recorded. Confirm whether it helped after restoring the fault.");
    } catch (reason) {
      fail(reason, "Procedure reuse could not be recorded.");
    }
  }

  const system = context.system;
  const related = context.related_faults ?? [];
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {system && (
        <Card className="lg:col-span-2" aria-label="Related equipment">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">
              Part of <Link to={`/library/systems/${system.id}`}>{system.name}</Link>{system.legacy ? <Badge variant="warning" className="ml-2 normal-case">Legacy system</Badge> : null}
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0 text-sm">
            {related.length ? (
              <>
                <p className="m-0 mb-2 text-muted-foreground">Recent faults on the equipment it works with: check whether they are connected.</p>
                {related.map((item) => (
                  <Entry key={item.id}>
                    <strong><Link to={`/faults?mode=history&fault=${item.id}`}>{item.reference}</Link> · {item.equipment_tag} · {item.symptom}</strong>
                    <small className="text-muted-foreground">{item.reported_at ? new Date(item.reported_at).toLocaleDateString() : ""} · {item.equipment_name}</small>
                    {item.cause && <p className="m-0"><strong>Cause:</strong> {item.cause}</p>}
                    {item.did_not_work.map((action) => <p key={action} className={cn("m-0", failedStyle)}><strong>FAILED:</strong> {action}</p>)}
                    {item.worked && <p className="m-0"><strong>Worked:</strong> {item.worked}</p>}
                  </Entry>
                ))}
              </>
            ) : <p className="m-0 text-muted-foreground">No recent faults on the equipment it works with. <Link to={`/library/systems/${system.id}`}>How the system connects</Link></p>}
          </CardContent>
        </Card>
      )}
      <Card>
        <CardHeader><CardTitle>Earlier faults on this equipment</CardTitle></CardHeader>
        <CardContent>
          {context.previous_faults.length ? context.previous_faults.map((item) => (
            <Entry key={String(item.id)}>
              <strong>{String(item.reference)} · {String(item.status)}</strong>
              <small className="text-muted-foreground">{new Date(String(item.created_at)).toLocaleDateString()} · {String(item.symptom)}</small>
              <p className="m-0">{String(item.description || "No report details")}</p>
              {((item.diagnoses || []) as DataRow[]).map((entry, index) => <p key={`d-${index}`} className="m-0"><strong>Cause:</strong> {String(entry.possible_cause)} · {String(entry.verification_status)}</p>)}
              {((item.interventions || []) as DataRow[]).map((entry, index) => (
                <p key={`i-${index}`} className={cn("m-0", entry.outcome === "FAILED" && failedStyle)}><strong>{String(entry.outcome)}:</strong> {String(entry.corrective_action)} {String(entry.notes || "")}</p>
              ))}
            </Entry>
          )) : <p className="m-0 text-sm text-muted-foreground">No earlier reports for this equipment.</p>}
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Approved procedures</CardTitle></CardHeader>
        <CardContent>
          {context.approved_procedures.length ? context.approved_procedures.map((item) => (
            <Entry key={String(item.id)}>
              <div className="flex items-center justify-between gap-2"><strong>{String(item.reference)} · v{String(item.version)}</strong><Badge variant="success">Approved</Badge></div>
              <h4 className="m-0">{String(item.title)}</h4>
              <p className="m-0"><strong>Cause:</strong> {String(item.confirmed_cause)}</p>
              <p className="m-0"><strong>Check:</strong> {String(item.diagnostic_procedure)}</p>
              <p className="m-0"><strong>Action:</strong> {String(item.corrective_action)}</p>
              <small className="text-muted-foreground">Contributor: {String(item.author_name)}</small>
              {can.canInvestigate && !offline && <Button variant="outline" size="sm" className="justify-self-start" onClick={() => reuse(String(item.id))}>Record use on this fault</Button>}
            </Entry>
          )) : <p className="m-0 text-sm text-muted-foreground">No approved work-procedure updates match this case yet.</p>}
          {context.legacy_knowledge.map((item) => (
            <Entry key={String(item.id)}>
              <strong>{String(item.reference)} · v{String(item.version)} · approved library entry</strong>
              <h4 className="m-0">{String(item.title)}</h4>
              <p className="m-0"><strong>Cause:</strong> {String(item.confirmed_cause)}</p>
              <p className="m-0"><strong>Action:</strong> {String(item.corrective_action)}</p>
              {item.source_type === "LEGACY_PROCEDURE" && <>
                <p className="m-0"><strong>Legacy reference:</strong> {String(item.legacy_reference || "Not recorded")}</p>
                <p className="m-0"><strong>Applies to:</strong> {String(item.usage_scope || "Existing equipment or tool")}</p>
                <ol className="m-0 grid gap-1 pl-5">
                  {String(item.step_by_step || "").split("\n").filter((step) => step.trim()).map((step, index) => <li key={index}>{step.replace(/^\d+\.\s*/, "")}</li>)}
                </ol>
              </>}
            </Entry>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

export function InvestigationLog({ onRevise }: { onRevise: (revision: Revision) => void }) {
  const { user, context, can } = useDetail();
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader><CardTitle>Checks and fixes tried</CardTitle></CardHeader>
        <CardContent>
          {context.diagnoses.map((item) => (
            <Entry key={String(item.id)}>
              <strong>Possible cause: {String(item.possible_cause)}{item.pending_sync ? " · waiting to sync" : ""}</strong>
              <small className="text-muted-foreground">{String(item.assignment_section || "This device")} · {String(item.author_name)} · {String(item.verification_status)} · {when(item.created_at)}</small>
              <p className="m-0">{String(item.diagnostic_method)}</p>
              {(item.observations || item.test_results) ? <p className="m-0 text-muted-foreground">{String(item.observations ?? "")} {String(item.test_results ?? "")}</p> : null}
            </Entry>
          ))}
          {context.interventions.map((item) => (
            <Entry key={String(item.id)} className={cn(item.outcome === "FAILED" && failedStyle)}>
              <strong>{String(item.outcome)} intervention{item.pending_sync ? " · waiting to sync" : ""}</strong>
              <small className="text-muted-foreground">{String(item.assignment_section || "This device")} · {String(item.actor_name)} · {when(item.created_at)}</small>
              <p className="m-0">{String(item.corrective_action)}</p>
              {(item.tools_materials || item.notes) ? <p className="m-0 text-muted-foreground">{String(item.tools_materials ?? "")} {String(item.notes ?? "")}</p> : null}
            </Entry>
          ))}
          {!context.diagnoses.length && !context.interventions.length && <p className="m-0 text-sm text-muted-foreground">No investigation steps have been recorded for this report.</p>}
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>What happened, in order</CardTitle></CardHeader>
        <CardContent>
          {context.timeline.map((item) => (
            <Entry key={String(item.id)}>
              <strong>{EVENT_WORDS[String(item.event_type)] ?? String(item.event_type).replace(/_/g, " ")}</strong>
              <small className="text-muted-foreground">{String(item.actor_name)} · {when(item.created_at)}</small>
            </Entry>
          ))}
          {context.procedure_updates.map((item) => (
            <Entry key={String(item.id)}>
              <div className="flex items-center justify-between gap-2">
                <strong>{String(item.reference)} · v{String(item.version)}</strong>
                <Badge variant={statusVariant(String(item.status))}>{statusWords(String(item.status))}</Badge>
              </div>
              <p className="m-0">{String(item.title)} · by {String(item.author_name)}</p>
              {((item.reviews || []) as DataRow[]).map((review, index) => (
                <p key={index} className="m-0"><strong>{String(review.decision).replace(/_/g, " ")}:</strong> {String(review.comments)} <small className="text-muted-foreground">— {String(review.reviewer_name)}</small></p>
              ))}
              {can.canContribute && item.author_id === user.id && ["CLARIFICATION_REQUESTED", "APPROVED"].includes(String(item.status)) && (
                <Button variant="outline" size="sm" className="justify-self-start" onClick={() => onRevise({ id: String(item.id), values: item })}>Revise this version</Button>
              )}
            </Entry>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
