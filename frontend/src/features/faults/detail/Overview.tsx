import { useQuery } from "@tanstack/react-query";
import { CloudOff } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Alert } from "../../../components/ui/alert";
import { Badge, statusVariant, statusWords } from "../../../components/ui/badge";
import { ProgressLine } from "./NextStep";
import { Button } from "../../../components/ui/button";
import { Card, CardContent } from "../../../components/ui/card";
import { Field, Input, NativeSelect } from "../../../components/ui/form-controls";
import { useDebounced } from "../../../lib/hooks";
import { OFFLINE_SAVED } from "../../../lib/messages";
import { type DataRow } from "../../../lib/types";
import { cn } from "../../../lib/utils";
import { api, isOfflineError } from "../../../offline/api";
import { queueFaultAction } from "../../../offline/outbox";
import { ALL_SECTIONS, useDetail } from "./context";

function TriageForm() {
  const { faultId, context, can, user, done, fail } = useDetail();
  const fault = context.fault;
  const unconfirmed = fault.equipment_confirmed === false;
  const [section, setSection] = useState(String(fault.assigned_section || fault.suggested_section || "Systems Automation"));
  const [comment, setComment] = useState("");
  const [assetSearch, setAssetSearch] = useState("");
  const [confirmedId, setConfirmedId] = useState("");
  const query = useDebounced(assetSearch.trim());
  const assets = useQuery({
    queryKey: ["equipment", "search", query],
    enabled: unconfirmed && query.length >= 2,
    queryFn: () => api<DataRow[]>(`/api/v1/equipment?search=${encodeURIComponent(query)}`),
  });
  // Confirming the equipment keeps the job where it is; moving it to another section is a handoff.
  const current = can.activeAssignment ? String(can.activeAssignment.section) : "";
  const options = (current ? [current] : ALL_SECTIONS).filter((item) => {
    if (!can.restrictedTriage || current) return true;
    if (unconfirmed && !confirmedId && item === "Systems Automation") return true;
    return item === user.section;
  });

  async function submit(event: FormEvent) {
    event.preventDefault();
    try {
      await api(`/api/v1/faults/${encodeURIComponent(faultId)}/triage`, {
        method: "POST",
        body: JSON.stringify({
          assigned_section: section,
          triage_comment: comment,
          ...(confirmedId ? { confirmed_equipment_id: confirmedId } : {}),
        }),
      });
      setComment("");
      setConfirmedId("");
      setAssetSearch("");
      await done(unconfirmed && confirmedId ? "Equipment confirmed. You can take the job now." : "Note recorded.", true);
    } catch (reason) {
      fail(reason, "Triage could not be saved.");
    }
  }

  return (
    <form id="fault-triage" className="mt-4 grid gap-3 border-t border-border pt-4" onSubmit={submit}>
      <div>
        <strong>Which equipment is it?</strong>
        <p className="m-0 text-sm text-muted-foreground">
          {unconfirmed
            ? "Whoever takes the job confirms the actual equipment first, so its history and procedures are linked."
            : `Looked after by ${String(fault.suggested_section || "not set")}. It stays with ${current || "this section"} unless you hand it over with your findings.`}
        </p>
      </div>
      {unconfirmed && <>
        <Field label="Find the actual equipment by tag or description">
          <Input value={assetSearch} onChange={(event) => { setAssetSearch(event.target.value); setConfirmedId(""); }} placeholder="Search equipment records" />
        </Field>
        {(assets.data ?? []).slice(0, 5).map((item) => {
          const active = confirmedId === String(item.id);
          return (
            <button
              type="button"
              key={String(item.id)}
              onClick={() => { setConfirmedId(String(item.id)); setSection(current || "Systems Automation"); }}
              className={cn("flex items-center justify-between gap-3 rounded-md border bg-card px-3 py-2 text-left", active ? "border-ring ring-1 ring-ring" : "border-border hover:bg-secondary")}
            >
              <span className="grid"><strong className="text-sm">{String(item.tag)} · {String(item.name)}</strong><small className="text-muted-foreground">{String(item.location)} · {String(item.section)}</small></span>
              <Badge variant={active ? "primary" : "outline"}>{active ? "Confirmed asset" : "Select actual asset"}</Badge>
            </button>
          );
        })}
      </>}
      <div className="grid gap-3 md:grid-cols-2">
        <Field label="Current section">
          <NativeSelect value={options.includes(section) ? section : options[0]} onChange={(event) => setSection(event.target.value)}>
            {options.map((item) => <option key={item} value={item}>{item}</option>)}
          </NativeSelect>
        </Field>
        <Field label="Asset confirmation note"><Input value={comment} onChange={(event) => setComment(event.target.value)} /></Field>
      </div>
      <Button type="submit" variant="outline" className="justify-self-start">
        {unconfirmed ? confirmedId ? "Confirm this equipment" : "Save note; still not identified" : "Save note"}
      </Button>
    </form>
  );
}

export function Overview({ error }: { error: string }) {
  const { context, offline, can } = useDetail();
  const fault = context.fault;
  return (
    <>
      {offline && (
        <Alert variant="warning">
          <CloudOff />
          <span>
            {fault.offline_pending
              ? "Reported on this device and waiting to synchronise. The workshop sees it as soon as it reaches the server."
              : "Offline: this is the copy saved on this device. Acknowledge, on-site, diagnosis, intervention and operator updates are queued; other steps need a connection."}
          </span>
        </Alert>
      )}
      <Card>
        <CardContent className="pt-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <ProgressLine />
              <h3 className="mt-3">{String(fault.reference)} · {String(fault.equipment_tag)}</h3>
              {Boolean(fault.safety_hazard) && (
                <p className="my-2 rounded-md border-2 border-destructive bg-destructive/10 px-3 py-2 font-extrabold text-destructive">
                  SAFETY: the reporter says someone or something is at risk.
                </p>
              )}
              <p className="m-0 font-semibold">{String(fault.symptom)}</p>
              {/* The written report (composed from the reporter's answers): one point per line. */}
              <div className="mt-1 grid gap-0.5 text-[15px]">
                {String(fault.description || "No additional report details").split("\n").filter((line) => !line.startsWith("⚠")).map((line, index) => <p key={index} className="m-0">{line}</p>)}
              </div>
              {Boolean(fault.callback) && <p className="mb-0 mt-1 text-sm"><strong>Reach the reporter on:</strong> {String(fault.callback)}</p>}
              {Boolean(fault.operating_conditions) && !String(fault.description || "").includes("Already done") && <p className="mb-0 mt-1 text-sm"><strong>Operating conditions:</strong> {String(fault.operating_conditions)}</p>}
              {Boolean(fault.operational_impact) && <p className="mb-0 mt-1 text-sm"><strong>Operational effect:</strong> {String(fault.operational_impact)}</p>}
            </div>
            <Badge variant={statusVariant(can.status)} className="normal-case">{statusWords(can.status)}</Badge>
          </div>
          <p className="mb-0 text-sm text-muted-foreground">
            With {String(fault.assigned_section || "Systems Automation")} · Reported by {String(fault.reporter_name || "Unknown")} · {new Date(String(fault.created_at)).toLocaleString()}
            {fault.reported_on_behalf_of ? ` · On behalf of ${String(fault.reported_on_behalf_of)}` : ""}
          </p>
          {!can.assetConfirmed && (
            <Alert variant="warning" className="mt-3 grid gap-0.5">
              <strong>Asset not confirmed</strong>
              <span className="font-normal">Reported wording: {String(fault.reported_equipment_text || "Not provided")}{fault.reported_location ? ` · Location: ${String(fault.reported_location)}` : ""}</span>
              {Boolean(fault.suggested_equipment_tag) && <span className="font-normal">Possible match only: {String(fault.suggested_equipment_tag)}</span>}
              <span className="font-normal">Do not use the suggestion as a confirmed tag. Whoever takes the job confirms the actual equipment first.</span>
            </Alert>
          )}
          {context.previous_faults.length > 0 && (
            <Alert variant="warning" className="mt-3">
              Seen before on this equipment: {context.previous_faults.length} earlier report(s). See “What we know” before repeating work.
            </Alert>
          )}
          {can.canTriageCurrent && !offline && <TriageForm />}
          {can.canUpdate && !can.assetConfirmed && <p className="mb-0 text-sm text-muted-foreground">Work can start once the equipment is confirmed.</p>}
          {Boolean(fault.closure_remarks) && <p className="mb-0 text-sm"><strong>Operator closure remarks:</strong> {String(fault.closure_remarks)}</p>}
          {error && <Alert variant="destructive" className="mt-3">{error}</Alert>}
        </CardContent>
      </Card>
    </>
  );
}
