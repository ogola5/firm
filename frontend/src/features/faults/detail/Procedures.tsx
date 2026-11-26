import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { Button } from "../../../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../../components/ui/card";
import { Field, Input, Textarea } from "../../../components/ui/form-controls";
import { api } from "../../../offline/api";
import { useDetail, type Revision } from "./context";

const procedureSchema = z.object({
  title: z.string().trim().min(3, "Give the procedure a title"),
  observed_symptom: z.string().trim().min(1, "Describe the symptom"),
  confirmed_cause: z.string().trim().min(1, "State the confirmed cause"),
  diagnostic_procedure: z.string().trim().min(1, "Describe how to diagnose it"),
  corrective_action: z.string().trim().min(1, "Describe the corrective action"),
  safety: z.string().trim(),
  tools_materials: z.string().trim(),
  change_reason: z.string().trim(),
});
type ProcedureValues = z.infer<typeof procedureSchema>;
const EMPTY: ProcedureValues = { title: "", observed_symptom: "", confirmed_cause: "", diagnostic_procedure: "", corrective_action: "", safety: "", tools_materials: "", change_reason: "" };

export function ProcedureForm({ revision, onDone }: { revision: Revision; onDone: () => void }) {
  const { faultId, can, offline, done, fail } = useDetail();
  const { register, handleSubmit, reset, setError, formState: { errors, isSubmitting } } = useForm<ProcedureValues>({
    resolver: zodResolver(procedureSchema), defaultValues: EMPTY,
  });

  // Revising prefills the form from the version being revised.
  useEffect(() => {
    if (!revision) return;
    reset({
      title: String(revision.values.title ?? ""),
      observed_symptom: String(revision.values.observed_symptom ?? ""),
      confirmed_cause: String(revision.values.confirmed_cause ?? ""),
      diagnostic_procedure: String(revision.values.diagnostic_procedure ?? ""),
      corrective_action: String(revision.values.corrective_action ?? ""),
      safety: String(revision.values.safety ?? ""),
      tools_materials: String(revision.values.tools_materials ?? ""),
      change_reason: "",
    });
  }, [revision, reset]);

  if (!can.canSubmitProcedure || offline) return null;

  async function submit(values: ProcedureValues) {
    if (revision && values.change_reason.length < 5) {
      setError("change_reason", { message: "Say what this version changes and why" });
      return;
    }
    const path = revision
      ? `/api/v1/procedure-updates/${encodeURIComponent(revision.id)}/revisions`
      : `/api/v1/faults/${encodeURIComponent(faultId)}/procedure-updates`;
    try {
      await api(path, { method: "POST", body: JSON.stringify(values) });
      reset(EMPTY);
      onDone();
      await done(revision ? "A new immutable procedure version has been submitted." : "Work-procedure update submitted for chief technical review.");
    } catch (reason) {
      fail(reason, "Work-procedure update could not be submitted.");
    }
  }

  return (
    <Card>
      <form onSubmit={handleSubmit(submit)} noValidate>
        <CardHeader>
          <CardTitle>{revision ? "Submit a new procedure version" : "Update the reusable work procedure"}</CardTitle>
          {revision && <CardDescription>Editing creates a new version; the prior version and review comments remain in the history.</CardDescription>}
        </CardHeader>
        <CardContent className="grid gap-3">
          <div className="grid gap-3 md:grid-cols-3">
            <Field label="Procedure title" error={errors.title?.message}><Input {...register("title")} /></Field>
            <Field label="Observed symptom" error={errors.observed_symptom?.message}><Input {...register("observed_symptom")} /></Field>
            <Field label="Confirmed cause" error={errors.confirmed_cause?.message}><Input {...register("confirmed_cause")} /></Field>
          </div>
          <Field label="Diagnostic procedure" error={errors.diagnostic_procedure?.message}><Textarea {...register("diagnostic_procedure")} /></Field>
          <Field label="Corrective action" error={errors.corrective_action?.message}><Textarea {...register("corrective_action")} /></Field>
          <Field label="Tools and parts"><Textarea rows={2} {...register("tools_materials")} /></Field>
          <Field label="Safety notes"><Textarea {...register("safety")} /></Field>
          {revision && (
            <Field label="What changed and why" hint="Reviewers and future readers see this next to the comparison." error={errors.change_reason?.message}>
              <Textarea rows={2} placeholder="e.g. added the vibration acceptance limit the chief asked for" {...register("change_reason")} />
            </Field>
          )}
          <Button type="submit" className="justify-self-start" disabled={isSubmitting}>{revision ? "Submit revision" : "Submit for chief technical review"}</Button>
        </CardContent>
      </form>
    </Card>
  );
}

export function ReuseRecords() {
  const { user, context, can, done, fail } = useDetail();
  if (!context.reuse_records.length) return null;
  const restored = ["RESTORED", "CLOSED"].includes(can.status);

  async function confirm(reuseId: string, outcome: "SUCCESS" | "FAILED") {
    try {
      await api(`/api/v1/procedure-reuse/${encodeURIComponent(reuseId)}/outcome`, { method: "POST", body: JSON.stringify({ outcome }) });
      await done(`Procedure reuse confirmed as ${outcome.toLowerCase()}.`);
    } catch (reason) {
      fail(reason, "Procedure outcome could not be confirmed.");
    }
  }

  const unresolved = context.reuse_records.filter((item) => item.actor_id === user.id && !item.outcome);
  return (
    <Card>
      <CardHeader><CardTitle>Procedure reuse and outcome confirmation</CardTitle></CardHeader>
      <CardContent className="grid gap-3">
        {context.reuse_records.map((item) => (
          <div key={String(item.id)} className="grid gap-1 border-t border-border pt-3 text-sm first:border-0 first:pt-0">
            <strong>{String(item.procedure_reference)} · {String(item.procedure_title)}</strong>
            <small className="text-muted-foreground">Used by {String(item.actor_name)} · {new Date(String(item.used_at)).toLocaleString()}</small>
            {item.outcome
              ? <p className="m-0">Confirmed {String(item.outcome).toLowerCase()} by colleague.</p>
              : item.actor_id === user.id && restored && (
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" onClick={() => confirm(String(item.id), "SUCCESS")}>Confirm helpful</Button>
                  <Button size="sm" variant="outline" onClick={() => confirm(String(item.id), "FAILED")}>Confirm not helpful</Button>
                </div>
              )}
          </div>
        ))}
        {unresolved.length > 0 && !restored && <p className="m-0 text-sm text-muted-foreground">Confirm whether the referenced procedure helped after the fault is restored.</p>}
      </CardContent>
    </Card>
  );
}
