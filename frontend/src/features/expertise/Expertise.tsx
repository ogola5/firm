import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { useSearchParams } from "react-router-dom";
import { can, type User } from "../../auth";
import { Alert } from "../../components/ui/alert";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../components/ui/card";
import { ChoiceButtons } from "../../components/ui/choice";
import { Field, Input, NativeSelect, Textarea } from "../../components/ui/form-controls";
import { Page, PageHeader } from "../../components/ui/page";
import { spokenTime } from "../../lib/format";
import { errorMessage } from "../../lib/query";
import { api } from "../../offline/api";

const SECTIONS = ["Systems Automation", "Electrical", "Instrumentation", "Mechanical"];

type RiskRow = {
  section: string; equipment_type: string; equipment_type_name: string; level: "HIGH" | "MEDIUM" | "LOW"; share_retiring: number;
  successful_fixes: number; other_fixers: number; procedures: number; expert_sessions: number;
  experts: Array<{ user_id: string; name: string; retirement_date: string; fixes: number }>; reasons: string[]; suggestion: string;
};
type Session = {
  id: string; title: string; equipment_type: string; equipment_type_name: string; section: string; expert: string; scribe: string;
  how_it_fails: string; first_checks: string; what_fools_people: string; tricks: string; parts: string; safety: string;
  status: "SUBMITTED" | "APPROVED" | "RETURNED"; reviewer: string; review_note: string; created_at: string; credit: string;
};
type Question = {
  id: string; equipment_type: string; equipment_type_name: string; section: string; asked_by: string; text: string; status: string; created_at: string;
  answers: Array<{ id: string; author: string; text: string; accepted: boolean; can_accept: boolean; created_at: string }>;
};
type Person = { id: string; name: string; role_label: string; section: string; retirement_date: string | null };
type EquipmentType = { code: string; name: string; section: string; count: number };

type Tab = "risk" | "sessions" | "ask" | "retirement";

function AtRisk({ user }: { user: User }) {
  const risk = useQuery({ queryKey: ["expertise", "at-risk"], queryFn: () => api<{ rows: RiskRow[]; scope: string; rule: string }>("/api/v1/expertise/at-risk") });
  return (
    <Card>
      <CardHeader>
        <CardTitle>Knowledge at risk · {risk.data?.scope ?? user.access.scope}</CardTitle>
        <CardDescription>{risk.data?.rule}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-0 pt-0">
        {risk.isError && <Alert variant="destructive">{errorMessage(risk.error, "Not available.")}</Alert>}
        {risk.data && !risk.data.rows.length && <p className="m-0 text-sm text-muted-foreground">No equipment depends mainly on people retiring soon. (HR sets retirement dates.)</p>}
        {risk.data?.rows.map((row) => (
          <article key={`${row.section}-${row.equipment_type}`} aria-label={`${row.equipment_type_name} in ${row.section}`} className="grid gap-1 border-b border-border py-3 text-sm last:border-0">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <strong>{row.equipment_type_name} <span className="font-normal text-muted-foreground">· {row.section}</span></strong>
              <Badge variant={row.level === "HIGH" ? "destructive" : row.level === "MEDIUM" ? "warning" : "success"} className="normal-case">
                {row.level === "HIGH" ? "High risk" : row.level === "MEDIUM" ? "Some risk" : "Covered"}
              </Badge>
            </div>
            {row.reasons.map((reason) => <span key={reason}>{reason}</span>)}
            <span className="font-semibold">{row.suggestion}</span>
          </article>
        ))}
      </CardContent>
    </Card>
  );
}

function SessionCard({ session, onReview }: { session: Session; onReview?: (decision: "APPROVE" | "RETURN", note: string) => void }) {
  const [note, setNote] = useState("");
  const rows: Array<[string, string]> = [
    ["How it usually fails", session.how_it_fails], ["First checks", session.first_checks], ["What fools people", session.what_fools_people],
    ["Tricks", session.tricks], ["Parts to take", session.parts], ["Safety", session.safety],
  ];
  return (
    <article aria-label={session.title} className="grid gap-2 border-b border-border py-4 text-sm last:border-0">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <strong className="text-base">{session.title}</strong>
        <Badge variant={session.status === "APPROVED" ? "success" : session.status === "RETURNED" ? "destructive" : "warning"} className="normal-case">
          {session.status === "APPROVED" ? "In the library" : session.status === "RETURNED" ? "Returned" : "Waiting for chief"}
        </Badge>
      </div>
      <span className="text-muted-foreground">{session.equipment_type_name} · {session.section} · {session.credit} · written up by {session.scribe}</span>
      <dl className="m-0 grid gap-1">
        {rows.filter(([, text]) => text).map(([label, text]) => (
          <div key={label} className="grid gap-0.5 sm:grid-cols-[10rem_1fr]"><dt className="font-semibold">{label}</dt><dd className="m-0 whitespace-pre-line">{text}</dd></div>
        ))}
      </dl>
      {session.status === "RETURNED" && session.review_note && <Alert variant="warning">Returned by {session.reviewer}: {session.review_note}</Alert>}
      {onReview && (
        <div className="flex flex-wrap items-end gap-2">
          <Field label="Note (needed to return)" className="min-w-[16rem] flex-1"><Input value={note} onChange={(event) => setNote(event.target.value)} /></Field>
          <Button onClick={() => onReview("APPROVE", note)}>Approve into the library</Button>
          <Button variant="outline" onClick={() => onReview("RETURN", note)}>Return</Button>
        </div>
      )}
    </article>
  );
}

function NewSession({ user, onSaved }: { user: User; onSaved: () => void }) {
  const people = useQuery({ queryKey: ["expertise", "people"], queryFn: () => api<Person[]>("/api/v1/expertise/people") });
  const types = useQuery({ queryKey: ["expertise", "types"], queryFn: () => api<EquipmentType[]>("/api/v1/expertise/types") });
  const [form, setForm] = useState({ expert_id: "", equipment_type: "", section: user.section || "", title: "", how_it_fails: "", first_checks: "",
    what_fools_people: "", tricks: "", parts: "", safety: "" });
  const [error, setError] = useState("");
  const set = (key: keyof typeof form) => (event: { target: { value: string } }) => setForm({ ...form, [key]: event.target.value });
  const typeOptions = (types.data ?? []).filter((item) => !form.section || item.section === form.section);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    try {
      await api("/api/v1/expertise/sessions", { method: "POST", body: JSON.stringify(form) });
      setForm({ ...form, title: "", how_it_fails: "", first_checks: "", what_fools_people: "", tricks: "", parts: "", safety: "" });
      onSaved();
    } catch (reason) {
      setError(errorMessage(reason, "Not saved."));
    }
  }

  return (
    <details className="rounded-lg border border-border bg-card">
      <summary className="cursor-pointer px-5 py-4 font-bold">Write up an expert session</summary>
      <form onSubmit={submit} className="grid gap-3 px-5 pb-5" noValidate>
        <p className="m-0 text-sm text-muted-foreground">Sit with an experienced colleague for about 30 minutes on one type of equipment. They talk; you write. Their name stays on it.</p>
        <div className="grid gap-3 md:grid-cols-3">
          <Field label="Expert">
            <NativeSelect value={form.expert_id} onChange={set("expert_id")}>
              <option value="">Choose…</option>
              {people.data?.map((person) => (
                <option key={person.id} value={person.id}>{person.name} · {person.role_label}{person.retirement_date ? ` · retires ${new Date(person.retirement_date).toLocaleDateString("en-GB", { month: "short", year: "numeric" })}` : ""}</option>
              ))}
            </NativeSelect>
          </Field>
          <Field label="Section">
            <NativeSelect value={form.section} onChange={(event) => setForm({ ...form, section: event.target.value, equipment_type: "" })}>
              <option value="">Choose…</option>
              {SECTIONS.map((item) => <option key={item}>{item}</option>)}
            </NativeSelect>
          </Field>
          <Field label="Equipment type">
            <NativeSelect value={form.equipment_type} onChange={set("equipment_type")}>
              <option value="">Choose…</option>
              {typeOptions.map((item) => <option key={`${item.code}-${item.section}`} value={item.code}>{item.name} ({item.code})</option>)}
            </NativeSelect>
          </Field>
        </div>
        <Field label="Title"><Input value={form.title} onChange={set("title")} placeholder="For example: RTUs: why they drop off SCADA" /></Field>
        <div className="grid gap-3 md:grid-cols-2">
          <Field label="How it usually fails"><Textarea value={form.how_it_fails} onChange={set("how_it_fails")} /></Field>
          <Field label="First checks, in order"><Textarea value={form.first_checks} onChange={set("first_checks")} /></Field>
          <Field label="What fools people (optional)"><Textarea value={form.what_fools_people} onChange={set("what_fools_people")} /></Field>
          <Field label="Tricks (optional)"><Textarea value={form.tricks} onChange={set("tricks")} /></Field>
          <Field label="Parts to take (optional)"><Input value={form.parts} onChange={set("parts")} /></Field>
          <Field label="Safety (optional)"><Input value={form.safety} onChange={set("safety")} /></Field>
        </div>
        {error && <Alert variant="destructive">{error}</Alert>}
        <Button type="submit" className="justify-self-start">Send to the section chief</Button>
      </form>
    </details>
  );
}

function Sessions({ user }: { user: User }) {
  const queryClient = useQueryClient();
  const approved = useQuery({ queryKey: ["expertise", "sessions", "APPROVED"], queryFn: () => api<Session[]>("/api/v1/expertise/sessions?status=APPROVED") });
  const waiting = useQuery({ queryKey: ["expertise", "sessions", "SUBMITTED"], queryFn: () => api<Session[]>("/api/v1/expertise/sessions?status=SUBMITTED") });
  const [message, setMessage] = useState("");
  const review = useMutation({
    mutationFn: ({ id, decision, note }: { id: string; decision: string; note: string }) =>
      api(`/api/v1/expertise/sessions/${id}/review`, { method: "POST", body: JSON.stringify({ decision, note }) }),
    onSuccess: () => { setMessage("Decision saved."); void queryClient.invalidateQueries({ queryKey: ["expertise"] }); },
  });
  return (
    <div className="grid gap-4">
      {can(user, "expertise.contribute") && <NewSession user={user} onSaved={() => { setMessage("Sent to the section chief."); void queryClient.invalidateQueries({ queryKey: ["expertise"] }); }} />}
      {message && <Alert variant="success">{message}</Alert>}
      {review.isError && <Alert variant="destructive">{errorMessage(review.error, "Not saved.")}</Alert>}
      {(waiting.data ?? []).length > 0 && (
        <Card>
          <CardHeader><CardTitle>Waiting for review</CardTitle></CardHeader>
          <CardContent className="pt-0">
            {waiting.data!.map((session) => (
              <SessionCard key={session.id} session={session}
                onReview={can(user, "expertise.review") && session.section === user.section
                  ? (decision, note) => review.mutate({ id: session.id, decision, note }) : undefined} />
            ))}
          </CardContent>
        </Card>
      )}
      <Card>
        <CardHeader><CardTitle>In the library</CardTitle><CardDescription>Shared with every section. Also shown on the job card for that type of equipment.</CardDescription></CardHeader>
        <CardContent className="pt-0">
          {approved.data && !approved.data.length && <p className="m-0 text-sm text-muted-foreground">No expert sessions yet.</p>}
          {approved.data?.map((session) => <SessionCard key={session.id} session={session} />)}
        </CardContent>
      </Card>
    </div>
  );
}

function Ask({ user }: { user: User }) {
  const queryClient = useQueryClient();
  const questions = useQuery({ queryKey: ["expertise", "questions"], queryFn: () => api<Question[]>("/api/v1/expertise/questions") });
  const types = useQuery({ queryKey: ["expertise", "types"], queryFn: () => api<EquipmentType[]>("/api/v1/expertise/types") });
  const [form, setForm] = useState({ equipment_type: "", section: user.section || "", text: "" });
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["expertise", "questions"] });

  async function run(action: () => Promise<unknown>) {
    setError("");
    try {
      await action();
      await refresh();
    } catch (reason) {
      setError(errorMessage(reason, "Not saved."));
    }
  }

  return (
    <div className="grid gap-4">
      {can(user, "expertise.contribute") && (
        <Card>
          <CardHeader><CardTitle>Ask the experts</CardTitle><CardDescription>Experienced colleagues answer; the answer that solved it is marked and kept.</CardDescription></CardHeader>
          <CardContent>
            <form className="grid gap-3" onSubmit={(event) => { event.preventDefault(); void run(async () => { await api("/api/v1/expertise/questions", { method: "POST", body: JSON.stringify(form) }); setForm({ ...form, text: "" }); }); }}>
              <div className="grid gap-3 md:grid-cols-2">
                <Field label="Section">
                  <NativeSelect value={form.section} onChange={(event) => setForm({ ...form, section: event.target.value, equipment_type: "" })}>
                    <option value="">Choose…</option>
                    {SECTIONS.map((item) => <option key={item}>{item}</option>)}
                  </NativeSelect>
                </Field>
                <Field label="Equipment type">
                  <NativeSelect value={form.equipment_type} onChange={(event) => setForm({ ...form, equipment_type: event.target.value })}>
                    <option value="">Choose…</option>
                    {(types.data ?? []).filter((item) => !form.section || item.section === form.section).map((item) => <option key={`${item.code}-${item.section}`} value={item.code}>{item.name} ({item.code})</option>)}
                  </NativeSelect>
                </Field>
              </div>
              <Field label="Your question"><Textarea value={form.text} onChange={(event) => setForm({ ...form, text: event.target.value })} /></Field>
              <Button type="submit" className="justify-self-start" disabled={!form.equipment_type || !form.section || form.text.trim().length < 10}>Ask</Button>
            </form>
          </CardContent>
        </Card>
      )}
      {error && <Alert variant="destructive">{error}</Alert>}
      <Card>
        <CardHeader><CardTitle>Questions</CardTitle></CardHeader>
        <CardContent className="pt-0">
          {questions.data && !questions.data.length && <p className="m-0 text-sm text-muted-foreground">No questions yet.</p>}
          {questions.data?.map((question) => (
            <article key={question.id} aria-label={question.text} className="grid gap-2 border-b border-border py-4 text-sm last:border-0">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <strong>{question.text}</strong>
                <Badge variant={question.status === "ANSWERED" ? "success" : "warning"} className="normal-case">{question.status === "ANSWERED" ? "Solved" : "Open"}</Badge>
              </div>
              <span className="text-muted-foreground">{question.equipment_type_name} · {question.section} · asked by {question.asked_by} · {spokenTime(question.created_at)}</span>
              {question.answers.map((answer) => (
                <div key={answer.id} className={`grid gap-1 rounded-md border p-3 ${answer.accepted ? "border-success/50 bg-success/5" : "border-border"}`}>
                  <span>{answer.text}</span>
                  <span className="text-xs text-muted-foreground">{answer.accepted ? "✓ Solved it · " : ""}{answer.author} · {spokenTime(answer.created_at)}</span>
                  {answer.can_accept && (
                    <Button size="sm" variant="outline" className="justify-self-start"
                      onClick={() => void run(() => api(`/api/v1/expertise/answers/${answer.id}/accept`, { method: "POST" }))}>This solved it</Button>
                  )}
                </div>
              ))}
              {question.status === "OPEN" && can(user, "expertise.contribute") && (
                <div className="flex flex-wrap items-end gap-2">
                  <Field label="Your answer" className="min-w-[16rem] flex-1">
                    <Input value={answers[question.id] ?? ""} onChange={(event) => setAnswers({ ...answers, [question.id]: event.target.value })} />
                  </Field>
                  <Button variant="outline" disabled={(answers[question.id] ?? "").trim().length < 5}
                    onClick={() => void run(async () => {
                      await api(`/api/v1/expertise/questions/${question.id}/answers`, { method: "POST", body: JSON.stringify({ text: answers[question.id] }) });
                      setAnswers({ ...answers, [question.id]: "" });
                    })}>Answer</Button>
                </div>
              )}
            </article>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

function Retirements() {
  const queryClient = useQueryClient();
  const people = useQuery({ queryKey: ["expertise", "people"], queryFn: () => api<Person[]>("/api/v1/expertise/people") });
  const [dates, setDates] = useState<Record<string, string>>({});
  const [message, setMessage] = useState("");
  async function save(person: Person) {
    const value = dates[person.id] ?? person.retirement_date ?? "";
    await api(`/api/v1/users/${person.id}/retirement`, { method: "PATCH", body: JSON.stringify({ retirement_date: value || null }) });
    setMessage(`Saved for ${person.name}.`);
    await queryClient.invalidateQueries({ queryKey: ["expertise"] });
  }
  return (
    <Card>
      <CardHeader><CardTitle>Retirement dates</CardTitle><CardDescription>Used only to find knowledge that should be captured before someone leaves.</CardDescription></CardHeader>
      <CardContent className="grid gap-2 pt-0">
        {message && <Alert variant="success">{message}</Alert>}
        {people.data?.map((person) => (
          <div key={person.id} className="flex flex-wrap items-end gap-3 border-b border-border py-2 text-sm last:border-0">
            <span className="min-w-[16rem] flex-1"><strong>{person.name}</strong><br /><span className="text-muted-foreground">{person.role_label} · {person.section}</span></span>
            <Input type="date" aria-label={`Retirement date for ${person.name}`} className="w-44" value={dates[person.id] ?? person.retirement_date ?? ""}
              onChange={(event) => setDates({ ...dates, [person.id]: event.target.value })} />
            <Button size="sm" variant="outline" onClick={() => void save(person)}>Save</Button>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

/** Capture what experienced (and retiring) staff know, and share it. */
export function Expertise({ user }: { user: User }) {
  const [params, setParams] = useSearchParams();
  const tabs = [
    { value: "risk" as const, label: "Knowledge at risk" },
    ...(user.role !== "hr_officer" ? [{ value: "sessions" as const, label: "Expert sessions" }, { value: "ask" as const, label: "Ask the expert" }] : []),
    ...(can(user, "people.retirement") ? [{ value: "retirement" as const, label: "Retirement dates" }] : []),
  ];
  const tab = (tabs.find((item) => item.value === params.get("tab"))?.value ?? "risk") as Tab;
  return (
    <Page>
      <PageHeader eyebrow={`${user.access.level} · ${user.access.scope}`} title="Expert knowledge"
        description="What experienced colleagues know, written down before it retires with them. Their names stay on it." />
      <ChoiceButtons label="Expert knowledge pages" options={tabs} value={tab} onChange={(value) => setParams({ tab: value })} className="mb-4" />
      {tab === "risk" && <AtRisk user={user} />}
      {tab === "sessions" && <Sessions user={user} />}
      {tab === "ask" && <Ask user={user} />}
      {tab === "retirement" && <Retirements />}
    </Page>
  );
}
