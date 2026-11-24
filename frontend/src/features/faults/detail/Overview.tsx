import { useQuery } from "@tanstack/react-query";
import { CloudOff } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Alert } from "../../../components/ui/alert";
import { Badge, statusVariant } from "../../../components/ui/badge";
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
  const options = (can.activeAssignment?.section === "Systems Automation" ? ["Systems Automation"] : ALL_SECTIONS).filter((item) => {
    if (!can.restrictedTriage) return true;
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
      await done(unconfirmed ? "Asset confirmation recorded; the breakdown remains with Systems Automation." : "Asset confirmation note recorded.", true);
    } catch (reason) {
      fail(reason, "Triage could not be saved.");
    }
  }

  return (
    <form className="mt-4 grid gap-3 border-t border-border pt-4" onSubmit={submit}>
      <div>
        <strong>Systems Automation asset confirmation</strong>
        <p className="m-0 text-sm text-muted-foreground">
          {unconfirmed
            ? "Confirm the actual equipment before any section handoff."
            : `Suggested owner section: ${String(fault.suggested_section || "Not set")}. This breakdown remains with Systems Automation until findings are handed off.`}
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
              onClick={() => { setConfirmedId(String(item.id)); setSection("Systems Automation"); }}
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
        {unconfirmed ? confirmedId ? "Confirm asset; keep with Systems Automation" : "Keep unconfirmed with Systems Automation" : "Save asset confirmation"}
      </Button>
    </form>
  );
}

function WorkflowActions() {
  const { user, faultId, can, done, fail } = useDetail();
  const [busy, setBusy] = useState(false);

  async function perform(action: string) {
    setBusy(true);
    try {
      await api(`/api/v1/faults/${encodeURIComponent(faultId)}/action?action=${action}`, { method: "POST" });
      await done(`Fault ${action.replace("_", " ")} recorded.`, true);
    } catch (reason) {
      if (isOfflineError(reason)) {
        await queueFaultAction(user.id, faultId, action);
        await done(`${action.replace("_", " ")}: ${OFFLINE_SAVED}`);
      } else {
        fail(reason, "Fault action failed.");
      }
    } finally {
      setBusy(false);
    }
  }

  const status = can.status;
  return (
    <div className="mt-4 flex flex-wrap gap-2">
      {["REPORTED", "TRIAGED", "ASSIGNED"].includes(status) && <Button variant="outline" disabled={busy} onClick={() => perform("acknowledge")}>Acknowledge</Button>}
      {status === "ACKNOWLEDGED" && <Button variant="outline" disabled={busy} onClick={() => perform("on_site")}>On site</Button>}
      {["ON_SITE", "ACKNOWLEDGED"].includes(status) && <Button variant="outline" disabled={busy} onClick={() => perform("diagnose")}>Mark diagnosed</Button>}
      {!["RESTORED", "CLOSED", "AWAITING_CHIEF_REVIEW"].includes(status) && can.canRestore && (
        <Button disabled={busy} onClick={() => perform("restore")}>Request technical completion review</Button>
      )}
    </div>
  );
}

export function Overview({ message, error }: { message: string; error: string }) {
  const { context, offline, can } = useDetail();
  const fault = context.fault;
  return (
    <>
      {offline && (
        <Alert variant="warning">
          <CloudOff />
          <span>
            {fault.offline_pending
              ? "Reported on this device and waiting to synchronise. Investigation steps become available once Systems Automation receives it."
              : "Offline: this is the copy saved on this device. Acknowledge, on-site, diagnosis, intervention and operator updates are queued; other steps need a connection."}
          </span>
        </Alert>
      )}
      <Card>
        <CardContent className="pt-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="m-0 text-2xs font-extrabold uppercase tracking-[0.12em] text-muted-foreground">Work order context</p>
              <h3 className="mt-1">{String(fault.reference)} · {String(fault.equipment_tag)}</h3>
              <p className="m-0">{String(fault.symptom)} · {String(fault.description || "No additional report details")}</p>
              {Boolean(fault.operating_conditions) && <p className="mb-0 mt-1 text-sm"><strong>Operating conditions:</strong> {String(fault.operating_conditions)}</p>}
              {Boolean(fault.operational_impact) && <p className="mb-0 mt-1 text-sm"><strong>Operational effect:</strong> {String(fault.operational_impact)}</p>}
            </div>
            <Badge variant={statusVariant(can.status)}>{can.status.replace(/_/g, " ")}</Badge>
          </div>
          <p className="mb-0 text-sm text-muted-foreground">
            Assigned section: {String(fault.assigned_section || "Unassigned")} · Reported by {String(fault.reporter_name || "Unknown")} · {new Date(String(fault.created_at)).toLocaleString()}
            {fault.reported_on_behalf_of ? ` · On behalf of ${String(fault.reported_on_behalf_of)}` : ""}
          </p>
          {!can.assetConfirmed && (
            <Alert variant="warning" className="mt-3 grid gap-0.5">
              <strong>Asset not confirmed</strong>
              <span className="font-normal">Reported wording: {String(fault.reported_equipment_text || "Not provided")}{fault.reported_location ? ` · Location: ${String(fault.reported_location)}` : ""}</span>
              {Boolean(fault.suggested_equipment_tag) && <span className="font-normal">Possible match only: {String(fault.suggested_equipment_tag)}</span>}
              <span className="font-normal">Do not use the suggestion as a confirmed tag. Confirm the physical asset before routing to its maintenance section.</span>
            </Alert>
          )}
          {context.previous_faults.length > 0 && (
            <Alert variant="warning" className="mt-3">
              Seen before on this equipment: {context.previous_faults.length} earlier report(s). Review the diagnosis and intervention history before repeating work.
            </Alert>
          )}
          {can.canTriageCurrent && !offline && <TriageForm />}
          {can.canUpdate && can.canWorkAssignment && can.assetConfirmed && <WorkflowActions />}
          {can.canUpdate && !can.assetConfirmed && <p className="mb-0 text-sm text-muted-foreground">Technical actions are disabled until the physical equipment is confirmed.</p>}
          {can.status === "AWAITING_CHIEF_REVIEW" && <Alert variant="warning" className="mt-3">Work is waiting for Chief Technician review. Operations cannot confirm restoration until technical completion is approved.</Alert>}
          {can.status === "RESTORED" && <Alert variant="success" className="mt-3">Chief technical review is complete. Waiting for Operations to confirm service restoration.</Alert>}
          {Boolean(fault.closure_remarks) && <p className="mb-0 text-sm"><strong>Operator closure remarks:</strong> {String(fault.closure_remarks)}</p>}
          {message && <Alert variant="success" className="mt-3">{message}</Alert>}
          {error && <Alert variant="destructive" className="mt-3">{error}</Alert>}
        </CardContent>
      </Card>
    </>
  );
}
