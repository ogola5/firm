import { useQueryClient } from "@tanstack/react-query";
import { FileText, Printer } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { type User } from "../../auth";
import { Alert } from "../../components/ui/alert";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Card, CardContent } from "../../components/ui/card";
import { EmptyState, Page, PageHeader } from "../../components/ui/page";
import { shortEffect, spokenTime } from "../../lib/format";
import { OFFLINE_SAVED } from "../../lib/messages";
import { errorMessage } from "../../lib/query";
import { api, isOfflineError } from "../../offline/api";
import { queueFaultAction } from "../../offline/outbox";
import { EMPTY_JOBS, skippedProcedures, useMyJobs, type Job } from "./data";

function JobRow({ job, meta, children }: { job: Job; meta: ReactNode; children: ReactNode }) {
  return (
    <article className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-border bg-card px-5 py-4">
      <div className="grid min-w-0 gap-1">
        <strong className="text-lg">{job.equipment_tag} · {job.equipment_name}</strong>
        <span className="text-[15px] text-foreground/80">
          {job.symptom} · effect: {shortEffect(job.operational_impact).toLowerCase() || `${job.severity.toLowerCase()} priority`} · {job.reference}
        </span>
        <span className="text-sm text-muted-foreground">{meta}</span>
      </div>
      <div className="flex flex-wrap items-center gap-2">{children}</div>
    </article>
  );
}

function Section({ title, count, tone = "default", hint, children }: {
  title: string; count: number; tone?: "default" | "warning"; hint?: string; children: ReactNode;
}) {
  return (
    <section className="grid gap-3" aria-label={title}>
      <div>
        <h2 className="m-0 flex items-center gap-2 text-xl">{title} <Badge variant={tone === "warning" ? "warning" : "default"}>{count}</Badge></h2>
        {hint && <p className="m-0 mt-1 text-sm text-muted-foreground">{hint}</p>}
      </div>
      {children}
    </section>
  );
}

function PrintCardLink({ faultId }: { faultId: string }) {
  return (
    <Button variant="outline" asChild>
      <Link to={`/jobs/${encodeURIComponent(faultId)}/card`}><Printer /> Print job card</Link>
    </Button>
  );
}

/** A technician's desk: what to write up, what is assigned, what is waiting on others. */
export function MyJobs({ user }: { user: User }) {
  const queryClient = useQueryClient();
  const jobsQuery = useMyJobs(user);
  const jobs = jobsQuery.data?.data ?? EMPTY_JOBS;
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const skipped = new Set(skippedProcedures(user.id));
  const procedureReady = jobs.procedure_ready.filter((job) => !skipped.has(job.fault_id));

  async function take(job: Job) {
    setBusy(job.fault_id);
    setError("");
    try {
      await api(`/api/v1/faults/${encodeURIComponent(job.fault_id)}/action?action=acknowledge`, { method: "POST" });
      setMessage(`You have taken ${job.equipment_tag}. Print the job card before you go out.`);
    } catch (reason) {
      if (isOfflineError(reason)) {
        await queueFaultAction(user.id, job.fault_id, "acknowledge");
        setMessage(`${job.equipment_tag}: ${OFFLINE_SAVED}`);
      } else {
        setError(errorMessage(reason, "The job could not be taken."));
      }
    } finally {
      setBusy("");
      await queryClient.invalidateQueries({ queryKey: ["jobs"] });
    }
  }

  const nothing = !jobs.to_write_up.length && !jobs.assigned.length && !jobs.available.length && !jobs.waiting.length && !procedureReady.length;

  return (
    <Page>
      <PageHeader
        eyebrow={`${user.section || "Maintenance"} · ${user.role_label}`}
        title="My jobs"
        description="Write up visits while your notes are fresh. Print a job card before you go out."
      />
      <div className="mx-auto grid max-w-5xl gap-8">
        {jobsQuery.data?.fromCache && <Alert variant="warning">Offline: this is the list saved on this computer. Write-ups are kept and sent when you reconnect.</Alert>}
        {jobsQuery.isError && <Alert variant="destructive">Your jobs could not be loaded. Reconnect and try again.</Alert>}
        {message && <Alert variant="success">{message}</Alert>}
        {error && <Alert variant="destructive">{error}</Alert>}
        {jobsQuery.isLoading && <p className="text-muted-foreground">Loading your jobs…</p>}
        {jobsQuery.isSuccess && nothing && <EmptyState>Nothing is waiting for you. New jobs appear here when they are assigned to you.</EmptyState>}

        {jobs.to_write_up.length > 0 && (
          <Section title="To write up" count={jobs.to_write_up.length} tone="warning" hint="The times you enter are the times things happened, not when you type them.">
            {jobs.to_write_up.map((job) => (
              <JobRow key={job.fault_id} job={job} meta={<>You took it {spokenTime(job.acknowledged_at)}{job.seen_before ? ` · seen ${job.seen_before} time(s) before in 90 days` : ""}</>}>
                <Button asChild><Link to={`/jobs/${encodeURIComponent(job.fault_id)}/write-up`}>Write up visit</Link></Button>
                <PrintCardLink faultId={job.fault_id} />
              </JobRow>
            ))}
          </Section>
        )}

        {jobs.assigned.length > 0 && (
          <Section title="Assigned to you, not visited yet" count={jobs.assigned.length}>
            {jobs.assigned.map((job) => (
              <JobRow
                key={job.fault_id}
                job={job}
                meta={<>Assigned {spokenTime(job.assigned_at)}{job.response_due_at ? ` · respond by ${spokenTime(job.response_due_at)}` : ""}{job.instructions ? ` · “${job.instructions}”` : ""}</>}
              >
                <Button disabled={busy === job.fault_id} onClick={() => take(job)}>I'm taking this job</Button>
                <PrintCardLink faultId={job.fault_id} />
              </JobRow>
            ))}
          </Section>
        )}

        {jobs.available.length > 0 && (
          <Section title="New for Systems Automation" count={jobs.available.length} hint="Breakdowns nobody has taken yet. Systems Automation responds first.">
            {jobs.available.map((job) => (
              <JobRow key={job.fault_id} job={job} meta={<>Reported {spokenTime(job.reported_at)}{job.seen_via === "SCADA" ? " · seen on SCADA" : job.seen_via === "SITE_WALK" ? " · seen on a site walk" : ""}</>}>
                <Button disabled={busy === job.fault_id} onClick={() => take(job)}>Take this job</Button>
                <PrintCardLink faultId={job.fault_id} />
              </JobRow>
            ))}
          </Section>
        )}

        {procedureReady.length > 0 && (
          <Section title="Turn your fix into a procedure" count={procedureReady.length} hint="Signed off and working. We drafted it from your write-up; check it and send it.">
            {procedureReady.map((job) => (
              <JobRow key={job.fault_id} job={job} meta={<>Fixed · {job.reference}</>}>
                <Button asChild><Link to={`/jobs/${encodeURIComponent(job.fault_id)}/procedure`}><FileText /> Check the draft</Link></Button>
              </JobRow>
            ))}
          </Section>
        )}

        {jobs.waiting.length > 0 && (
          <Section title="Waiting for others" count={jobs.waiting.length}>
            <Card>
              <CardContent className="grid p-0">
                {jobs.waiting.map((job) => (
                  <div key={job.fault_id} className="flex flex-wrap justify-between gap-3 border-b border-border px-5 py-3.5 last:border-0">
                    <Link to={`/faults?mode=history&fault=${encodeURIComponent(job.fault_id)}`} className="font-bold text-foreground">{job.equipment_tag} · {job.equipment_name}</Link>
                    <span className="text-muted-foreground">{job.waiting_for}</span>
                  </div>
                ))}
              </CardContent>
            </Card>
          </Section>
        )}
      </div>
    </Page>
  );
}
