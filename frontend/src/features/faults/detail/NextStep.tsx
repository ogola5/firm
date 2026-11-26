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

/**
 * Where a fault is, in plain words. Working again comes straight after the fix (no wait for a sign-off);
 * the Chief Technician checks the write-up afterwards. A hand-over between sections sits on "On site".
 */
const STEPS = ["Reported", "Sorted", "Taken", "On site", "Working again", "Confirmed"];
const POSITION: Record<string, number> = {
  REPORTED: 0, TRIAGED: 1, ASSIGNED: 1, ACKNOWLEDGED: 2, ON_SITE: 3, DIAGNOSED: 3, AWAITING_CHIEF_REVIEW: 3, RESTORED: 5, CLOSED: 6,
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

  if (fault.offline_pending) return { title: "Waiting to send", detail: `Reported on this device. It goes to ${String(fault.assigned_section || "the workshop")} as soon as there is a connection.` };
  // The Chief Technician checks the write-up after the fix; it never holds up the restoration.
  if (can.canCheckWriteUp && !offline) {
    return { title: "Check the write-up", detail: "It is already working again. Approve the write-up, or ask for more detail.", primary: { kind: "jump", label: "Check the write-up", target: "fault-assignment" } };
  }
  if (can.returnedAssignment && !offline) {
    return { title: "Your Chief Technician asked for more in the write-up", detail: String(can.returnedAssignment.completion_review_comments || ""),
      primary: { kind: "jump", label: "Add to the write-up", target: "fault-writeup-note" } };
  }
  if (status === "CLOSED") {
    return can.canSubmitProcedure && writesUp
      ? { title: "Closed. Did you learn something worth keeping?", detail: "Turn the fix into a procedure so the next person finds it.", primary: { kind: "link", label: "Write the procedure", to: `/jobs/${faultId}/procedure` } }
      : { title: "Closed", detail: "Nothing more to do." };
  }
  if (status === "RESTORED") {
    if (can.canConfirmRestoration && !offline) return { title: "Is it working?", detail: "The technician says it is working again. Check, then confirm or send it back.", primary: { kind: "jump", label: "Confirm it works", target: "fault-confirm" } };
    if (can.canSubmitProcedure && writesUp) return { title: "Working again. Waiting for Operations to confirm.", detail: "Meanwhile, turn the fix into a procedure.", primary: { kind: "link", label: "Write the procedure", to: `/jobs/${faultId}/procedure` } };
    return { title: "Working again. Waiting for Operations to confirm." };
  }
  if (can.awaitingChiefReview) {
    // Only a hand-over to another section waits for the Chief Technician.
    return can.canReviewSection
      ? { title: "Hand-over waiting for you", detail: "Check the findings, then approve the hand-over or send it back with instructions.", primary: { kind: "jump", label: "Review the hand-over", target: "fault-assignment" } }
      : { title: "Waiting for the Chief Technician to approve the hand-over" };
  }
  if (can.canTriageCurrent && !can.assetConfirmed && !offline) {
    return { title: "Confirm the equipment first", detail: "The reporter was not sure which equipment it is. Confirm it, then take the job.", primary: { kind: "jump", label: "Confirm the equipment", target: "fault-triage" } };
  }
  if (can.canReviewSection && assignment && !assignment.assigned_user_id && !offline) {
    return { title: "Waiting to be taken", detail: "Anyone free can take it. You can also give it to someone.", primary: { kind: "jump", label: "Give it to someone", target: "fault-assignment" } };
  }
  if (escalation.includes("guide") && !fault.escalation_guidance) {
    return { title: "Escalated to you", detail: String(fault.escalation_reason || ""), primary: { kind: "jump", label: "Add guidance", target: "fault-escalation" } };
  }
  if (can.canUpdate && can.canWorkAssignment && can.assetConfirmed) {
    const callHelp: Action = { kind: "jump", label: "Call someone to help", target: "fault-helpers" };
    if (["REPORTED", "TRIAGED", "ASSIGNED"].includes(status)) {
      const detail = can.otherSection
        ? `Sent to ${String(assignment?.section)}. If you are free, you can take it.`
        : "Anyone free can take it. The first to take it gets it.";
      return { title: "Waiting to be taken", detail, primary: { kind: "run", label: "Take this job", action: "acknowledge", saidAs: "You have taken this job." },
        secondary: writesUp ? [{ kind: "link", label: "Print the job card", to: `/jobs/${faultId}/card` }] : [] };
    }
    const lead = assignment?.assigned_user_id === user.id;
    if (status === "ACKNOWLEDGED") {
      return { title: lead ? "You have taken it" : `You are helping ${String(assignment?.assigned_user_name || "a colleague")}`,
        detail: "Print the job card before you go. Tell the system when you are on site.",
        primary: { kind: "run", label: "I'm on site", action: "on_site", saidAs: "Recorded: you are on site." },
        secondary: [...(writesUp ? [{ kind: "link", label: "Print the job card", to: `/jobs/${faultId}/card` } as Action] : []), callHelp,
          { kind: "run", label: "Cause found", action: "diagnose", saidAs: "Recorded: cause found." }] };
    }
    if (mineSucceeded && can.canRestore) {
      return { title: "It works again?", detail: "Say so now. Operations confirm it; your Chief Technician checks the write-up later.",
        primary: { kind: "run", label: "It's working again", action: "restore", saidAs: "Marked as working again. Operations will confirm it." },
        secondary: writesUp ? [{ kind: "link", label: "Write up your visit", to: `/jobs/${faultId}/write-up` }] : [] };
    }
    return { title: "On site", detail: "Record what you found and what you did, while it is fresh. Need a hand? Call someone in.",
      primary: writesUp ? { kind: "link", label: "Write up your visit", to: `/jobs/${faultId}/write-up` } : { kind: "jump", label: "Record checks and fixes", target: "fault-investigation" },
      secondary: [callHelp, ...(status === "ON_SITE" ? [{ kind: "run", label: "Cause found", action: "diagnose", saidAs: "Recorded: cause found." } as Action] : [])] };
  }
  const who = assignment?.assigned_user_name ? String(assignment.assigned_user_name) : assignment ? `${String(assignment.section)}` : String(fault.assigned_section || "the workshop");
  const words: Record<string, string> = {
    REPORTED: `Reported. ${who} will pick it up.`, TRIAGED: `Being sorted by ${who}.`, ASSIGNED: `With ${who}: waiting for someone free to take it.`,
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
