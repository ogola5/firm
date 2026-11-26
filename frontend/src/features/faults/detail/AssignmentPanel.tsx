import { useQuery } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { Badge, statusVariant, statusWords } from "../../../components/ui/badge";
import { Button } from "../../../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../../../components/ui/card";
import { Field, Input, NativeSelect, Textarea } from "../../../components/ui/form-controls";
import { dateTimeLocal } from "../../../lib/format";
import { type DataRow } from "../../../lib/types";
import { api } from "../../../offline/api";
import { can as hasAbility, type User } from "../../../auth";
import { ALL_SECTIONS, useDetail } from "./context";

const canPairAdviser = (user: User) => hasAbility(user, "jobs.adviser");

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
        <h4 className="m-0">Give it to someone (optional)</h4>
        <p className="m-0 text-sm text-muted-foreground">Anyone free can take it themselves. Use this to give it to a particular person, or to set a response time.</p>
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
      const approved = decision.startsWith("APPROVE_");
      await done(escalation
        ? approved ? "Hand-over approved." : "Hand-over sent back with your instructions."
        : approved ? "Write-up approved." : "Asked for more detail in the write-up.", true);
    } catch (reason) {
      fail(reason, "Your review could not be saved.");
    }
  }
  const escalation = kind === "ESCALATION";
  return (
    <div className="grid gap-3 border-t border-border pt-4">
      <div>
        <h4 className="m-0">{escalation ? `Review the hand-over to ${String(assignment.requested_next_section)}` : "Check the write-up"}</h4>
        <p className="m-0 text-sm text-muted-foreground">
          {escalation
            ? "Check the findings, evidence and recommendation above before the job moves to the next section."
            : `${String(assignment.assigned_user_name || "The technician")} has already put it back in service (Operations confirm that). Check what was found and done is clear enough for the next person.`}
        </p>
      </div>
      <Field label={escalation ? "Review note or instructions" : "Note, or what is missing"}>
        <Textarea value={comments} onChange={(event) => setComments(event.target.value)} placeholder={escalation ? "Required if sending it back" : "Required if asking for more detail"} />
      </Field>
      <div className="flex flex-wrap gap-2">
        <Button type="button" onClick={() => decide(escalation ? "APPROVE_ESCALATION" : "APPROVE_COMPLETION")}>{escalation ? "Approve the hand-over" : "Write-up is good"}</Button>
        <Button type="button" variant="outline" onClick={() => decide(escalation ? "RETURN_ESCALATION" : "RETURN_COMPLETION")}>{escalation ? "Send back" : "Ask for more detail"}</Button>
      </div>
    </div>
  );
}

/** The Chief Technician asked for more detail: the person on the job adds it; it goes back to be checked. */
function WriteUpNoteForm({ assignment }: { assignment: DataRow }) {
  const { faultId, done, fail } = useDetail();
  const [note, setNote] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault();
    try {
      await api(`/api/v1/faults/${encodeURIComponent(faultId)}/assignments/${encodeURIComponent(String(assignment.id))}/write-up-note`, {
        method: "POST", body: JSON.stringify({ note }),
      });
      setNote("");
      await done("Added to your write-up. Your Chief Technician will check it again.", true);
    } catch (reason) {
      fail(reason, "Your addition was not saved.");
    }
  }
  return (
    <form id="fault-writeup-note" onSubmit={submit} className="grid gap-3 rounded-lg border-2 border-warning/60 p-3">
      <div>
        <h4 className="m-0">Add to your write-up</h4>
        <p className="m-0 text-sm"><strong>Your Chief Technician asked:</strong> {String(assignment.completion_review_comments || "More detail.")}</p>
      </div>
      <Field label="What you are adding">
        <Textarea required value={note} onChange={(event) => setNote(event.target.value)} placeholder="Readings, the test you did, the part number…" />
      </Field>
      <Button type="submit" className="justify-self-start" disabled={!note.trim()}>Add it</Button>
    </form>
  );
}

type Candidate = { id: string; name: string; section: string; role: string; available: boolean };

/** Call a colleague in, from any section. They see the job, can write up what they did, and are credited. */
function HelpersPanel({ assignment }: { assignment: DataRow }) {
  const { faultId, can, user, done, fail } = useDetail();
  const helpers = (assignment.helpers ?? []) as Array<{ user_id: string; name: string; section: string; note: string }>;
  const canCall = can.onTheJob || (can.isSectionChief && assignment.section === user.section);
  const [open, setOpen] = useState(false);
  const [chosen, setChosen] = useState("");
  const [note, setNote] = useState("");
  const candidates = useQuery({
    queryKey: ["helper-candidates", faultId, helpers.length],
    enabled: open && canCall,
    queryFn: () => api<Candidate[]>(`/api/v1/faults/${encodeURIComponent(faultId)}/helper-candidates`),
  });

  async function add(event: FormEvent) {
    event.preventDefault();
    try {
      const added = await api<{ name: string }>(`/api/v1/faults/${encodeURIComponent(faultId)}/helpers`, {
        method: "POST", body: JSON.stringify({ user_id: chosen, note }),
      });
      setChosen(""); setNote(""); setOpen(false);
      await done(`${added.name} has been asked to help.`);
    } catch (reason) {
      fail(reason, "Could not call them in.");
    }
  }

  async function remove(helperId: string, name: string) {
    try {
      await api(`/api/v1/faults/${encodeURIComponent(faultId)}/helpers/${encodeURIComponent(helperId)}`, { method: "DELETE" });
      await done(`${name} is no longer on this job.`);
    } catch (reason) {
      fail(reason, "Could not remove them.");
    }
  }

  if (!helpers.length && !canCall) return null;
  return (
    <section id="fault-helpers" aria-label="Helping on this job" className="grid gap-2 rounded-lg border border-border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="m-0">Helping on this job</h4>
        {canCall && !open && <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>Call someone to help</Button>}
      </div>
      {helpers.length
        ? <ul className="m-0 grid gap-1 p-0">{helpers.map((helper) => (
          <li key={helper.user_id} className="flex list-none flex-wrap items-center justify-between gap-2 text-sm">
            <span><strong>{helper.name}</strong> · {helper.section}{helper.note ? ` · ${helper.note}` : ""}</span>
            {canCall && <Button type="button" variant="ghost" size="sm" onClick={() => void remove(helper.user_id, helper.name)}>Remove</Button>}
          </li>))}</ul>
        : <p className="m-0 text-sm text-muted-foreground">Nobody yet. Anyone in the workshop, from any section, can be called in.</p>}
      {open && (
        <form onSubmit={add} className="grid gap-2 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
          <Field label="Who">
            <NativeSelect required value={chosen} onChange={(event) => setChosen(event.target.value)}>
              <option value="">{candidates.isLoading ? "Loading…" : "Choose a colleague"}</option>
              {(candidates.data ?? []).map((person) => (
                <option key={person.id} value={person.id}>{person.name} · {person.section || "No section"}{person.available ? "" : " · marked away"}</option>
              ))}
            </NativeSelect>
          </Field>
          <Field label="What you need (optional)"><Input value={note} onChange={(event) => setNote(event.target.value)} placeholder="e.g. second pair of hands on the coupling" /></Field>
          <div className="flex gap-2">
            <Button type="submit" disabled={!chosen}>Call in</Button>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
          </div>
        </form>
      )}
    </section>
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

/** Chief Technician pairs an experienced colleague with the person doing the job (shadowing; both credited). */
function AdviserForm({ assignment }: { assignment: DataRow }) {
  const { faultId, done, fail } = useDetail();
  const people = useQuery({ queryKey: ["expertise", "people"], queryFn: () => api<Array<{ id: string; name: string; role_label: string; section: string; retirement_date: string | null }>>("/api/v1/expertise/people") });
  const [adviser, setAdviser] = useState(String(assignment.adviser_id || ""));

  async function save(event: FormEvent) {
    event.preventDefault();
    try {
      await api(`/api/v1/faults/${encodeURIComponent(faultId)}/assignments/${encodeURIComponent(String(assignment.id))}/adviser`, {
        method: "PATCH", body: JSON.stringify({ adviser_id: adviser || null }),
      });
      await done(adviser ? "Adviser paired with this job." : "Adviser removed.");
    } catch (reason) {
      fail(reason, "The adviser was not saved.");
    }
  }

  const options = (people.data ?? []).filter((person) => person.id !== assignment.assigned_user_id);
  return (
    <form onSubmit={save} className="flex flex-wrap items-end gap-3 rounded-lg border border-dashed border-border p-3">
      <Field label="Pair an experienced adviser (optional)" hint="Passes on know-how; both are credited when the job is done." className="min-w-[16rem] flex-1">
        <NativeSelect value={adviser} onChange={(event) => setAdviser(event.target.value)}>
          <option value="">No adviser</option>
          {options.map((person) => (
            <option key={person.id} value={person.id}>
              {person.name} · {person.role_label}{person.retirement_date ? ` · retires ${new Date(person.retirement_date).toLocaleDateString("en-GB", { month: "short", year: "numeric" })}` : ""}
            </option>
          ))}
        </NativeSelect>
      </Field>
      <Button type="submit" variant="outline">Save adviser</Button>
    </form>
  );
}

export function AssignmentPanel() {
  const { context, can, offline, user } = useDetail();
  if (!context.assignments.length) return null;
  const active = can.activeAssignment;
  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <p className="m-0 text-2xs font-extrabold uppercase tracking-[0.12em] text-muted-foreground">Sections</p>
            <CardTitle className="mt-1">Who has worked on it</CardTitle>
          </div>
          <span className="text-sm text-muted-foreground">{active ? `With ${String(active.section)}` : "Work finished"}</span>
        </div>
      </CardHeader>
      <CardContent className="grid gap-4">
        <ol className="m-0 grid list-none gap-2 p-0">
          {context.assignments.map((item, index) => (
            <li key={String(item.id)} className="grid gap-1 rounded-lg border border-border p-3 text-sm">
              <div className="flex items-center justify-between gap-2">
                <strong>{index + 1}. {String(item.section)}</strong>
                <Badge variant={statusVariant(String(item.status))}>{statusWords(String(item.status))}</Badge>
              </div>
              <small className="text-muted-foreground">
                {item.assigned_user_name ? `Taken by ${String(item.assigned_user_name)}` : "Nobody has taken it yet"} · {new Date(String(item.created_at)).toLocaleString()} · {String(item.elapsed_minutes)} min
              </small>
              {((item.helpers ?? []) as Array<{ name: string }>).length > 0 && (
                <p className="m-0"><strong>Helped by:</strong> {((item.helpers ?? []) as Array<{ name: string }>).map((helper) => helper.name).join(", ")}</p>
              )}
              {item.completion_review_status === "PENDING" && <p className="m-0 text-muted-foreground">Write-up waiting for the Chief Technician's check.</p>}
              {item.completion_review_status === "APPROVED" && <p className="m-0 text-muted-foreground">Write-up checked by the Chief Technician.</p>}
              {Boolean(item.reason) && <p className="m-0"><strong>Handoff reason:</strong> {String(item.reason)}</p>}
              {Boolean(item.instructions) && <p className="m-0"><strong>Chief Technician instructions:</strong> {String(item.instructions)}</p>}
              {Boolean(item.adviser_name) && <p className="m-0"><strong>Adviser:</strong> {String(item.adviser_name)}</p>}
              {Boolean(item.response_due_at) && <p className="m-0"><strong>Expected response:</strong> {new Date(String(item.response_due_at)).toLocaleString()}</p>}
              {Boolean(item.findings) && <p className="m-0"><strong>Findings:</strong> {String(item.findings)}</p>}
              {Boolean(item.recommendation) && <p className="m-0"><strong>Recommended next action:</strong> {String(item.recommendation)}</p>}
              {item.escalation_status === "RETURNED" && Boolean(item.escalation_review_comments) && <p className="m-0"><strong>Chief review:</strong> {String(item.escalation_review_comments)}</p>}
              {item.completion_review_status === "RETURNED" && Boolean(item.completion_review_comments) && <p className="m-0"><strong>Chief Technician asked for more:</strong> {String(item.completion_review_comments)}</p>}
            </li>
          ))}
        </ol>
        {/* These steps decide against current server state, so they are online-only. */}
        {!offline && can.returnedAssignment && <WriteUpNoteForm assignment={can.returnedAssignment} />}
        {!offline && can.canCheckWriteUp && can.reviewAssignment && <SectionReview assignment={can.reviewAssignment} kind="COMPLETION" />}
        {!offline && active && Boolean(active.assigned_user_id) && <HelpersPanel assignment={active} />}
        {!offline && active && can.canReviewSection && can.assetConfirmed && <AllocationForm key={String(active.id)} assignment={active} />}
        {!offline && active && canPairAdviser(user) && active.section === user.section && Boolean(active.assigned_user_id) && <AdviserForm key={`adviser-${String(active.id)}`} assignment={active} />}
        {!offline && active && can.canReviewSection && active.escalation_status === "PENDING" && <SectionReview assignment={active} kind="ESCALATION" />}
        {!offline && active && can.canEscalate && !can.awaitingChiefReview && can.assetConfirmed && (can.onTheJob || !can.canInvestigate) && <HandoffForm assignment={active} />}
      </CardContent>
    </Card>
  );
}
