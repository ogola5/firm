import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, ImagePlus, X } from "lucide-react";
import { useEffect, useMemo, useState, type ClipboardEvent, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { type User } from "../../auth";
import { Alert } from "../../components/ui/alert";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Card, CardContent } from "../../components/ui/card";
import { ChoiceButtons, SectionLabel, type Choice } from "../../components/ui/choice";
import { Input, Textarea } from "../../components/ui/form-controls";
import { useDebounced } from "../../lib/hooks";
import { OFFLINE_SAVED } from "../../lib/messages";
import { errorMessage } from "../../lib/query";
import { type DataRow } from "../../lib/types";
import { cn } from "../../lib/utils";
import { api, isOfflineError } from "../../offline/api";
import { searchCachedEquipment } from "../../offline/cache";
import { queueAttachment, queueFaultReport } from "../../offline/outbox";
import {
  ACTIONS, composeReport, looksHazardous, missingFollowUps, PROBLEMS, STATES, visibleFollowUps, type Answers,
} from "./reportQuestions";

const TECHNICAL_ROLES = ["technician_st", "technician_pt", "technician_ct", "assistant_engineer", "engineer", "senior_engineer", "chief_engineer"];

type SeenVia = "SCADA" | "SITE_WALK";
type When = "now" | "15m" | "1h" | "custom";
type Effect = "stopped" | "reduced" | "none";

const PROBLEM_CHOICES: Array<Choice<string>> = PROBLEMS.map(({ value, label }) => ({ value, label }));
const HAZARD: Array<Choice<"no" | "yes">> = [
  { value: "no", label: "No" },
  { value: "yes", label: "Yes: safety or environment hazard", hint: "Product leak, smoke, spill, someone hurt" },
];
const STATE_CHOICES: Array<Choice<string>> = STATES.map((label) => ({ value: label, label }));

function whenWords(when: When, time: string): string {
  if (when === "15m") return "about 15 minutes ago";
  if (when === "1h") return "about an hour ago";
  if (when === "custom" && time) return `at ${time}`;
  return "just now";
}

/** Several answers allowed (aria-pressed buttons), e.g. what has already been done. */
function ToggleChips({ label, options, value, onChange }: { label: string; options: string[]; value: string[]; onChange: (next: string[]) => void }) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-2">
      {options.map((option) => {
        const pressed = value.includes(option);
        return (
          <button
            key={option}
            type="button"
            aria-pressed={pressed}
            onClick={() => {
              // "Nothing yet" excludes the others, and choosing another clears it.
              if (option === "Nothing yet") return onChange(pressed ? [] : ["Nothing yet"]);
              const without = value.filter((item) => item !== "Nothing yet" && item !== option);
              onChange(pressed ? without : [...without, option]);
            }}
            className={cn(
              "min-h-11 rounded-lg border px-3 py-2 text-left text-[15px] font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              pressed ? "border-primary bg-primary text-primary-foreground" : "border-input bg-white hover:bg-secondary",
            )}
          >
            {pressed ? "✓ " : ""}{option}
          </button>
        );
      })}
    </div>
  );
}

/** The follow-up questions for the chosen problem: taps where possible, a short box where a value is needed. */
function FollowUps({ problem, answers, onChange }: { problem: string; answers: Answers; onChange: (key: string, value: string | string[]) => void }) {
  const questions = visibleFollowUps(problem, answers);
  if (!questions.length) return null;
  return (
    <div className="grid gap-3 rounded-lg border border-border bg-muted/50 p-3">
      {questions.map((question) => {
        const id = `report-follow-${question.key}`;
        if (question.kind === "text") {
          return (
            <div key={question.key} className="grid gap-1.5">
              <label htmlFor={id} className="text-sm font-bold">{question.label}{question.required ? "" : <span className="font-medium text-muted-foreground"> (optional)</span>}</label>
              <Input id={id} value={String(answers[question.key] ?? "")} placeholder={question.placeholder}
                onChange={(event) => onChange(question.key, event.target.value)} />
            </div>
          );
        }
        if (question.kind === "multi") {
          return (
            <div key={question.key} className="grid gap-1.5">
              <span className="text-sm font-bold">{question.label}</span>
              <ToggleChips label={question.label} options={question.options ?? []} value={(answers[question.key] as string[]) ?? []}
                onChange={(next) => onChange(question.key, next)} />
            </div>
          );
        }
        return (
          <div key={question.key} className="grid gap-1.5">
            <span className="text-sm font-bold">{question.label}</span>
            <ChoiceButtons label={question.label} options={(question.options ?? []).map((option) => ({ value: option, label: option }))}
              value={String(answers[question.key] ?? "")} onChange={(value) => onChange(question.key, answers[question.key] === value ? "" : value)} />
          </div>
        );
      })}
    </div>
  );
}

const EFFECTS: Array<Choice<Effect> & { severity: string }> = [
  { value: "stopped", label: "Stopped", hint: "Operation stopped or at risk", severity: "High" },
  { value: "reduced", label: "Running reduced", hint: "Working, but limited", severity: "Medium" },
  { value: "none", label: "No effect yet", hint: "Needs attention, not urgent", severity: "Low" },
];

const SEEN: Array<Choice<SeenVia>> = [{ value: "SCADA", label: "On SCADA" }, { value: "SITE_WALK", label: "On a site walk" }];
const WHEN: Array<Choice<When>> = [
  { value: "now", label: "Just now" }, { value: "15m", label: "15 min ago" },
  { value: "1h", label: "About 1 h ago" }, { value: "custom", label: "Pick a time" },
];

type RepeatInsight = { repeat_count?: number; last_occurrence?: { date?: string; reference?: string } };
export type ReportOutcome = { faultId: string; message: string; offline: boolean };

function observedAt(when: When, time: string): string {
  const now = new Date();
  if (when === "15m") return new Date(now.getTime() - 15 * 60_000).toISOString();
  if (when === "1h") return new Date(now.getTime() - 60 * 60_000).toISOString();
  if (when === "custom" && /^\d{2}:\d{2}$/.test(time)) {
    const [hours, minutes] = time.split(":").map(Number);
    const moment = new Date(now);
    moment.setHours(hours, minutes, 0, 0);
    if (moment > now) moment.setDate(moment.getDate() - 1); // a time later than now means yesterday
    return moment.toISOString();
  }
  return now.toISOString();
}

/**
 * Control-room report: which equipment, how and when it was seen, what is
 * wrong, and the effect. Only the last two are required clicks; equipment can
 * be a tag or a plain description.
 */
export function ReportBreakdownForm({ user, onReported }: { user: User; onReported?: (outcome: ReportOutcome) => void }) {
  const [query, setQuery] = useState("");
  const [pickedId, setPickedId] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [unidentified, setUnidentified] = useState(false);
  const [showOthers, setShowOthers] = useState(false);
  const [seenVia, setSeenVia] = useState<SeenVia>("SCADA");
  const [when, setWhen] = useState<When>("now");
  const [whenTime, setWhenTime] = useState("");
  const [problem, setProblem] = useState("");
  const [effect, setEffect] = useState<Effect | "">("");
  const [answers, setAnswers] = useState<Answers>({});
  const [stateNow, setStateNow] = useState("");
  const [hazard, setHazard] = useState<"no" | "yes" | "">("");
  const [actions, setActions] = useState<string[]>([]);
  const [callback, setCallback] = useState("");
  const [details, setDetails] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [previews, setPreviews] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState<(ReportOutcome & { summary: string }) | null>(null);

  const text = useDebounced(query.trim(), 200);
  const sectionScoped = TECHNICAL_ROLES.includes(user.role);
  const matches = useQuery({
    queryKey: ["equipment", "search", text],
    enabled: text.length >= 2,
    queryFn: async () => {
      try {
        return await api<DataRow[]>(`/api/v1/equipment?search=${encodeURIComponent(text)}`);
      } catch (reason) {
        if (isOfflineError(reason)) return searchCachedEquipment(text, sectionScoped ? user.section : undefined);
        throw reason;
      }
    },
  });
  const candidates = text.length >= 2 ? matches.data ?? [] : [];
  const chosen = unidentified ? null : (pickedId ? candidates.find((item) => item.id === pickedId) : candidates[0]) ?? null;
  const others = candidates.filter((item) => item.id !== chosen?.id).slice(0, 4);

  const repeat = useQuery({
    queryKey: ["intelligence", "equipment", chosen?.id],
    enabled: Boolean(chosen?.id),
    queryFn: () => api<RepeatInsight>(`/api/v1/intelligence/equipment/${encodeURIComponent(String(chosen!.id))}`),
  });
  const seenBefore = Number(repeat.data?.repeat_count || 0);

  useEffect(() => () => previews.forEach((url) => URL.revokeObjectURL(url)), [previews]);

  const hasEquipment = Boolean(chosen) || query.trim().length > 0;
  const missing = useMemo(() => [
    !hasEquipment && "the equipment",
    !problem && "what is wrong",
    ...(problem ? missingFollowUps(problem, answers) : []),
    !effect && "the effect",
    !hazard && "whether anyone or anything is at risk",
  ].filter(Boolean) as string[], [hasEquipment, problem, answers, effect, hazard]);

  const effectChoice = EFFECTS.find((item) => item.value === effect);
  const equipmentWords = chosen
    ? `${String(chosen.tag)} · ${String(chosen.name)}${confirmed ? "" : " (to be confirmed)"}`
    : query.trim() ? `“${query.trim()}” (equipment to be identified)` : "";
  const reportLines = composeReport({
    equipment: equipmentWords,
    problem,
    answers,
    seen: `Seen ${seenVia === "SCADA" ? "on SCADA" : "on a site walk"} ${whenWords(when, whenTime)}.`,
    effect: effectChoice ? `${effectChoice.label.toLowerCase()} (${(effectChoice.hint ?? "").toLowerCase()})` : "",
    state: stateNow,
    hazard,
    actions,
    notes: details,
    callback,
  });
  const hazardSuggested = hazard !== "yes" && looksHazardous(problem, answers);

  function changeQuery(value: string) {
    setQuery(value);
    setPickedId(null);
    setConfirmed(false);
    setUnidentified(false);
    setShowOthers(false);
  }

  function addFiles(added: File[]) {
    if (!added.length) return;
    setFiles((current) => [...current, ...added]);
    setPreviews((current) => [...current, ...added.filter((file) => file.type.startsWith("image/")).map((file) => URL.createObjectURL(file))]);
  }

  function onPaste(event: ClipboardEvent<HTMLElement>) {
    const pasted = Array.from(event.clipboardData.files);
    if (pasted.length) {
      event.preventDefault();
      addFiles(pasted.map((file, index) => new File([file], file.name && file.name !== "image.png" ? file.name : `scada-screenshot-${index + 1}.png`, { type: file.type })));
    }
  }

  function reset() {
    changeQuery("");
    setSeenVia("SCADA"); setWhen("now"); setWhenTime(""); setProblem(""); setEffect(""); setDetails("");
    setAnswers({}); setStateNow(""); setHazard(""); setActions([]); setCallback("");
    setFiles([]); setPreviews([]); setError(""); setDone(null);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (missing.length || submitting) return;
    setSubmitting(true);
    setError("");
    const effectPicked = EFFECTS.find((item) => item.value === effect)!;
    const isConfirmed = Boolean(chosen && confirmed);
    const asked = visibleFollowUps(problem, answers).map((item) => item.key);
    const payload = {
      ...(chosen ? { equipment_id: chosen.id } : {}),
      equipment_confirmed: isConfirmed,
      reported_equipment_text: query.trim(),
      reported_location: chosen ? String(chosen.location ?? "") : "",
      category: String(chosen?.category || "Unconfirmed"),
      symptom: problem,
      severity: effectPicked.severity,
      operational_impact: `${effectPicked.label}: ${effectPicked.hint}`,
      // The written report the technician reads, composed from the answers.
      description: reportLines.join("\n"),
      operating_conditions: [stateNow && `State now: ${stateNow}`, actions.length && `Already done: ${actions.join(", ")}`].filter(Boolean).join(". "),
      seen_via: seenVia,
      observed_at: observedAt(when, whenTime),
      safety_hazard: hazard === "yes",
      callback: callback.trim(),
      report_details: {
        problem,
        answers: Object.fromEntries(Object.entries(answers).filter(([key]) => asked.includes(key))),
        state_now: stateNow,
        actions_taken: actions,
        hazard: hazard === "yes",
        notes: details.trim(),
      },
    };
    const priority = hazard === "yes" ? "Critical (safety)" : effectPicked.severity;
    const summary = `${reportLines.filter((line) => !line.startsWith("⚠")).slice(0, 2).join(" ")} Priority ${priority}.`;
    try {
      const created = await api<{ id: string; reference: string }>("/api/v1/faults", { method: "POST", body: JSON.stringify(payload) });
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
      const message = `Reported · ${created.reference}${failed.length ? `. Not attached: ${failed.join(", ")}` : ""}`;
      setDone({ faultId: created.id, message, offline: false, summary });
      onReported?.({ faultId: created.id, message, offline: false });
    } catch (reason) {
      if (!isOfflineError(reason)) {
        setError(`Could not submit the report. ${errorMessage(reason, "")}`);
      } else {
        // Like the server: a suggested but unconfirmed asset is shown by the reporter's own words.
        const { faultId } = await queueFaultReport(user, payload, { equipment_tag: isConfirmed ? chosen?.tag : undefined });
        for (const file of files) await queueAttachment(user.id, faultId, file);
        const message = `${OFFLINE_SAVED} The reference number is given when it reaches the server.`;
        setDone({ faultId, message, offline: true, summary });
        onReported?.({ faultId, message, offline: true });
      }
    } finally {
      setSubmitting(false);
    }
  }

  if (done) {
    return (
      <Card>
        <CardContent className="grid gap-3 pt-6" aria-live="polite">
          <div className="flex items-center gap-3">
            <CheckCircle2 className="size-8 text-success" aria-hidden />
            <h2 className="m-0 text-2xl">{done.offline ? "Saved on this computer" : done.message}</h2>
          </div>
          {done.offline && <p className="m-0">{done.message}</p>}
          <p className="m-0 text-base">{done.summary}</p>
          {hazard === "yes" && (
            <Alert variant="destructive">Marked SAFETY: it is at the top of Systems Automation's list. Follow the site emergency procedure and inform the shift supervisor now if you have not.</Alert>
          )}
          <p className="m-0 text-muted-foreground">
            <strong className="text-foreground">Who has it now:</strong> Systems Automation. They hand it to the right section if needed. Follow it under <strong className="text-foreground">My reports</strong>.
          </p>
          <div className="flex flex-wrap gap-3 pt-2">
            <Button type="button" onClick={reset}>Report another fault</Button>
            <Button variant="outline" asChild><Link to={`/faults?mode=history&fault=${encodeURIComponent(done.faultId)}`}>Open this report</Link></Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="pt-6">
        <form className="grid gap-7" onSubmit={submit} noValidate>
          <div className="grid gap-2">
            <SectionLabel htmlFor="report-equipment">1. Which equipment?</SectionLabel>
            <span className="text-sm text-muted-foreground">Type the tag or describe it in your own words, for example “11-MOV-501” or “tank 601 inlet valve”.</span>
            <Input id="report-equipment" autoComplete="off" value={query} onChange={(event) => changeQuery(event.target.value)} placeholder="Tag or description" className="text-base" />

            {chosen && (
              <div className={cn("flex flex-wrap items-center justify-between gap-3 rounded-lg border-2 px-4 py-3", confirmed ? "border-success bg-success/5" : "border-ring bg-accent/40")}>
                <div className="grid gap-0.5">
                  <span className="text-xs font-bold text-ring">{confirmed ? "Confirmed" : pickedId ? "Selected" : "Best match"}</span>
                  <strong className="text-lg">{String(chosen.tag)} · {String(chosen.name)}</strong>
                  <span className="text-sm text-muted-foreground">{String(chosen.location)} · {String(chosen.station)} · looked after by {String(chosen.section)}</span>
                </div>
                <div className="flex flex-wrap gap-2">
                  {!confirmed && <Button type="button" onClick={() => setConfirmed(true)}>Yes, this one</Button>}
                  {confirmed && <Button type="button" variant="ghost" onClick={() => setConfirmed(false)}>Undo</Button>}
                  <Button type="button" variant="outline" onClick={() => setShowOthers((value) => !value)}>{showOthers ? "Hide other matches" : "Not this one"}</Button>
                </div>
              </div>
            )}
            {chosen && !confirmed && (
              <span className="text-sm text-muted-foreground">Not sure? You can still submit. Systems Automation will confirm the equipment.</span>
            )}

            {(showOthers || (text.length >= 2 && !chosen && !unidentified && !matches.isLoading)) && (
              <div className="grid gap-2">
                {others.map((item) => (
                  <button
                    key={String(item.id)}
                    type="button"
                    onClick={() => { setPickedId(String(item.id)); setConfirmed(true); setUnidentified(false); setShowOthers(false); }}
                    className="flex min-h-12 items-center justify-between gap-3 rounded-lg border border-input bg-white px-4 py-2 text-left hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <span><strong>{String(item.tag)}</strong> · {String(item.name)}</span>
                    <span className="text-sm text-muted-foreground">{String(item.location)} · {String(item.station)}</span>
                  </button>
                ))}
                {!others.length && !chosen && <p className="m-0 text-sm text-muted-foreground">No equipment matches that description.</p>}
                <button
                  type="button"
                  onClick={() => { setUnidentified(true); setPickedId(null); setConfirmed(false); setShowOthers(false); }}
                  className="min-h-12 rounded-lg border border-dashed border-input bg-white px-4 py-2 text-left hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  Not sure which one: send my description to Systems Automation to identify
                </button>
              </div>
            )}
            {unidentified && (
              <div className="rounded-lg border border-dashed border-input px-4 py-3 text-[15px]">
                <strong>Equipment to be identified.</strong> Systems Automation will confirm which asset this is. Your description is kept as you typed it.
              </div>
            )}
            {chosen && seenBefore > 0 && (
              <Alert variant="warning">
                <span><strong>Seen before:</strong> {seenBefore} report(s) on this equipment in the last 90 days{repeat.data?.last_occurrence?.date ? `, last on ${new Date(repeat.data.last_occurrence.date).toLocaleDateString()}` : ""}.</span>
              </Alert>
            )}
          </div>

          <div className="grid gap-2">
            <SectionLabel id="report-seen">2. Where did you see it, and when?</SectionLabel>
            <div className="flex flex-wrap items-start gap-x-6 gap-y-2">
              <ChoiceButtons label="Where did you see it" options={SEEN} value={seenVia} onChange={setSeenVia} />
              <ChoiceButtons label="When did you see it" options={WHEN} value={when} onChange={setWhen} />
            </div>
            {when === "custom" && (
              <div className="grid max-w-56 gap-1.5">
                <label htmlFor="report-time" className="text-sm font-semibold">Time you saw it</label>
                <Input id="report-time" type="time" value={whenTime} onChange={(event) => setWhenTime(event.target.value)} />
              </div>
            )}
          </div>

          <div className="grid gap-2">
            <SectionLabel>3. What is wrong?</SectionLabel>
            <ChoiceButtons label="What is wrong" options={PROBLEM_CHOICES} value={problem}
              onChange={(value) => { if (value !== problem) setAnswers({}); setProblem(value); }} />
            {problem && <FollowUps problem={problem} answers={answers} onChange={(key, value) => setAnswers((current) => ({ ...current, [key]: value }))} />}
          </div>

          <div className="grid gap-2">
            <SectionLabel>4. What is the effect on operation?</SectionLabel>
            <ChoiceButtons label="Effect on operation" options={EFFECTS} value={effect} onChange={setEffect} columns={3} />
            {effect && hazard !== "yes" && <span className="text-sm text-muted-foreground">Priority set to <strong className="text-foreground">{EFFECTS.find((item) => item.value === effect)!.severity}</strong> from your answer.</span>}
            <span className="pt-1 text-sm font-bold">The equipment is now <span className="font-medium text-muted-foreground">(optional)</span></span>
            <ChoiceButtons label="Equipment state now" options={STATE_CHOICES} value={stateNow} onChange={(value) => setStateNow(stateNow === value ? "" : value)} />
          </div>

          <div className="grid gap-2">
            <SectionLabel>5. Is anyone or anything at risk?</SectionLabel>
            <ChoiceButtons label="Anyone or anything at risk" options={HAZARD} value={hazard} onChange={setHazard} />
            {hazardSuggested && (
              <Alert variant="warning">Your answers sound like a hazard (product leak or smoke). If it is, choose <strong>Yes</strong>.</Alert>
            )}
            {hazard === "yes" && (
              <Alert variant="destructive">
                Marked <strong>SAFETY</strong>: priority Critical, top of every list. Follow the site emergency procedure and inform the shift supervisor now; this report does not replace that.
              </Alert>
            )}
          </div>

          <div className="grid gap-2">
            <SectionLabel>6. What have you already done? <span className="font-medium text-muted-foreground">(tick all that apply)</span></SectionLabel>
            <ToggleChips label="Already done" options={ACTIONS} value={actions} onChange={setActions} />
          </div>

          <div className="grid gap-2" onPaste={onPaste}>
            <SectionLabel htmlFor="report-details">7. Anything else? <span className="font-medium text-muted-foreground">(optional)</span></SectionLabel>
            <Textarea id="report-details" value={details} onChange={(event) => setDetails(event.target.value)} placeholder="Paste the SCADA alarm text, readings, or anything a technician should know" />
            <div className="grid gap-1.5 sm:max-w-sm">
              <label htmlFor="report-callback" className="text-sm font-bold">Reach me on <span className="font-medium text-muted-foreground">(optional)</span></label>
              <Input id="report-callback" value={callback} onChange={(event) => setCallback(event.target.value)} placeholder="Extension, radio channel or mobile" />
            </div>
            <details className="rounded-lg border border-dashed border-input bg-muted/40 px-4 py-2 text-[15px]" open={files.length > 0}>
              <summary className="flex min-h-10 cursor-pointer items-center gap-2 font-semibold text-muted-foreground">
                <ImagePlus className="size-4" aria-hidden /> Attach a SCADA screenshot or file (optional)
              </summary>
              <div className="flex flex-wrap items-center gap-3 py-2">
                <span className="hidden md:inline">Press <kbd className="rounded border border-input bg-white px-1.5 text-sm">Ctrl</kbd> + <kbd className="rounded border border-input bg-white px-1.5 text-sm">V</kbd> in the box above to paste a screenshot, or</span>
                <label className="inline-flex min-h-11 cursor-pointer items-center font-bold text-ring underline md:min-h-0">
                  choose a file
                  <input type="file" multiple accept=".png,.jpg,.jpeg,.webp,.pdf,.csv,.txt,.json,.log" className="sr-only" onChange={(event) => addFiles(Array.from(event.target.files || []))} />
                </label>
              </div>
            </details>
            {files.length > 0 && (
              <div className="flex flex-wrap items-center gap-3">
                {previews.map((url) => <img key={url} src={url} alt="Attached screenshot" className="h-20 rounded border border-border" />)}
                {files.map((file, index) => (
                  <Badge key={`${file.name}-${index}`} variant="outline" className="gap-1 normal-case">
                    {file.name}
                    <button type="button" aria-label={`Remove ${file.name}`} onClick={() => setFiles((current) => current.filter((_, i) => i !== index))}><X className="size-3" /></button>
                  </Badge>
                ))}
              </div>
            )}
          </div>

          {(problem || hasEquipment) && (
            <section aria-label="Your report will read" className={cn("grid gap-1 rounded-lg border-2 p-4 text-[15px]", hazard === "yes" ? "border-destructive bg-destructive/5" : "border-ring/40 bg-accent/30")}>
              <span className="text-xs font-extrabold uppercase tracking-[0.1em] text-muted-foreground">Your report will read</span>
              {reportLines.map((line, index) => (
                <p key={index} className={cn("m-0", line.startsWith("⚠") && "font-extrabold text-destructive")}>{line}</p>
              ))}
            </section>
          )}

          {error && <Alert variant="destructive">{error}</Alert>}
          <div className="flex flex-wrap items-center gap-4 border-t border-border pt-5">
            <Button type="submit" size="lg" disabled={missing.length > 0 || submitting}>{submitting ? "Submitting…" : "Submit report"}</Button>
            <span className="text-sm text-muted-foreground">{missing.length ? `Still needed: ${missing.join(", ")}.` : "Press Enter or click Submit report."}</span>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
