import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowUpCircle, MessageSquareText } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { can, type User } from "../../auth";
import { Alert } from "../../components/ui/alert";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../components/ui/card";
import { Field, NativeSelect, Textarea } from "../../components/ui/form-controls";
import { EmptyState, Page, PageHeader } from "../../components/ui/page";
import { Term } from "../help/Help";
import { spokenTime } from "../../lib/format";
import { errorMessage } from "../../lib/query";
import { api } from "../../offline/api";

/** Escalation on a fault: CT -> regional Senior Engineer -> section Chief Engineer (backend/app/services/escalation.py). */
export type EscalationFields = {
  escalation_level?: number;
  escalated_to?: string;
  escalated_at?: string | null;
  escalation_reason?: string;
  escalation_guidance?: string;
  escalation_actions?: string[];
};

type QueueRow = EscalationFields & {
  id: string; reference: string; equipment_tag: string; equipment_name: string; region: string; section: string;
  symptom: string; severity: string; status: string; safety_hazard: boolean; assigned_user_name: string;
  hours_open: number; created_at: string;
};
type Queue = { reasons_for_ce: string[]; faults: QueueRow[] };

const CE_REASONS = [
  "Needs spares or a purchase",
  "Needs a design change",
  "Needs a contractor or specialist",
  "Keeps coming back after fixes",
  "Other",
];

function useQueue(enabled: boolean) {
  return useQuery({ queryKey: ["escalations"], enabled, queryFn: () => api<Queue>("/api/v1/escalations") });
}

export function EscalationBadge({ level }: { level?: number }) {
  if (!level) return null;
  return (
    <Badge variant={level >= 2 ? "destructive" : "warning"} className="normal-case">
      {level >= 2 ? "With the Chief Engineer" : "With the Senior Engineer"}
    </Badge>
  );
}

/** Shown on the fault page: where it stands, and the next step this person may take. */
export function EscalationCard({ faultId, fault, onChanged }: { faultId: string; fault: EscalationFields; onChanged: () => Promise<unknown> }) {
  const actions = fault.escalation_actions ?? [];
  const level = fault.escalation_level ?? 0;
  const [open, setOpen] = useState<"" | "SE" | "CE" | "guide">("");
  const [choice, setChoice] = useState("");
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  if (!level && !actions.length) return null;

  async function submit(event: FormEvent) {
    event.preventDefault();
    const reason = open === "CE" && choice && choice !== "Other" ? `${choice}${text.trim() ? `: ${text.trim()}` : ""}` : text.trim();
    if (reason.length < 5) {
      setError(open === "guide" ? "Write the guidance." : "Say why it needs the next level.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      if (open === "guide") {
        await api(`/api/v1/faults/${encodeURIComponent(faultId)}/escalation-guidance`, { method: "POST", body: JSON.stringify({ note: reason }) });
      } else {
        await api(`/api/v1/faults/${encodeURIComponent(faultId)}/escalate`, { method: "POST", body: JSON.stringify({ to: open, reason }) });
      }
      setOpen("");
      setText("");
      setChoice("");
      await onChanged();
    } catch (reason) {
      setError(errorMessage(reason, "This could not be saved."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card aria-label="Escalation" className={level >= 2 ? "border-destructive/50" : level ? "border-warning/60" : undefined}>
      <CardContent className="grid gap-3 pt-4">
        {level > 0 && (
          <div className="grid gap-1">
            <div className="flex flex-wrap items-center gap-2">
              <ArrowUpCircle className="size-5 text-warning" aria-hidden />
              <strong>Escalated to the {fault.escalated_to}</strong>
              {fault.escalated_at && <span className="text-sm text-muted-foreground">{spokenTime(fault.escalated_at)}</span>}
            </div>
            <p className="m-0 text-sm">Reason: {fault.escalation_reason}</p>
            {fault.escalation_guidance && (
              <p className="m-0 flex gap-2 rounded-md bg-secondary p-2 text-sm">
                <MessageSquareText className="mt-0.5 size-4 shrink-0" aria-hidden />
                <span><strong>Guidance:</strong> {fault.escalation_guidance}</span>
              </p>
            )}
          </div>
        )}
        {!open && actions.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {actions.includes("to_se") && <Button variant="outline" className="min-h-11" onClick={() => setOpen("SE")}>Ask the Senior Engineer</Button>}
            {actions.includes("to_ce") && <Button variant="outline" className="min-h-11" onClick={() => setOpen("CE")}>Escalate to the Chief Engineer</Button>}
            {actions.includes("guide") && <Button className="min-h-11" onClick={() => setOpen("guide")}>Add guidance</Button>}
          </div>
        )}
        {open && (
          <form className="grid gap-3" onSubmit={submit}>
            {open === "CE" && (
              <Field label="What does it need?">
                <NativeSelect value={choice} onChange={(event) => setChoice(event.target.value)}>
                  <option value="">Choose…</option>
                  {CE_REASONS.map((item) => <option key={item}>{item}</option>)}
                </NativeSelect>
              </Field>
            )}
            <Field label={open === "guide" ? "Guidance for the Chief Technician and technician" : open === "SE" ? "Why it needs the Senior Engineer" : "Details"}>
              <Textarea rows={3} value={text} onChange={(event) => setText(event.target.value)}
                placeholder={open === "guide" ? "What to check or do next" : open === "SE" ? "e.g. alarms will not reset after two attempts" : "e.g. the drive card needs replacing; no spare in stores"} />
            </Field>
            {error && <Alert variant="destructive">{error}</Alert>}
            <div className="flex flex-wrap gap-2">
              <Button type="submit" className="min-h-11" disabled={busy}>{open === "guide" ? "Send guidance" : "Escalate"}</Button>
              <Button type="button" variant="ghost" className="min-h-11" onClick={() => { setOpen(""); setError(""); }}>Cancel</Button>
            </div>
          </form>
        )}
      </CardContent>
    </Card>
  );
}

function QueueItem({ row }: { row: QueueRow }) {
  return (
    <article aria-label={`${row.reference} escalated`} className="grid gap-1 border-b border-border py-3 last:border-0">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <Link to={`/faults?mode=history&fault=${encodeURIComponent(row.id)}`} className="font-bold">
          {row.reference} · {row.equipment_tag}
        </Link>
        <span className="flex flex-wrap gap-1.5">
          {row.safety_hazard && <span className="rounded bg-destructive px-2 py-0.5 text-xs font-extrabold text-destructive-foreground">SAFETY</span>}
          <EscalationBadge level={row.escalation_level} />
        </span>
      </div>
      <div className="text-sm">{row.equipment_name ? `${row.equipment_name}: ` : ""}{row.symptom}</div>
      <div className="text-sm text-muted-foreground">
        {[row.section, row.region && `${row.region} region`, `open ${row.hours_open} h`, row.assigned_user_name && `with ${row.assigned_user_name}`].filter(Boolean).join(" · ")}
      </div>
      <div className="text-sm">Why: {row.escalation_reason}</div>
      {row.escalation_guidance && <div className="text-sm text-muted-foreground">Guidance given: {row.escalation_guidance}</div>}
    </article>
  );
}

/** Top of the SE and CE homes: what has been escalated to them. Hidden when there is nothing. */
export function EscalationsPanel({ user }: { user: User }) {
  const queue = useQueue(can(user, "escalations.view"));
  if (!queue.data?.faults.length) return null;
  const rows = queue.data.faults;
  return (
    <Card className="border-warning/60">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base"><ArrowUpCircle className="size-4 text-warning" /> Escalated to you ({rows.length})</CardTitle>
        <CardDescription>
          {user.role === "chief_engineer" ? "Faults that persist or need something extra." : "From the Chief Technicians in your region."}{" "}
          <Link to="/escalations" className="font-semibold">See all</Link>
        </CardDescription>
      </CardHeader>
      <CardContent className="pt-0">
        {rows.slice(0, 4).map((row) => <QueueItem key={row.id} row={row} />)}
      </CardContent>
    </Card>
  );
}

export function Escalations({ user }: { user: User }) {
  const queue = useQueue(true);
  const queryClient = useQueryClient();
  const rows = queue.data?.faults ?? [];
  const toCe = rows.filter((row) => (row.escalation_level ?? 0) >= 2);
  const toSe = rows.filter((row) => (row.escalation_level ?? 0) === 1);
  return (
    <Page>
      <PageHeader
        eyebrow={`${user.access.level} · ${user.access.scope}`}
        title="Escalations"
        description={<>Routine work stays in the section. It comes to the regional Senior Engineer when asked, for safety, or when not working again after the set hours; to the Chief Engineer only if it persists. <Term name="escalation" /></>}
      />
      {queue.isError && <Alert variant="destructive">{errorMessage(queue.error, "Escalations are not available.")}</Alert>}
      {queue.data && !rows.length && <EmptyState>Nothing is escalated right now.</EmptyState>}
      <div className="grid gap-4 xl:grid-cols-2">
        {toCe.length > 0 && (
          <Card>
            <CardHeader><CardTitle className="text-base">With the Chief Engineer ({toCe.length})</CardTitle></CardHeader>
            <CardContent className="pt-0">{toCe.map((row) => <QueueItem key={row.id} row={row} />)}</CardContent>
          </Card>
        )}
        {toSe.length > 0 && (
          <Card>
            <CardHeader><CardTitle className="text-base">With the Senior Engineer ({toSe.length})</CardTitle></CardHeader>
            <CardContent className="pt-0">{toSe.map((row) => <QueueItem key={row.id} row={row} />)}</CardContent>
          </Card>
        )}
      </div>
      {queue.data && (
        <Button variant="ghost" className="mt-2 w-fit" onClick={() => void queryClient.invalidateQueries({ queryKey: ["escalations"] })}>Refresh</Button>
      )}
    </Page>
  );
}
