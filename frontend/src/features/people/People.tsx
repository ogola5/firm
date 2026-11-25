import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { type User } from "../../auth";
import { Alert } from "../../components/ui/alert";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../components/ui/card";
import { Field, Input, NativeSelect } from "../../components/ui/form-controls";
import { Page, PageHeader } from "../../components/ui/page";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../../components/ui/table";
import { companyEmail, newPassword, PASSWORD_HINT } from "../../lib/companyEmail";
import { spokenTime } from "../../lib/format";
import { type DataRow } from "../../lib/types";
import { errorMessage } from "../../lib/query";
import { api } from "../../offline/api";

const SECTIONS = ["Systems Automation", "Electrical", "Instrumentation", "Mechanical"];

export function PeopleSummary() {
  const { data } = useQuery({ queryKey: ["people", "summary"], queryFn: () => api<DataRow>("/api/v1/users/summary") });
  if (!data) return null;
  const sections = (data.by_section || {}) as Record<string, number>;
  return (
    <Card className="mt-4">
      <CardHeader>
        <CardTitle>Workforce summary · counts only</CardTitle>
        <CardDescription>{String(data.active_accounts)} active of {String(data.total_accounts)} synthetic demonstration accounts</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap gap-x-6 gap-y-2 text-sm text-muted-foreground">
        {Object.entries(sections).map(([section, count]) => <span key={section}>{section}: <strong className="text-foreground">{count}</strong></span>)}
      </CardContent>
    </Card>
  );
}

function AppraisalEvidence() {
  const [range, setRange] = useState({ start: "", end: "" });
  const [applied, setApplied] = useState({ start: "", end: "" });
  const appraisal = useQuery({
    queryKey: ["hr", "appraisal", applied],
    queryFn: () => {
      const params = new URLSearchParams();
      if (applied.start) params.set("start_date", applied.start);
      if (applied.end) params.set("end_date", applied.end);
      const suffix = params.toString();
      return api<DataRow>(`/api/v1/hr/appraisal${suffix ? `?${suffix}` : ""}`);
    },
  });
  const rows = (appraisal.data?.rows || []) as DataRow[];
  return (
    <Card className="mb-4">
      <CardHeader>
        <CardTitle>Maintenance contribution evidence</CardTitle>
        <CardDescription>Use this evidence with context; report volume is shown for reference only and does not earn recognition points.</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="mb-3 flex flex-wrap items-end gap-3">
          <Field label="From" className="w-44"><Input type="date" value={range.start} onChange={(event) => setRange({ ...range, start: event.target.value })} /></Field>
          <Field label="To" className="w-44"><Input type="date" value={range.end} onChange={(event) => setRange({ ...range, end: event.target.value })} /></Field>
          <Button variant="outline" onClick={() => setApplied(range)}>Apply period</Button>
        </div>
        {appraisal.isError && <Alert variant="destructive">Appraisal evidence is unavailable for this period.</Alert>}
        {appraisal.data && <>
          <p className="text-sm text-muted-foreground">{String(appraisal.data.data_type)} · {String(appraisal.data.point_definition)}</p>
          <Table>
            <TableHeader>
              <TableRow>
                {["Employee", "Role / section", "Reports*", "Diagnoses", "Successful / failed interventions", "Procedure updates approved", "Colleague reuses", "Mean ack / restore", "Illustrative points†"]
                  .map((heading) => <TableHead key={heading}>{heading}</TableHead>)}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((item) => (
                <TableRow key={String(item.employee_id)}>
                  <TableCell className="font-bold">{String(item.employee_name)}</TableCell>
                  <TableCell>{String(item.role)}<br /><span className="text-muted-foreground">{String(item.section || "Cross-section")}</span></TableCell>
                  <TableCell>{String(item.faults_reported_context_only)}</TableCell>
                  <TableCell>{String(item.diagnoses_recorded)}</TableCell>
                  <TableCell>{String(item.successful_interventions)} / {String(item.failed_interventions)}</TableCell>
                  <TableCell>{String(item.procedure_updates_approved)} / {String(item.procedure_updates_authored)}</TableCell>
                  <TableCell>{String(item.colleague_reuses)}</TableCell>
                  <TableCell>
                    {item.mean_acknowledgement_minutes == null ? "—" : `${String(item.mean_acknowledgement_minutes)} min`} / {item.mean_report_to_restore_hours == null ? "—" : `${String(item.mean_report_to_restore_hours)} h`}
                  </TableCell>
                  <TableCell>{String(item.illustrative_recognition_points)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <p className="mb-0 text-xs text-muted-foreground">* Context only, not rewarded. † Illustrative prototype weighting, not an approved KPC appraisal score.</p>
        </>}
      </CardContent>
    </Card>
  );
}

type EnrolmentRequest = {
  id: string; email: string; display_name: string; staff_number: string; job_title: string;
  requested_role: string; requested_role_label: string; requested_section: string; account_status: string;
  submitted_at: string | null; decided_at: string | null; decided_by: string | null; decision_note: string; warnings: string[];
};

function RequestRow({ request, roles, onDone }: { request: EnrolmentRequest; roles: DataRow[]; onDone: (message: string) => void }) {
  const [role, setRole] = useState(request.requested_role);
  const [section, setSection] = useState(request.requested_section);
  const [reason, setReason] = useState("");
  const [rejecting, setRejecting] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const sectionRequired = Boolean(roles.find((item) => item.code === role)?.section_required);

  async function decide(action: "approve" | "reject") {
    setBusy(true);
    setError("");
    try {
      await api(`/api/v1/enrolment/requests/${request.id}/${action}`, {
        method: "POST",
        body: JSON.stringify(action === "approve" ? { role, section: sectionRequired ? section : "" } : { reason }),
      });
      onDone(action === "approve" ? `Approved ${request.email}. They have been emailed and can sign in now.` : `Rejected ${request.email}. They have been told why.`);
    } catch (reason) {
      setError(errorMessage(reason, "The decision was not saved."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <article aria-label={`Request from ${request.email}`} className="grid gap-3 border-b border-border py-4 last:border-0">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <strong>{request.display_name}</strong> <span className="text-sm text-muted-foreground">· {request.email} · staff no. {request.staff_number}</span>
          <div className="text-sm text-muted-foreground">
            Asks for: <span className="font-semibold text-foreground">{request.requested_role_label}{request.requested_section ? ` — ${request.requested_section}` : ""}</span>
            {request.job_title ? ` · "${request.job_title}"` : ""}
          </div>
        </div>
        {request.submitted_at && <span className="text-xs text-muted-foreground">Email confirmed {spokenTime(request.submitted_at)}</span>}
      </div>
      {request.warnings.map((warning) => <Alert key={warning} variant="warning">{warning}</Alert>)}
      <p className="m-0 text-xs text-muted-foreground">Check the person against the staff list before approving. Their email has been confirmed; their job has not.</p>
      {!rejecting ? (
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Give access as" className="w-64">
            <NativeSelect value={role} onChange={(event) => setRole(event.target.value)}>
              {roles.map((item) => <option key={String(item.code)} value={String(item.code)}>{String(item.label)}</option>)}
            </NativeSelect>
          </Field>
          {sectionRequired && (
            <Field label="Section" className="w-52">
              <NativeSelect value={section} onChange={(event) => setSection(event.target.value)}>
                <option value="">Choose…</option>
                {SECTIONS.map((item) => <option key={item}>{item}</option>)}
              </NativeSelect>
            </Field>
          )}
          <Button disabled={busy || (sectionRequired && !section)} onClick={() => void decide("approve")}>Approve</Button>
          <Button variant="outline" disabled={busy} onClick={() => setRejecting(true)}>Reject…</Button>
        </div>
      ) : (
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Reason (the person will see it)" className="min-w-[18rem] flex-1">
            <Input value={reason} onChange={(event) => setReason(event.target.value)} />
          </Field>
          <Button variant="destructive" disabled={busy || reason.trim().length < 5} onClick={() => void decide("reject")}>Reject request</Button>
          <Button variant="ghost" onClick={() => setRejecting(false)}>Cancel</Button>
        </div>
      )}
      {error && <Alert variant="destructive">{error}</Alert>}
    </article>
  );
}

/** People who confirmed a KPC email and are waiting for a role and section. */
function AccountRequests({ roles, onDone }: { roles: DataRow[]; onDone: (message: string) => void }) {
  const queryClient = useQueryClient();
  const requests = useQuery({ queryKey: ["people", "requests"], queryFn: () => api<EnrolmentRequest[]>("/api/v1/enrolment/requests") });
  const waiting = (requests.data ?? []).filter((item) => item.account_status === "PENDING_APPROVAL");
  const rejected = (requests.data ?? []).filter((item) => item.account_status === "REJECTED");
  return (
    <Card className="mb-4">
      <CardHeader>
        <CardTitle>Account requests {waiting.length ? `(${waiting.length} waiting)` : ""}</CardTitle>
        <CardDescription>People enrol with their KPC email. You decide what they can do.</CardDescription>
      </CardHeader>
      <CardContent>
        {requests.isError && <Alert variant="destructive">{errorMessage(requests.error, "Requests could not be loaded.")}</Alert>}
        {requests.data && !waiting.length && <p className="m-0 text-sm text-muted-foreground">No requests waiting.</p>}
        {waiting.map((request) => (
          <RequestRow key={request.id} request={request} roles={roles} onDone={(message) => {
            onDone(message);
            void queryClient.invalidateQueries({ queryKey: ["people"] });
          }} />
        ))}
        {rejected.length > 0 && (
          <details className="mt-3 text-sm">
            <summary className="cursor-pointer font-semibold">Rejected requests ({rejected.length})</summary>
            <ul className="mt-2 grid gap-1 pl-4">
              {rejected.map((item) => <li key={item.id}>{item.email}: {item.decision_note}{item.decided_by ? ` (${item.decided_by})` : ""}</li>)}
            </ul>
          </details>
        )}
      </CardContent>
    </Card>
  );
}

const accountSchema = z.object({
  display_name: z.string().trim().min(2, "Enter the person's full name"),
  email: companyEmail,
  staff_number: z.string().trim(),
  role: z.string().min(1, "Choose a role"),
  section: z.string(),
  password: newPassword,
});
type AccountValues = z.input<typeof accountSchema>;

function CreateAccount({ roles, onCreated }: { roles: DataRow[]; onCreated: (message: string) => void }) {
  const { register, handleSubmit, watch, reset, formState: { errors, isSubmitting } } = useForm<AccountValues>({
    resolver: zodResolver(accountSchema),
    defaultValues: { display_name: "", email: "", staff_number: "", role: "technician_st", section: "Electrical", password: "" },
  });
  const [error, setError] = useState("");
  const sectionRequired = Boolean(roles.find((item) => item.code === watch("role"))?.section_required);

  async function submit(values: AccountValues) {
    const parsed = accountSchema.parse(values);
    setError("");
    try {
      const result = await api<DataRow>("/api/v1/users", {
        method: "POST",
        body: JSON.stringify({ ...parsed, section: sectionRequired ? parsed.section : "" }),
      });
      reset({ ...values, display_name: "", email: "", staff_number: "", password: "" });
      onCreated(`Created ${String(result.email)} as ${String(result.role_label)}. Give them the temporary password separately.`);
    } catch (reason) {
      setError(errorMessage(reason, "Account creation failed."));
    }
  }

  return (
    <details className="mb-4 rounded-lg border border-border bg-card">
      <summary className="cursor-pointer px-5 py-4 font-bold">Create an account directly</summary>
      <div className="px-5 pb-5">
        <p className="mt-0 text-sm text-muted-foreground">For someone who cannot enrol themselves. Normally people enrol with their KPC email and you approve them above.</p>
        <form className="grid gap-3" onSubmit={handleSubmit(submit)} noValidate>
          <div className="grid gap-3 md:grid-cols-3">
            <Field label="Full name" error={errors.display_name?.message}><Input aria-invalid={Boolean(errors.display_name)} {...register("display_name")} /></Field>
            <Field label="KPC email" error={errors.email?.message}><Input type="email" aria-invalid={Boolean(errors.email)} {...register("email")} /></Field>
            <Field label="Staff number"><Input {...register("staff_number")} /></Field>
            <Field label="Role" error={errors.role?.message}>
              <NativeSelect {...register("role")}>{roles.map((item) => <option key={String(item.code)} value={String(item.code)}>{String(item.label)}</option>)}</NativeSelect>
            </Field>
            {sectionRequired && (
              <Field label="Section"><NativeSelect {...register("section")}>{SECTIONS.map((item) => <option key={item}>{item}</option>)}</NativeSelect></Field>
            )}
            <Field label="Temporary password" hint={PASSWORD_HINT} error={errors.password?.message}><Input type="password" aria-invalid={Boolean(errors.password)} {...register("password")} /></Field>
          </div>
          {error && <Alert variant="destructive">{error}</Alert>}
          <Button type="submit" className="justify-self-start" disabled={isSubmitting}>Create account</Button>
        </form>
      </div>
    </details>
  );
}

export function People({ user, compact = false }: { user: User; compact?: boolean }) {
  const isAdmin = user.role === "system_administrator";
  const queryClient = useQueryClient();
  const [message, setMessage] = useState("");

  const people = useQuery({ queryKey: ["people", "directory"], queryFn: () => api<DataRow[]>("/api/v1/users") });
  const roles = useQuery({ queryKey: ["access", "roles"], queryFn: () => api<DataRow[]>("/api/v1/access/roles"), enabled: isAdmin });

  const toggleActive = useMutation({
    mutationFn: (person: DataRow) => api(`/api/v1/users/${String(person.id)}/status`, {
      method: "PATCH", body: JSON.stringify({ active: !person.active }),
    }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["people"] }),
  });

  const content = (
    <>
      {user.role === "hr_officer" && <AppraisalEvidence />}
      {isAdmin && (
        <AccountRequests roles={roles.data ?? []} onDone={setMessage} />
      )}
      {isAdmin && (
        <CreateAccount
          roles={roles.data ?? []}
          onCreated={(text) => {
            setMessage(text);
            void queryClient.invalidateQueries({ queryKey: ["people"] });
          }}
        />
      )}
      {message && <Alert variant="success" className="mb-3">{message}</Alert>}
      {people.isError && <Alert variant="destructive" className="mb-3">The people directory is not available for this role.</Alert>}
      {toggleActive.isError && <Alert variant="destructive" className="mb-3">{errorMessage(toggleActive.error, "Status update failed.")}</Alert>}
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead><TableHead>KPC email</TableHead><TableHead>Role</TableHead><TableHead>Section</TableHead><TableHead>Status</TableHead>
                {isAdmin && <TableHead>Last signed in</TableHead>}
                {isAdmin && <TableHead>Action</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {(people.data ?? []).map((person) => (
                <TableRow key={String(person.id)}>
                  <TableCell className="font-bold">{String(person.display_name)}</TableCell>
                  <TableCell>{String(person.email ?? person.username)}</TableCell>
                  <TableCell>{String(person.role_label)}</TableCell>
                  <TableCell>{String(person.section || "—")}</TableCell>
                  <TableCell><Badge variant={person.active ? "success" : "outline"}>{person.active ? "Active" : "Inactive"}</Badge></TableCell>
                  {isAdmin && <TableCell className="text-muted-foreground">{person.last_login_at ? spokenTime(String(person.last_login_at)) : "Never"}</TableCell>}
                  {isAdmin && (
                    <TableCell>
                      <Button variant="outline" size="sm" disabled={toggleActive.isPending} onClick={() => toggleActive.mutate(person)}>
                        {person.active ? "Deactivate" : "Reactivate"}
                      </Button>
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </>
  );

  if (compact) return content;
  return (
    <Page>
      <PageHeader
        eyebrow={user.role === "hr_officer" ? "People and appraisal evidence" : "Role-based access"}
        title={isAdmin ? "User management" : "People directory"}
        description={user.role === "hr_officer"
          ? "Contribution evidence is attributed to employees; HR does not receive individual fault narratives."
          : "Names, roles, section membership and account status only."}
      />
      {content}
    </Page>
  );
}
