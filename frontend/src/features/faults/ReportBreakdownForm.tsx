import { zodResolver } from "@hookform/resolvers/zod";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { type User } from "../../auth";
import { Alert } from "../../components/ui/alert";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../components/ui/card";
import { Field, Input, NativeSelect, Textarea } from "../../components/ui/form-controls";
import { useDebounced } from "../../lib/hooks";
import { OFFLINE_SAVED } from "../../lib/messages";
import { errorMessage } from "../../lib/query";
import { type DataRow } from "../../lib/types";
import { cn } from "../../lib/utils";
import { api, isOfflineError } from "../../offline/api";
import { searchCachedEquipment } from "../../offline/cache";
import { queueAttachment, queueFaultReport } from "../../offline/outbox";

const TECHNICAL_ROLES = ["technician_st", "technician_pt", "technician_ct", "assistant_engineer", "engineer", "senior_engineer", "chief_engineer"];
const SEVERITIES = ["Low", "Medium", "High", "Critical"] as const;

const reportSchema = z.object({
  equipment_text: z.string().trim(),
  reported_location: z.string().trim(),
  symptom: z.string().trim().min(1, "Describe what you observed"),
  operational_impact: z.string().trim().min(1, "Describe the effect on operation"),
  operating_conditions: z.string().trim(),
  reported_on_behalf_of: z.string().trim(),
  description: z.string().trim(),
  severity: z.enum(SEVERITIES),
}).refine((values) => values.equipment_text || values.reported_location, {
  message: "Give an equipment description or a known location",
  path: ["reported_location"],
});
type ReportValues = z.infer<typeof reportSchema>;

type RepeatInsight = { repeat_count?: number; last_occurrence?: { date?: string }; suggested_section?: string };

export type ReportOutcome = { faultId: string; message: string; offline: boolean };

export function ReportBreakdownForm({ user, onReported }: { user: User; onReported: (outcome: ReportOutcome) => void }) {
  const [equipmentId, setEquipmentId] = useState("");
  const [equipmentConfirmed, setEquipmentConfirmed] = useState(false);
  const [evidenceFiles, setEvidenceFiles] = useState<File[]>([]);
  const [submitError, setSubmitError] = useState("");
  const { register, handleSubmit, watch, reset, formState: { errors, isSubmitting } } = useForm<ReportValues>({
    resolver: zodResolver(reportSchema),
    defaultValues: {
      equipment_text: "", reported_location: "", symptom: "", operational_impact: "",
      operating_conditions: "", reported_on_behalf_of: "", description: "", severity: "Medium",
    },
  });
  const equipmentText = useDebounced(watch("equipment_text").trim());
  const sectionScoped = TECHNICAL_ROLES.includes(user.role);

  // Equipment suggestions: server search, or the device copy when offline.
  const matches = useQuery({
    queryKey: ["equipment", "search", equipmentText],
    enabled: equipmentText.length >= 2,
    queryFn: async () => {
      try {
        return await api<DataRow[]>(`/api/v1/equipment?search=${encodeURIComponent(equipmentText)}`);
      } catch (error) {
        if (isOfflineError(error)) return searchCachedEquipment(equipmentText, sectionScoped ? user.section : undefined);
        throw error;
      }
    },
  });
  const candidates = equipmentText.length >= 2 ? matches.data ?? [] : [];
  const selected = candidates.find((item) => String(item.id) === equipmentId);

  const repeat = useQuery({
    queryKey: ["intelligence", "equipment", equipmentId],
    enabled: Boolean(equipmentId && equipmentConfirmed),
    queryFn: () => api<RepeatInsight>(`/api/v1/intelligence/equipment/${encodeURIComponent(equipmentId)}`),
  });

  async function submit(values: ReportValues) {
    setSubmitError("");
    const payload = {
      ...(equipmentId ? { equipment_id: equipmentId } : {}),
      equipment_confirmed: Boolean(equipmentId && equipmentConfirmed),
      reported_equipment_text: values.equipment_text,
      reported_location: values.reported_location,
      reported_on_behalf_of: values.reported_on_behalf_of,
      operating_conditions: values.operating_conditions,
      category: String(selected?.category || "Unconfirmed"),
      symptom: values.symptom,
      severity: values.severity,
      description: values.description,
      operational_impact: values.operational_impact,
    };
    const files = evidenceFiles;
    try {
      const created = await api<{ id: string; reference: string; asset_confirmation_required?: boolean }>(
        "/api/v1/faults", { method: "POST", body: JSON.stringify(payload) },
      );
      let message = created.asset_confirmation_required
        ? `Breakdown reported: ${created.reference}. Asset identification is unconfirmed and requires confirmation.`
        : `Breakdown reported: ${created.reference}`;
      const failed: string[] = [];
      for (const file of files) {
        const form = new FormData();
        form.append("file", file);
        try {
          await api(`/api/v1/faults/${encodeURIComponent(created.id)}/attachments`, { method: "POST", body: form });
        } catch (reason) {
          failed.push(`${file.name}: ${errorMessage(reason, "upload failed")}`);
        }
      }
      if (failed.length) message += ` Evidence upload failed for: ${failed.join(", ")}. Reopen this breakdown and attach those files.`;
      finish({ faultId: created.id, message, offline: false });
    } catch (reason) {
      if (!isOfflineError(reason)) {
        setSubmitError(`Could not submit the breakdown. ${errorMessage(reason, "")}`);
        return;
      }
      const { faultId } = await queueFaultReport(user, payload, { equipment_tag: selected?.tag });
      for (const file of files) await queueAttachment(user.id, faultId, file);
      finish({
        faultId,
        offline: true,
        message: `${OFFLINE_SAVED} The official reference is assigned when it reaches the server${files.length ? `; ${files.length} evidence file(s) will upload after it` : ""}.`,
      });
    }
  }

  function finish(outcome: ReportOutcome) {
    reset();
    setEquipmentId("");
    setEquipmentConfirmed(false);
    setEvidenceFiles([]);
    onReported(outcome);
  }

  const repeatCount = Number(repeat.data?.repeat_count || 0);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Tell us what you can see</CardTitle>
        <CardDescription>Use the tag if you know it. Otherwise describe the equipment and area in your own words. Do not guess a tag.</CardDescription>
      </CardHeader>
      <CardContent>
        <form className="grid gap-4" onSubmit={handleSubmit(submit)} noValidate>
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Equipment tag or description" className="md:col-span-2">
              <Input
                placeholder="e.g. inlet valve not opening, near 11-TK-601"
                {...register("equipment_text", { onChange: () => { setEquipmentId(""); setEquipmentConfirmed(false); } })}
              />
            </Field>
            <Field label="Known area or location" error={errors.reported_location?.message}>
              <Input placeholder="Plant, station, area, or nearby equipment" aria-invalid={Boolean(errors.reported_location)} {...register("reported_location")} />
            </Field>
            <Field label="Priority">
              <NativeSelect {...register("severity")}>{SEVERITIES.map((value) => <option key={value}>{value}</option>)}</NativeSelect>
            </Field>
            <Field label="What is happening?" error={errors.symptom?.message}>
              <Textarea placeholder="Describe what you observed" aria-invalid={Boolean(errors.symptom)} {...register("symptom")} />
            </Field>
            <Field label="Effect on operation" error={errors.operational_impact?.message}>
              <Textarea placeholder="What is stopped, reduced, or affected?" aria-invalid={Boolean(errors.operational_impact)} {...register("operational_impact")} />
            </Field>
          </div>

          {equipmentText.length >= 2 && (
            <div className="grid gap-2 rounded-lg border border-border bg-muted p-3">
              <strong className="text-sm">Possible equipment matches</strong>
              {candidates.length ? candidates.slice(0, 5).map((item) => {
                const active = equipmentId === String(item.id);
                return (
                  <button
                    type="button"
                    key={String(item.id)}
                    onClick={() => { setEquipmentId(String(item.id)); setEquipmentConfirmed(false); }}
                    className={cn(
                      "flex items-center justify-between gap-3 rounded-md border bg-card px-3 py-2 text-left",
                      active ? "border-ring ring-1 ring-ring" : "border-border hover:bg-secondary",
                    )}
                  >
                    <span className="grid">
                      <strong className="text-sm">{String(item.tag)} · {String(item.name)}</strong>
                      <small className="text-muted-foreground">{String(item.location)} · {String(item.station)} · {String(item.section)}</small>
                    </span>
                    <Badge variant={active ? "primary" : "outline"}>{active ? "Selected suggestion" : "Possible match"}</Badge>
                  </button>
                );
              }) : <p className="m-0 text-sm text-muted-foreground">No matching asset found. You can still report using your description and location.</p>}
              {equipmentId && <>
                <label className="flex items-center gap-2 text-sm font-semibold">
                  <input type="checkbox" className="size-4" checked={equipmentConfirmed} onChange={(event) => setEquipmentConfirmed(event.target.checked)} />
                  I am sure this is the exact equipment
                </label>
                <Button type="button" variant="link" className="justify-self-start" onClick={() => { setEquipmentId(""); setEquipmentConfirmed(false); }}>
                  Not sure / asset not listed
                </Button>
              </>}
            </div>
          )}

          {repeatCount > 0 && repeat.data && (
            <Alert variant="warning" className="grid gap-1">
              <span><strong>SEEN BEFORE:</strong> Same equipment has {repeatCount} occurrence(s) in the last 90 days.</span>
              <span className="font-normal text-muted-foreground">
                Last: {repeat.data.last_occurrence?.date ? new Date(repeat.data.last_occurrence.date).toLocaleDateString() : "—"} · Suggested section: {repeat.data.suggested_section}.
                Systems Automation responds first; the responsible section will inherit this breakdown history.
              </span>
            </Alert>
          )}

          <details className="rounded-lg border border-border">
            <summary className="cursor-pointer px-4 py-3 text-sm font-bold text-ring">Optional details</summary>
            <div className="grid gap-4 px-4 pb-4 md:grid-cols-2">
              <Field label="Operating conditions"><Textarea placeholder="What was the equipment doing when the issue occurred?" {...register("operating_conditions")} /></Field>
              <Field label="Additional notes"><Textarea placeholder="Anything else that may help the standby team" {...register("description")} /></Field>
              <Field label="Reported on behalf of (optional)"><Input placeholder="Name or team" {...register("reported_on_behalf_of")} /></Field>
              <Field label="Evidence (optional; up to 10 MiB per file)" hint={evidenceFiles.map((file) => file.name).join(", ") || undefined}>
                <input
                  type="file"
                  className="text-sm"
                  accept=".png,.jpg,.jpeg,.webp,.pdf,.csv,.txt,.json,.log"
                  multiple
                  onChange={(event) => setEvidenceFiles(Array.from(event.target.files || []))}
                />
              </Field>
            </div>
          </details>

          {submitError && <Alert variant="destructive">{submitError}</Alert>}
          <Button type="submit" className="justify-self-start" disabled={isSubmitting}>{isSubmitting ? "Submitting…" : "Submit breakdown"}</Button>
        </form>
      </CardContent>
    </Card>
  );
}
