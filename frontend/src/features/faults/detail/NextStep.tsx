import { ArrowRight, CheckCircle2, Circle, Clock } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { can as userCan } from "../../../auth";
import { Button } from "../../../components/ui/button";
import { OFFLINE_SAVED } from "../../../lib/messages";
import { cn } from "../../../lib/utils";
import { api, isOfflineError } from "../../../offline/api";
import { queueFaultAction } from "../../../offline/outbox";
import { useDetail } from "./context";

/** Where a fault is, in plain words. AWAITING_CHIEF_REVIEW sits on "Signed off" as the step in progress. */
const STEPS = ["Reported", "Sorted", "Taken", "On site", "Signed off", "Confirmed"];
const POSITION: Record<string, number> = {
  REPORTED: 0, TRIAGED: 1, ASSIGNED: 1, ACKNOWLEDGED: 2, ON_SITE: 3, DIAGNOSED: 3, AWAITING_CHIEF_REVIEW: 4, RESTORED: 5, CLOSED: 6,
};

export function ProgressLine() {
  const { context, can } = useDetail();
  const done = POSITION[can.status] ?? 0; // steps before this index are complete
  const section = String(can.activeAssignment?.section || context.fault.assigned_section || "");
  return (
    <ol aria-label="Progress" className="m-0 flex flex-wrap items-center gap-x-1 gap-y-2 p-0 text-xs font-bold sm:text-sm">
      {STEPS.map((step, index) => {
        const state = index < done ? "done" : index === done ? "now" : "later";
        const label = step === "Sorted" && section && index <= done ? `With ${section}` : step;
        return (
          <li key={step} aria-current={state === "now" ? "step" : undefined} className="flex list-none items-center gap-1">
            {state === "done" ? <CheckCircle2 className="size-4 text-success" aria-hidden />
              : state === "now" ? <Clock className="size-4 text-primary" aria-hidden /> : <Circle className="size-4 text-muted-foreground/50" aria-hidden />}
            <span className={cn(state === "later" && "text-muted-foreground/70", state === "now" && "text-primary")}>{label}</span>
            {index < STEPS.length - 1 && <ArrowRight className="mx-0.5 size-3 text-muted-foreground/50" aria-hidden />}
          </li>
        );
      })}
    </ol>
  );
}

/** Runs a simple fault action online, or queues it on the device when offline. */
export function useFaultAction() {
  const { user, faultId, done, fail } = useDetail();
  const [busy, setBusy] = useState(false);
  async function perform(action: "acknowledge" | "on_site" | "diagnose" | "restore", saidAs: string) {
    setBusy(true);
    try {
      await api(`/api/v1/faults/${encodeURIComponent(faultId)}/action?action=${action}`, { method: "POST" });
      await done(saidAs, true);
    } catch (reason) {
      if (isOfflineError(reason)) {
        await queueFaultAction(user.id, faultId, action);
        await done(`${saidAs} ${OFFLINE_SAVED}`);
      } else {
        fail(reason, "That did not work.");
      }
    } finally {
      setBusy(false);
    }
  }
  return { perform, busy };
}

type Action =
  | { kind: "run"; label: string; action: "acknowledge" | "on_site" | "diagnose" | "restore"; saidAs: string }
  | { kind: "jump"; label: string; target: string }
  | { kind: "link"; label: string; to: string };
type Step = { title: string; detail?: string; primary?: Action; secondary?: Action[] };

/** Decides this person's next step on this fault from what the page already knows. The server still checks each action. */
function useStep(): Step {
  const { user, faultId, context, can, offline } = useDetail();
  const fault = context.fault;
  const status = can.status;
  const assignment = can.activeAssignment;
  const writesUp = userCan(user, "jobs.work");
  const mineSucceeded = context.interventions.some((item) => item.outcome === "SUCCESS");
  const escalation = (fault.escalation_actions ?? []) as string[];

  if (fault.offline_pending) return { title: "Waiting to send", detail: "Reported on this device. It goes to Systems Automation as soon as there is a connection." };
  if (status === "CLOSED") {
    return can.canSubmitProcedure && writesUp
      ? { title: "Closed. Did you learn something worth keeping?", detail: "Turn the fix into a procedure so the next person finds it.", primary: { kind: "link", label: "Write the procedure", to: `/jobs/${faultId}/procedure` } }
      : { title: "Closed", detail: "Nothing more to do." };
  }
  if (status === "RESTORED") {
    if (can.canConfirmRestoration && !offline) return { title: "Is it working?", detail: "The technician and the Chief Technician say it is fixed. Check, then confirm or send it back.", primary: { kind: "jump", label: "Confirm it works", target: "fault-confirm" } };
    if (can.canSubmitProcedure && writesUp) return { title: "Fixed. Waiting for Operations to confirm.", detail: "Meanwhile, turn the fix into a procedure.", primary: { kind: "link", label: "Write the procedure", to: `/jobs/${faultId}/procedure` } };
    return { title: "Fixed. Waiting for Operations to confirm it works." };
  }
  if (can.awaitingChiefReview) {
    return can.canReviewSection
      ? { title: "Waiting for your sign-off", detail: "Check the write-up, then sign it off or send it back with instructions.", primary: { kind: "jump", label: "Review and sign off", target: "fault-assignment" } }
      : { title: "Waiting for the Chief Technician's sign-off" };
  }
  if (can.canTriageCurrent && !can.assetConfirmed && !offline) {
    return { title: "Confirm the equipment first", detail: "The reporter was not sure which equipment it is. Confirm it before routing.", primary: { kind: "jump", label: "Confirm the equipment", target: "fault-triage" } };
  }
  if (can.canReviewSection && assignment && !assignment.assigned_user_id && !offline) {
    return { title: "Give it to a technician", detail: `New work for ${String(assignment.section)}.`, primary: { kind: "jump", label: "Allocate", target: "fault-assignment" } };
  }
  if (escalation.includes("guide") && !fault.escalation_guidance) {
    return { title: "Escalated to you", detail: String(fault.escalation_reason || ""), primary: { kind: "jump", label: "Add guidance", target: "fault-escalation" } };
  }
  if (can.canUpdate && can.canWorkAssignment && can.assetConfirmed) {
    if (["REPORTED", "TRIAGED", "ASSIGNED"].includes(status)) {
      return { title: "Waiting to be taken", detail: "Take it so everyone knows who is on it.", primary: { kind: "run", label: "Take this job", action: "acknowledge", saidAs: "You have taken this job." },
        secondary: writesUp ? [{ kind: "link", label: "Print the job card", to: `/jobs/${faultId}/card` }] : [] };
    }
    if (status === "ACKNOWLEDGED") {
      return { title: "You have taken it", detail: "Print the job card before you go. Tell the system when you are on site.",
        primary: { kind: "run", label: "I'm on site", action: "on_site", saidAs: "Recorded: you are on site." },
        secondary: [...(writesUp ? [{ kind: "link", label: "Print the job card", to: `/jobs/${faultId}/card` } as Action] : []),
          { kind: "run", label: "Cause found", action: "diagnose", saidAs: "Recorded: cause found." }] };
    }
    if (mineSucceeded && can.canRestore) {
      return { title: "It works again?", detail: "Ask your Chief Technician to sign it off.", primary: { kind: "run", label: "It's fixed: ask for sign-off", action: "restore", saidAs: "Sent to your Chief Technician for sign-off." },
        secondary: writesUp ? [{ kind: "link", label: "Write up your visit", to: `/jobs/${faultId}/write-up` }] : [] };
    }
    return { title: "On site", detail: "Record what you found and what you did, while it is fresh.",
      primary: writesUp ? { kind: "link", label: "Write up your visit", to: `/jobs/${faultId}/write-up` } : { kind: "jump", label: "Record checks and fixes", target: "fault-investigation" },
      secondary: status === "ON_SITE" ? [{ kind: "run", label: "Cause found", action: "diagnose", saidAs: "Recorded: cause found." }] : [] };
  }
  const who = assignment?.assigned_user_name ? String(assignment.assigned_user_name) : assignment ? `${String(assignment.section)}` : "Systems Automation";
  const words: Record<string, string> = {
    REPORTED: `Reported. ${who} will pick it up.`, TRIAGED: `Being sorted by ${who}.`, ASSIGNED: `With ${who}: waiting to be taken.`,
    ACKNOWLEDGED: `${who} has taken it.`, ON_SITE: `${who} is on site.`, DIAGNOSED: `${who} has found the cause.`,
  };
  return { title: words[status] ?? "In progress" };
}

function ActionButton({ action, primary, onJump }: { action: Action; primary: boolean; onJump: (target: string) => void }) {
  const { perform, busy } = useFaultAction();
  const variant = primary ? "default" : "outline";
  const size = primary ? "lg" : "default";
  if (action.kind === "link") return <Button asChild variant={variant} size={size} className="min-h-11"><Link to={action.to}>{action.label}</Link></Button>;
  if (action.kind === "jump") return <Button variant={variant} size={size} className="min-h-11" onClick={() => onJump(action.target)}>{action.label}</Button>;
  return <Button variant={variant} size={size} className="min-h-11" disabled={busy} onClick={() => void perform(action.action, action.saidAs)}>{action.label}</Button>;
}

/**
 * The one thing this person should do now. On phones it stays above the bottom tabs; on larger screens it is a card.
 */
export function NextStep({ onJump }: { onJump: (target: string) => void }) {
  const step = useStep();
  const body = (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="min-w-0">
        <p className="m-0 text-2xs font-extrabold uppercase tracking-[0.12em] text-muted-foreground">Next step</p>
        <p className="m-0 text-base font-bold">{step.title}</p>
        {step.detail && <p className="m-0 hidden text-sm text-muted-foreground sm:block">{step.detail}</p>}
      </div>
      <div className="flex flex-wrap gap-2">
        {step.secondary?.map((action) => <ActionButton key={action.label} action={action} primary={false} onJump={onJump} />)}
        {step.primary && <ActionButton action={step.primary} primary onJump={onJump} />}
      </div>
    </div>
  );
  return (
    <section aria-label="Next step" className={cn(
      "rounded-xl border-2 bg-card p-4 shadow-sm",
      step.primary ? "border-primary" : "border-border",
      // Phones: always within reach, above the bottom tabs.
      step.primary && "max-md:sticky max-md:bottom-[calc(4.75rem+env(safe-area-inset-bottom))] max-md:z-30",
    )}>
      {body}
    </section>
  );
}
