import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { Button } from "../../../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../../../components/ui/card";
import { Field, Input, NativeSelect, Textarea } from "../../../components/ui/form-controls";
import { OFFLINE_SAVED } from "../../../lib/messages";
import { api, isOfflineError } from "../../../offline/api";
import { queueDiagnosis, queueIntervention } from "../../../offline/outbox";
import { useDetail } from "./context";

// Same rules as the server, checked first so offline-queued records are valid when they sync.
const diagnosisSchema = z.object({
  possible_cause: z.string().trim().min(1, "A possible cause is required"),
  diagnostic_method: z.string().trim().min(1, "A diagnostic method is required"),
  observations: z.string().trim(),
  test_results: z.string().trim(),
  confidence: z.string().refine((value) => value === "" || (Number(value) >= 0 && Number(value) <= 1), "Use a value between 0 and 1"),
  quick_check: z.string().trim(),
  fix_summary: z.string().trim(),
  risk_level: z.enum(["Normal", "Caution", "High"]),
  workaround: z.boolean(),
}).refine((values) => values.risk_level !== "High" || values.fix_summary, {
  message: "A recommended fix is required for a high-risk diagnosis",
  path: ["fix_summary"],
});
type DiagnosisValues = z.infer<typeof diagnosisSchema>;

const interventionSchema = z.object({
  diagnosis_id: z.string(),
  corrective_action: z.string().trim().min(1, "A corrective action is required"),
  tools_materials: z.string().trim(),
  outcome: z.enum(["SUCCESS", "FAILED", "IN_PROGRESS"]),
  notes: z.string().trim(),
});
type InterventionValues = z.infer<typeof interventionSchema>;

const DIAGNOSIS_DEFAULTS: DiagnosisValues = {
  possible_cause: "", diagnostic_method: "", observations: "", test_results: "", confidence: "",
  quick_check: "", fix_summary: "", risk_level: "Normal", workaround: false,
};
const INTERVENTION_DEFAULTS: InterventionValues = { diagnosis_id: "", corrective_action: "", tools_materials: "", outcome: "SUCCESS", notes: "" };

function DiagnosisForm() {
  const { user, faultId, done, fail } = useDetail();
  const { register, handleSubmit, reset, formState: { errors, isSubmitting } } = useForm<DiagnosisValues>({
    resolver: zodResolver(diagnosisSchema), defaultValues: DIAGNOSIS_DEFAULTS,
  });
  async function submit(values: DiagnosisValues) {
    const body = { ...values, confidence: values.confidence === "" ? null : Number(values.confidence) };
    try {
      await api(`/api/v1/faults/${encodeURIComponent(faultId)}/diagnoses`, { method: "POST", body: JSON.stringify(body) });
      reset(DIAGNOSIS_DEFAULTS);
      await done("Diagnosis recorded. It remains unverified until an intervention confirms it.", true);
    } catch (reason) {
      if (isOfflineError(reason)) {
        await queueDiagnosis(user, faultId, body);
        reset(DIAGNOSIS_DEFAULTS);
        await done(`Diagnosis: ${OFFLINE_SAVED}`);
        return;
      }
      fail(reason, "Diagnosis could not be saved.");
    }
  }
  return (
    <Card>
      <form onSubmit={handleSubmit(submit)} noValidate>
        <CardHeader><CardTitle>What did you find?</CardTitle></CardHeader>
        <CardContent className="grid gap-3">
          <Field label="Possible cause" error={errors.possible_cause?.message}><Input aria-invalid={Boolean(errors.possible_cause)} {...register("possible_cause")} /></Field>
          <Field label="Diagnostic method" error={errors.diagnostic_method?.message}><Input aria-invalid={Boolean(errors.diagnostic_method)} {...register("diagnostic_method")} /></Field>
          <Field label="Observations"><Textarea {...register("observations")} /></Field>
          <Field label="Test results"><Textarea {...register("test_results")} /></Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Confidence (0–1)" error={errors.confidence?.message}><Input type="number" min="0" max="1" step="0.05" {...register("confidence")} /></Field>
            <Field label="Risk level"><NativeSelect {...register("risk_level")}><option>Normal</option><option>Caution</option><option>High</option></NativeSelect></Field>
          </div>
          <Field label="Quick check"><Input placeholder="Fast test or verification step" {...register("quick_check")} /></Field>
          <Field label="Recommended fix" error={errors.fix_summary?.message}><Input {...register("fix_summary")} /></Field>
          <label className="flex items-center gap-2 text-sm font-semibold">
            <input type="checkbox" className="size-4" {...register("workaround")} /> This is a workaround or temporary reset
          </label>
          <Button type="submit" className="justify-self-start" disabled={isSubmitting}>Save what you found</Button>
        </CardContent>
      </form>
    </Card>
  );
}

function InterventionForm() {
  const { user, faultId, context, done, fail } = useDetail();
  const { register, handleSubmit, reset, formState: { errors, isSubmitting } } = useForm<InterventionValues>({
    resolver: zodResolver(interventionSchema), defaultValues: INTERVENTION_DEFAULTS,
  });
  async function submit(values: InterventionValues) {
    const body = { ...values, diagnosis_id: values.diagnosis_id || null };
    try {
      await api(`/api/v1/faults/${encodeURIComponent(faultId)}/interventions`, { method: "POST", body: JSON.stringify(body) });
      reset(INTERVENTION_DEFAULTS);
      await done("Intervention recorded; failed attempts remain in the history.");
    } catch (reason) {
      if (isOfflineError(reason)) {
        await queueIntervention(user, faultId, body);
        reset(INTERVENTION_DEFAULTS);
        await done(`Intervention: ${OFFLINE_SAVED} Failed attempts are kept.`);
        return;
      }
      fail(reason, "Intervention could not be saved.");
    }
  }
  return (
    <Card>
      <form onSubmit={handleSubmit(submit)} noValidate>
        <CardHeader><CardTitle>What did you do?</CardTitle></CardHeader>
        <CardContent className="grid gap-3">
          <Field label="Related diagnosis">
            <NativeSelect {...register("diagnosis_id")}>
              <option value="">Not linked to a diagnosis</option>
              {context.diagnoses.map((item) => <option key={String(item.id)} value={String(item.id)}>{String(item.possible_cause)}</option>)}
            </NativeSelect>
          </Field>
          <Field label="Action taken" error={errors.corrective_action?.message}><Textarea aria-invalid={Boolean(errors.corrective_action)} {...register("corrective_action")} /></Field>
          <Field label="Tools / materials"><Input {...register("tools_materials")} /></Field>
          <Field label="Outcome">
            <NativeSelect {...register("outcome")}>
              <option value="SUCCESS">Successful</option>
              <option value="FAILED">Failed — retain in history</option>
              <option value="IN_PROGRESS">In progress</option>
            </NativeSelect>
          </Field>
          <Field label="Notes"><Textarea {...register("notes")} /></Field>
          <Button type="submit" className="justify-self-start" disabled={isSubmitting}>Save what you did</Button>
        </CardContent>
      </form>
    </Card>
  );
}

export function InvestigationForms() {
  const { can } = useDetail();
  if (!can.canRecordInvestigation) return null;
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <DiagnosisForm />
      <InterventionForm />
    </div>
  );
}
