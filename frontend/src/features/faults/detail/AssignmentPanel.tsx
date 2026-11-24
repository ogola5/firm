import { useQuery } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { Badge, statusVariant } from "../../../components/ui/badge";
import { Button } from "../../../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../../../components/ui/card";
import { Field, Input, NativeSelect, Textarea } from "../../../components/ui/form-controls";
import { dateTimeLocal } from "../../../lib/format";
import { type DataRow } from "../../../lib/types";
import { api } from "../../../offline/api";
import { ALL_SECTIONS, useDetail } from "./context";

function AllocationForm({ assignment }: { assignment: DataRow }) {
  const { faultId, context, done, fail } = useDetail();
  const pool = useQuery({ queryKey: ["chief", "team"], queryFn: () => api<DataRow[]>("/api/v1/chief/team") });
  const [allocation, setAllocation] = useState({
    assigned_user_id: String(assignment.assigned_user_id || ""),
    severity: String(context.fault.severity || "Medium"),
    response_due_at: dateTimeLocal(assignment.response_due_at),
    instructions: String(assignment.instructions || ""),
  });

  async function submit(event: FormEvent) {
    event.preventDefault();
    try {
      await api(`/api/v1/faults/${encodeURIComponent(faultId)}/assignments/${encodeURIComponent(String(assignment.id))}/allocate`, {
        method: "POST",
        body: JSON.stringify({
          ...allocation,
          assigned_user_id: allocation.assigned_user_id || null,
          response_due_at: allocation.response_due_at ? new Date(allocation.response_due_at).toISOString() : null,
        }),
      });
      await done("Section assignment and response target saved.", true);
    } catch (reason) {
      fail(reason, "Section assignment could not be saved.");
    }
  }

  const candidates = (pool.data ?? []).filter((person) => person.active && (
    person.availability_status === "AVAILABLE" || String(person.id) === allocation.assigned_user_id
  ));
  return (
    <form className="grid gap-3 border-t border-border pt-4" onSubmit={submit}>
      <div>
        <h4 className="m-0">Allocate section work</h4>
        <p className="m-0 text-sm text-muted-foreground">Choose an available Senior or Principal Technician using current workload and their recorded competencies.</p>
      </div>
      <div className="grid gap-3 md:grid-cols-3">
        <Field label="Assigned technician">
          <NativeSelect value={allocation.assigned_user_id} onChange={(event) => setAllocation({ ...allocation, assigned_user_id: event.target.value })}>
            <option value="">Leave in section queue</option>
            {candidates.map((person) => (
              <option key={String(person.id)} value={String(person.id)}>
                {String(person.display_name)} · {String(person.role_label)} · {String(person.active_workload)} active · {((person.competencies || []) as string[]).join(", ") || "Competencies not recorded"}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field label="Operational priority">
          <NativeSelect value={allocation.severity} onChange={(event) => setAllocation({ ...allocation, severity: event.target.value })}>
            {["Low", "Medium", "High", "Critical"].map((value) => <option key={value}>{value}</option>)}
          </NativeSelect>
        </Field>
        <Field label="Expected response by">
          <Input type="datetime-local" required value={allocation.response_due_at} onChange={(event) => setAllocation({ ...allocation, response_due_at: event.target.value })} />
        </Field>
      </div>
      <Field label="Technical instructions">
        <Textarea value={allocation.instructions} onChange={(event) => setAllocation({ ...allocation, instructions: event.target.value })} placeholder="Focus checks, permit constraints, or evidence to collect" />
      </Field>
      <Button type="submit" className="justify-self-start">{assignment.assigned_user_id ? "Save assignment / reassign" : "Assign work"}</Button>
    </form>
  );
}

function SectionReview({ assignment, kind }: { assignment: DataRow; kind: "ESCALATION" | "COMPLETION" }) {
  const { faultId, done, fail } = useDetail();
  const [comments, setComments] = useState("");
  async function decide(decision: string) {
    if (decision.startsWith("RETURN_") && !comments.trim()) {
      fail(null, "Add clear instructions before returning work for more investigation.");
      return;
    }
    try {
      await api(`/api/v1/faults/${encodeURIComponent(faultId)}/assignments/${encodeURIComponent(String(assignment.id))}/review`, {
        method: "POST",
        body: JSON.stringify({ decision, comments }),
      });
      setComments("");
      await done(decision.startsWith("APPROVE_") ? "Chief technical review approved." : "Work returned with your instructions.", true);
    } catch (reason) {
      fail(reason, "Technical review could not be saved.");
    }
  }
  const escalation = kind === "ESCALATION";
  return (
    <div className="grid gap-3 border-t border-border pt-4">
      <div>
        <h4 className="m-0">{escalation ? `Review requested escalation to ${String(assignment.requested_next_section)}` : "Review technical completion"}</h4>
        <p className="m-0 text-sm text-muted-foreground">
          {escalation
            ? "Check the technician's findings, evidence and recommendation above before transferring the next assignment."
            : "Verify that corrective work and test results are documented. Approval marks the section restored; Operations must still confirm service."}
        </p>
      </div>
      <Field label="Review note or instructions">
        <Textarea value={comments} onChange={(event) => setComments(event.target.value)} placeholder={escalation ? "Required if returning for more investigation" : "Required if returning for more work"} />
      </Field>
      <div className="flex flex-wrap gap-2">
        <Button type="button" onClick={() => decide(escalation ? "APPROVE_ESCALATION" : "APPROVE_COMPLETION")}>{escalation ? "Approve escalation" : "Approve technical completion"}</Button>
        <Button type="button" variant="outline" onClick={() => decide(escalation ? "RETURN_ESCALATION" : "RETURN_COMPLETION")}>{escalation ? "Return for investigation" : "Return for more work"}</Button>
      </div>
    </div>
  );
}

function HandoffForm({ assignment }: { assignment: DataRow }) {
  const { faultId, done, fail } = useDetail();
  const [values, setValues] = useState({ next_section: "", findings: "", recommendation: "" });
  async function submit(event: FormEvent) {
    event.preventDefault();
    try {
      await api(`/api/v1/faults/${encodeURIComponent(faultId)}/assignments/escalate`, { method: "POST", body: JSON.stringify(values) });
      const target = values.next_section;
      setValues({ next_section: "", findings: "", recommendation: "" });
      await done(`Findings handed to ${target}; the breakdown record remains continuous.`, true);
    } catch (reason) {
      fail(reason, "Section handoff could not be saved.");
    }
  }
  return (
    <form className="grid gap-3 border-t border-border pt-4" onSubmit={submit}>
      <div>
        <h4 className="m-0">Hand off to another section</h4>
        <p className="m-0 text-sm text-muted-foreground">The receiving team gets this fault, prior section findings, tests, and linked evidence.</p>
      </div>
      <Field label="Next section">
        <NativeSelect required value={values.next_section} onChange={(event) => setValues({ ...values, next_section: event.target.value })}>
          <option value="">Select section</option>
          {ALL_SECTIONS.filter((section) => section !== assignment.section).map((section) => <option key={section}>{section}</option>)}
        </NativeSelect>
      </Field>
      <Field label="What did your section find?"><Textarea required value={values.findings} onChange={(event) => setValues({ ...values, findings: event.target.value })} /></Field>
      <Field label="What should the next section do?"><Textarea required value={values.recommendation} onChange={(event) => setValues({ ...values, recommendation: event.target.value })} /></Field>
      <Button type="submit" variant="outline" className="justify-self-start">Send with findings</Button>
    </form>
  );
}

export function AssignmentPanel() {
  const { context, can, offline } = useDetail();
  if (!context.assignments.length) return null;
  const active = can.activeAssignment;
  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <p className="m-0 text-2xs font-extrabold uppercase tracking-[0.12em] text-muted-foreground">Accountable section handoffs</p>
            <CardTitle className="mt-1">One breakdown, shared findings</CardTitle>
          </div>
          <span className="text-sm text-muted-foreground">Active section: {String(active?.section || "Awaiting operator confirmation")}</span>
        </div>
      </CardHeader>
      <CardContent className="grid gap-4">
        <ol className="m-0 grid list-none gap-2 p-0">
          {context.assignments.map((item, index) => (
            <li key={String(item.id)} className="grid gap-1 rounded-lg border border-border p-3 text-sm">
              <div className="flex items-center justify-between gap-2">
                <strong>{index + 1}. {String(item.section)}</strong>
                <Badge variant={statusVariant(String(item.status))}>{String(item.status).replace(/_/g, " ")}</Badge>
              </div>
              <small className="text-muted-foreground">
                {item.assigned_user_name ? `Owner: ${String(item.assigned_user_name)}` : "Awaiting section acknowledgement"} · {new Date(String(item.created_at)).toLocaleString()} · {String(item.elapsed_minutes)} min in assignment
              </small>
              {Boolean(item.reason) && <p className="m-0"><strong>Handoff reason:</strong> {String(item.reason)}</p>}
              {Boolean(item.instructions) && <p className="m-0"><strong>Chief Technician instructions:</strong> {String(item.instructions)}</p>}
              {Boolean(item.response_due_at) && <p className="m-0"><strong>Expected response:</strong> {new Date(String(item.response_due_at)).toLocaleString()}</p>}
              {Boolean(item.findings) && <p className="m-0"><strong>Findings:</strong> {String(item.findings)}</p>}
              {Boolean(item.recommendation) && <p className="m-0"><strong>Recommended next action:</strong> {String(item.recommendation)}</p>}
              {item.escalation_status === "RETURNED" && Boolean(item.escalation_review_comments) && <p className="m-0"><strong>Chief review:</strong> {String(item.escalation_review_comments)}</p>}
              {item.completion_review_status === "RETURNED" && Boolean(item.completion_review_comments) && <p className="m-0"><strong>Completion review:</strong> {String(item.completion_review_comments)}</p>}
            </li>
          ))}
        </ol>
        {/* These steps decide against current server state, so they are online-only. */}
        {!offline && active && can.canReviewSection && can.assetConfirmed && <AllocationForm key={String(active.id)} assignment={active} />}
        {!offline && active && can.canReviewSection && active.escalation_status === "PENDING" && <SectionReview assignment={active} kind="ESCALATION" />}
        {!offline && active && can.canReviewSection && active.completion_review_status === "PENDING" && <SectionReview assignment={active} kind="COMPLETION" />}
        {!offline && active && can.canEscalate && !can.awaitingChiefReview && can.assetConfirmed && <HandoffForm assignment={active} />}
      </CardContent>
    </Card>
  );
}
