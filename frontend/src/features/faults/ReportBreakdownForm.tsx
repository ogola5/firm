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

const TECHNICAL_ROLES = ["technician_st", "technician_pt", "technician_ct", "assistant_engineer", "engineer", "senior_engineer", "chief_engineer"];

type SeenVia = "SCADA" | "SITE_WALK";
type When = "now" | "15m" | "1h" | "custom";
type Effect = "stopped" | "reduced" | "none";

const PROBLEMS: Array<Choice<string>> = [
  "Won't open / close", "Stopped / tripped", "Leaking", "Wrong or no reading", "Noise / vibration", "Alarm only", "Other",
].map((label) => ({ value: label, label }));

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
    !effect && "the effect",
  ].filter(Boolean) as string[], [hasEquipment, problem, effect]);

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
    setFiles([]); setPreviews([]); setError(""); setDone(null);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (missing.length || submitting) return;
    setSubmitting(true);
    setError("");
    const effectChoice = EFFECTS.find((item) => item.value === effect)!;
    const isConfirmed = Boolean(chosen && confirmed);
    const payload = {
      ...(chosen ? { equipment_id: chosen.id } : {}),
      equipment_confirmed: isConfirmed,
      reported_equipment_text: query.trim(),
      reported_location: chosen ? String(chosen.location ?? "") : "",
      category: String(chosen?.category || "Unconfirmed"),
      symptom: problem,
      severity: effectChoice.severity,
      operational_impact: `${effectChoice.label}: ${effectChoice.hint}`,
      description: details.trim(),
      seen_via: seenVia,
      observed_at: observedAt(when, whenTime),
    };
    const equipmentText = chosen ? `${String(chosen.tag)} · ${String(chosen.name)}` : `“${query.trim()}”`;
    const summary = `${equipmentText}${isConfirmed ? "" : " (to be confirmed)"}: ${problem.toLowerCase()}, ${effectChoice.label.toLowerCase()}. Priority ${effectChoice.severity}.`;
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
        const { faultId } = await queueFaultReport(user, payload, { equipment_tag: chosen?.tag });
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
            <ChoiceButtons label="What is wrong" options={PROBLEMS} value={problem} onChange={setProblem} />
          </div>

          <div className="grid gap-2">
            <SectionLabel>4. What is the effect on operation?</SectionLabel>
            <ChoiceButtons label="Effect on operation" options={EFFECTS} value={effect} onChange={setEffect} columns={3} />
            {effect && <span className="text-sm text-muted-foreground">Priority set to <strong className="text-foreground">{EFFECTS.find((item) => item.value === effect)!.severity}</strong> from your answer.</span>}
          </div>

          <div className="grid gap-2" onPaste={onPaste}>
            <SectionLabel htmlFor="report-details">Anything else? <span className="font-medium text-muted-foreground">(optional)</span></SectionLabel>
            <Textarea id="report-details" value={details} onChange={(event) => setDetails(event.target.value)} placeholder="Paste the SCADA alarm text, or what you saw on the site walk" />
            <div className="flex flex-wrap items-center gap-3 rounded-lg border-2 border-dashed border-input bg-muted/60 px-4 py-3 text-[15px]">
              <ImagePlus className="size-5 text-muted-foreground" aria-hidden />
              {/* Desktop: paste a SCADA screenshot. Phones: take a photo or pick from the gallery. */}
              <span className="hidden md:inline">Press <kbd className="rounded border border-input bg-white px-1.5 text-sm">Ctrl</kbd> + <kbd className="rounded border border-input bg-white px-1.5 text-sm">V</kbd> here to paste a SCADA screenshot, or</span>
              <label className="inline-flex min-h-11 cursor-pointer items-center rounded-md border border-input bg-white px-3 font-bold text-ring md:hidden">
                Take a photo
                <input type="file" accept="image/*" capture="environment" className="sr-only" onChange={(event) => addFiles(Array.from(event.target.files || []))} />
              </label>
              <label className="inline-flex min-h-11 cursor-pointer items-center font-bold text-ring underline md:min-h-0">
                <span className="md:hidden">or choose a file</span><span className="hidden md:inline">choose a file</span>
                <input type="file" multiple accept=".png,.jpg,.jpeg,.webp,.pdf,.csv,.txt,.json,.log" className="sr-only" onChange={(event) => addFiles(Array.from(event.target.files || []))} />
              </label>
            </div>
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
