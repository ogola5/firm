import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Plus, Trash2 } from "lucide-react";
import { useMemo, useState, type FormEvent } from "react";
import { Link, useParams } from "react-router-dom";
import { type User } from "../../auth";
import { Alert } from "../../components/ui/alert";
import { Button } from "../../components/ui/button";
import { Card, CardContent } from "../../components/ui/card";
import { ChoiceButtons, SectionLabel, type Choice } from "../../components/ui/choice";
import { Input, NativeSelect, Textarea } from "../../components/ui/form-controls";
import { EquipmentKnowledge, useCatalogue } from "../library/EquipmentKnowledge";
import { Page } from "../../components/ui/page";
import { clockTime, isoFromDayAndTime, shortEffect, spokenTime } from "../../lib/format";
import { errorMessage } from "../../lib/query";
import { type DataRow } from "../../lib/types";
import { cn } from "../../lib/utils";
import { api, isOfflineError } from "../../offline/api";
import { queueVisit } from "../../offline/outbox";
import { loadFaultContext } from "../faults/detail/context";
import { SimilarFaults } from "../faults/SimilarFaults";

type Day = "today" | "yesterday";
type Result = "worked" | "failed" | "partly";
type Attempt = { action: string; result: Result | ""; action_type?: string };

const DAYS: Array<Choice<Day>> = [{ value: "today", label: "Today" }, { value: "yesterday", label: "Yesterday" }];
const DIFFERS: Array<Choice<"no" | "yes">> = [{ value: "no", label: "No" }, { value: "yes", label: "Yes" }];
const RESULTS: Array<Choice<Result>> = [
  { value: "worked", label: "Worked" }, { value: "failed", label: "Didn't work" }, { value: "partly", label: "Partly" },
];

function HistoryPanel({ context }: { context: { previous_faults: DataRow[]; approved_procedures: DataRow[] } }) {
  const previous = context.previous_faults.slice(0, 3);
  return (
    <aside aria-label="History of this equipment" className="grid content-start gap-3 rounded-xl border border-border bg-card p-5 text-sm">
      <h2 className="m-0 text-base">From last time on this equipment</h2>
      {!previous.length && <p className="m-0 text-muted-foreground">No earlier reports on this equipment.</p>}
      {previous.length > 0 && <Alert variant="warning">Seen {context.previous_faults.length} time(s) before.</Alert>}
      {previous.map((fault) => (
        <div key={String(fault.id)} className="grid gap-1 border-b border-border pb-3 last:border-0">
          <strong>{spokenTime(fault.created_at).replace(/ \d\d:\d\d$/, "")} · {String(((fault.diagnoses || []) as DataRow[])[0]?.possible_cause ?? fault.symptom)}</strong>
          {((fault.interventions || []) as DataRow[]).map((item, index) => (
            <span key={index} className={item.outcome === "SUCCESS" ? "text-success" : item.outcome === "FAILED" ? "text-destructive" : "text-warning"}>
              {item.outcome === "SUCCESS" ? "Worked" : item.outcome === "FAILED" ? "Didn't work" : "Partly"}: {String(item.corrective_action)}
            </span>
          ))}
        </div>
      ))}
      {context.approved_procedures.slice(0, 2).map((item) => (
        <p key={String(item.id)} className="m-0"><strong>Procedure:</strong> {String(item.reference)}, “{String(item.title)}”</p>
      ))}
    </aside>
  );
}

/**
 * Write up a site visit afterwards, from the notebook: arrival, what was found,
 * each thing tried (including what didn't work) and when it was back in service.
 */
export function WriteUpVisit({ user }: { user: User }) {
  const { faultId = "" } = useParams();
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: ["fault", faultId, "context"], queryFn: () => loadFaultContext(faultId) });
  const [day, setDay] = useState<Day>("today");
  const [onSite, setOnSite] = useState("");
  const [back, setBack] = useState("");
  const [notBack, setNotBack] = useState(false);
  const [found, setFound] = useState("");
  const [attempts, setAttempts] = useState<Attempt[]>([{ action: "", result: "" }]);
  const [parts, setParts] = useState("");
  const [notes, setNotes] = useState("");
  const [workaround, setWorkaround] = useState(false);
  const [causeCategory, setCauseCategory] = useState("");
  const [differs, setDiffers] = useState<"no" | "yes">("no");
  const [difference, setDifference] = useState({ description: "", drawing_number: "", permanence: "PERMANENT" });
  const catalogue = useCatalogue();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState<{ signoff: boolean; offline: boolean } | null>(null);

  const canSignOff = (user.permissions || []).includes("faults.restore");
  const context = query.data?.context;
  const suggestions = useMemo(() => {
    if (!context) return [];
    const causes = [
      ...((context.ranked_causes || []) as DataRow[]).map((item) => String(item.possible_cause)),
      ...context.previous_faults.flatMap((fault) => ((fault.diagnoses || []) as DataRow[]).map((item) => String(item.possible_cause))),
    ].filter((cause) => cause && cause !== "undefined");
    return [...new Set(causes)].slice(0, 5);
  }, [context]);

  const filled = attempts.filter((item) => item.action.trim());
  const fixed = filled.some((item) => item.result === "worked") && !notBack;
  const onSiteIso = isoFromDayAndTime(day, onSite);
  const backIso = notBack ? null : isoFromDayAndTime(day, back);
  const timeProblem = onSiteIso && backIso && backIso < onSiteIso ? "Back in service is earlier than arrival. Check the times in your notebook." : "";
  const missing = [
    !onSite && "arrival time",
    !found.trim() && "what you found",
    !causeCategory && "what kind of cause",
    !filled.length && "what you did",
    differs === "yes" && !difference.description.trim() && "what differs from the drawing",
    filled.some((item) => !item.result) && "whether each step worked",
    fixed && !back && "back-in-service time",
  ].filter(Boolean) as string[];
  const ready = !missing.length && !timeProblem;
  const willSignOff = fixed && canSignOff;

  function updateAttempt(index: number, change: Partial<Attempt>) {
    setAttempts((current) => current.map((item, i) => (i === index ? { ...item, ...change } : item)));
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!ready || saving || !onSiteIso) return;
    setSaving(true);
    setError("");
    const visit = {
      on_site_at: onSiteIso,
      back_in_service_at: fixed ? backIso : null,
      found: found.trim(),
      cause_category: causeCategory,
      attempts: filled.map((item) => ({ action: item.action.trim(), result: item.result, action_type: item.action_type ?? "" })),
      drawing_difference: differs === "yes"
        ? { description: difference.description.trim(), drawing_number: difference.drawing_number.trim(), permanence: difference.permanence }
        : null,
      parts: parts.trim(),
      notes: notes.trim(),
      workaround,
      request_signoff: willSignOff,
    };
    try {
      await api(`/api/v1/faults/${encodeURIComponent(faultId)}/visits`, { method: "POST", body: JSON.stringify(visit) });
      setSaved({ signoff: willSignOff, offline: false });
    } catch (reason) {
      if (isOfflineError(reason)) {
        await queueVisit(user, faultId, visit);
        setSaved({ signoff: willSignOff, offline: true });
      } else {
        setError(errorMessage(reason, "The visit could not be saved."));
      }
    } finally {
      setSaving(false);
      await queryClient.invalidateQueries({ queryKey: ["jobs"] });
      await queryClient.invalidateQueries({ queryKey: ["fault", faultId] });
    }
  }

  if (!context) {
    return (
      <Page>
        {query.isError ? <Alert variant="destructive">{errorMessage(query.error, "This job could not be loaded.")}</Alert> : <p className="text-muted-foreground">Loading the job…</p>}
      </Page>
    );
  }
  const fault = context.fault;
  const active = context.assignments.find((item) => item.is_active);

  return (
    <Page>
      <div className="mx-auto grid max-w-6xl gap-5">
        <div>
          <Link to="/dashboard" className="text-sm font-bold">‹ My jobs</Link>
          <h1 className="mb-1 mt-2 text-3xl">Write up visit · {String(fault.equipment_tag)} {String(fault.equipment_name ?? "")}</h1>
          <p className="m-0 text-foreground/80">
            {String(fault.reference)} · <strong>{String(fault.symptom)}</strong> · {shortEffect(fault.operational_impact).toLowerCase()} · reported {spokenTime(fault.created_at)}
            {active?.acknowledged_at ? ` · you took it ${spokenTime(active.acknowledged_at)}` : ""}
          </p>
        </div>
        {query.data?.offline && <Alert variant="warning">Offline: your write-up is saved on this computer and sent when you reconnect.</Alert>}

        <div className="flex flex-wrap items-start gap-5">
          <div className="min-w-0 flex-[999_1_560px]">
            {saved ? (
              <Card>
                <CardContent className="grid gap-3 pt-6" aria-live="polite">
                  <div className="flex items-center gap-3">
                    <CheckCircle2 className="size-8 text-success" aria-hidden />
                    <h2 className="m-0 text-2xl">{saved.signoff ? "Sent to your Chief Technician for sign-off" : "Visit saved"}</h2>
                  </div>
                  {saved.offline && <p className="m-0 font-semibold text-warning">Saved on this computer; it is sent when you reconnect.</p>}
                  <p className="m-0">
                    {filled.length} step(s) recorded, including what didn't work.{" "}
                    {saved.signoff
                      ? "Once it is signed off, a procedure draft will be waiting for you in My jobs."
                      : "The job stays in My jobs until it is fixed or handed on."}
                  </p>
                  <p className="m-0 text-muted-foreground">
                    Recorded times: on site <strong className="text-foreground">{clockTime(onSiteIso)}</strong>, back in service{" "}
                    <strong className="text-foreground">{backIso && fixed ? clockTime(backIso) : "not yet"}</strong>. These are the times you entered, not the time you typed this.
                  </p>
                  <div className="flex flex-wrap gap-3 pt-2">
                    <Button asChild><Link to="/dashboard">Back to My jobs</Link></Button>
                    <Button variant="outline" asChild><Link to={`/faults?mode=history&fault=${encodeURIComponent(faultId)}`}>See the full job</Link></Button>
                  </div>
                </CardContent>
              </Card>
            ) : (
              <Card>
                <CardContent className="pt-6">
                  <form className="grid gap-7" onSubmit={submit} noValidate>
                    <div className="grid gap-3">
                      <div className="flex flex-wrap items-center gap-3">
                        <SectionLabel>When was the visit?</SectionLabel>
                        <ChoiceButtons label="Day of the visit" options={DAYS} value={day} onChange={setDay} />
                      </div>
                      <div className="grid items-start gap-4 sm:grid-cols-2">
                        <div className="grid gap-1.5">
                          <label htmlFor="visit-on-site" className="text-[15px] font-bold">Arrived on site</label>
                          <Input id="visit-on-site" type="time" value={onSite} onChange={(event) => setOnSite(event.target.value)} />
                        </div>
                        <div className="grid gap-1.5">
                          <label htmlFor="visit-back" className="text-[15px] font-bold">Back in service</label>
                          <Input id="visit-back" type="time" value={back} disabled={notBack} onChange={(event) => setBack(event.target.value)} />
                          <label className="flex items-center gap-2 text-sm">
                            <input type="checkbox" className="size-4" checked={notBack} onChange={(event) => setNotBack(event.target.checked)} />
                            Not back in service yet
                          </label>
                        </div>
                      </div>
                      {timeProblem && <p role="alert" className="m-0 text-sm font-semibold text-destructive">{timeProblem}</p>}
                    </div>

                    <div className="grid gap-2">
                      <SectionLabel htmlFor="visit-found">What did you find?</SectionLabel>
                      <Textarea id="visit-found" rows={2} className="min-h-0 [field-sizing:content]" value={found} onChange={(event) => setFound(event.target.value)} placeholder="The cause, as you would tell a colleague" />
                      {suggestions.length > 0 && (
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm text-muted-foreground">Found before on this equipment:</span>
                          {suggestions.map((cause) => (
                            <button
                              key={cause}
                              type="button"
                              onClick={() => setFound(cause)}
                              className="min-h-10 rounded-lg border border-input bg-white px-3 text-sm font-semibold hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            >
                              {cause}
                            </button>
                          ))}
                        </div>
                      )}
                      <div className="grid gap-1.5 sm:max-w-md">
                        <label htmlFor="visit-cause-category" className="text-sm font-bold">What kind of cause?</label>
                        <NativeSelect id="visit-cause-category" value={causeCategory} onChange={(event) => setCauseCategory(event.target.value)}>
                          <option value="">Choose one…</option>
                          {catalogue.data?.cause_categories.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
                        </NativeSelect>
                      </div>
                    </div>

                    <div className="grid gap-3">
                      <SectionLabel>What did you do, in order? <span className="font-medium text-muted-foreground">Keep what didn't work too. It saves the next person time.</span></SectionLabel>
                      {attempts.map((attempt, index) => (
                        <div key={index} className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-muted/50 p-3">
                          <span className="w-5 font-extrabold text-muted-foreground">{index + 1}</span>
                          {/* Two lines that grow: a long step stays readable on a phone. */}
                          <Textarea
                            aria-label={`Step ${index + 1}: what you did`}
                            rows={2}
                            value={attempt.action}
                            onChange={(event) => updateAttempt(index, { action: event.target.value })}
                            placeholder="What you did"
                            className="min-h-0 min-w-0 flex-[999_1_240px] [field-sizing:content]"
                          />
                          <ChoiceButtons
                            label={`Step ${index + 1}: did it work?`}
                            options={RESULTS}
                            value={attempt.result}
                            onChange={(result) => updateAttempt(index, { result })}
                            tone="result"
                          />
                          <NativeSelect
                            aria-label={`Step ${index + 1}: kind of action`}
                            className="w-auto min-w-[12rem]"
                            value={attempt.action_type ?? ""}
                            onChange={(event) => updateAttempt(index, { action_type: event.target.value })}
                          >
                            <option value="">Kind of action (optional)</option>
                            {catalogue.data?.action_types.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
                          </NativeSelect>
                          {attempts.length > 1 && (
                            <Button type="button" variant="ghost" size="icon" aria-label={`Remove step ${index + 1}`} onClick={() => setAttempts((current) => current.filter((_, i) => i !== index))}>
                              <Trash2 />
                            </Button>
                          )}
                        </div>
                      ))}
                      <Button type="button" variant="outline" className="justify-self-start border-dashed" onClick={() => setAttempts((current) => [...current, { action: "", result: "" }])}>
                        <Plus /> Add another thing you did
                      </Button>
                    </div>

                    <div className="grid gap-1.5">
                      <label htmlFor="visit-parts" className="text-[15px] font-bold">Parts and materials used <span className="font-medium text-muted-foreground">(optional)</span></label>
                      <Input id="visit-parts" value={parts} onChange={(event) => setParts(event.target.value)} placeholder="For example: 1 × terminal block" />
                    </div>

                    <div className="grid gap-3">
                      <div className="flex flex-wrap items-center gap-3">
                        <SectionLabel>Did you find or change anything that differs from the drawing?</SectionLabel>
                        <ChoiceButtons label="Differs from the drawing" options={DIFFERS} value={differs} onChange={setDiffers} />
                      </div>
                      {differs === "yes" && (
                        <div className="grid gap-3 rounded-lg border border-border bg-muted/50 p-3">
                          <div className="grid gap-1.5">
                            <label htmlFor="visit-difference" className="text-sm font-bold">What is different?</label>
                            <Input id="visit-difference" value={difference.description} placeholder="For example: close limit switch on terminal X5, drawing shows X3"
                              onChange={(event) => setDifference({ ...difference, description: event.target.value })} />
                          </div>
                          <div className="grid gap-3 sm:grid-cols-2">
                            <div className="grid gap-1.5">
                              <label htmlFor="visit-drawing-number" className="text-sm font-bold">Drawing number <span className="font-medium text-muted-foreground">(if you know it)</span></label>
                              <Input id="visit-drawing-number" value={difference.drawing_number}
                                onChange={(event) => setDifference({ ...difference, drawing_number: event.target.value })} />
                            </div>
                            <div className="grid gap-1.5">
                              <label htmlFor="visit-permanence" className="text-sm font-bold">Is it permanent?</label>
                              <NativeSelect id="visit-permanence" value={difference.permanence} onChange={(event) => setDifference({ ...difference, permanence: event.target.value })}>
                                <option value="PERMANENT">Permanent change</option>
                                <option value="TEMPORARY">Temporary (to be put back)</option>
                              </NativeSelect>
                            </div>
                          </div>
                          <p className="m-0 text-xs text-muted-foreground">Your Chief Technician verifies it; then it is printed on every job card for this equipment and sent to the drawing office.</p>
                        </div>
                      )}
                    </div>

                    <details className="rounded-lg border border-border px-4 py-3">
                      <summary className="cursor-pointer font-bold text-ring">More detail (optional)</summary>
                      <div className="grid gap-4 pt-4">
                        <div className="grid gap-1.5">
                          <label htmlFor="visit-notes" className="text-[15px] font-bold">Other notes</label>
                          <Textarea id="visit-notes" value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Readings, tests, anything unusual" />
                        </div>
                        <label className="flex items-center gap-2 text-[15px]">
                          <input type="checkbox" className="size-4" checked={workaround} onChange={(event) => setWorkaround(event.target.checked)} />
                          This was a temporary fix. It needs a proper repair later.
                        </label>
                      </div>
                    </details>

                    {error && <Alert variant="destructive">{error}</Alert>}
                    <div className="flex flex-wrap items-center gap-4 border-t border-border pt-5">
                      <Button type="submit" size="lg" disabled={!ready || saving}>
                        {saving ? "Saving…"
                          : willSignOff ? "Save and ask Chief to sign off"
                            : fixed || !filled.some((item) => item.result) ? "Save visit" : "Save visit (not fixed yet)"}
                      </Button>
                      <span className={cn("text-sm", ready ? "text-muted-foreground" : "text-foreground")}>
                        {ready
                          ? willSignOff ? "Your Chief Technician checks it next, then Operations confirms."
                            : fixed ? "A Senior or Principal Technician asks for sign-off on this job."
                              : "The job stays with you. Hand it to another section from the full job page if needed."
                          : `Still needed: ${missing.join(", ")}.`}
                      </span>
                    </div>
                  </form>
                </CardContent>
              </Card>
            )}
          </div>
          <div className="grid min-w-0 flex-[1_1_300px] content-start gap-4">
            <EquipmentKnowledge context={context} compact />
            <HistoryPanel context={context} />
            <SimilarFaults user={user} faultId={faultId} compact />
          </div>
        </div>
      </div>
    </Page>
  );
}
