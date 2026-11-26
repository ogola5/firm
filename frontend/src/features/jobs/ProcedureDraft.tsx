import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2 } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { type User } from "../../auth";
import { Alert } from "../../components/ui/alert";
import { Button } from "../../components/ui/button";
import { Card, CardContent } from "../../components/ui/card";
import { Input, Textarea } from "../../components/ui/form-controls";
import { Page, PageHeader } from "../../components/ui/page";
import { errorMessage } from "../../lib/query";
import { type DataRow, type FaultContext } from "../../lib/types";
import { api } from "../../offline/api";
import { loadFaultContext } from "../faults/detail/context";
import { skipProcedure } from "./data";

type ProcedureMatch = {
  id: string; reference: string; title: string; version: number; author: string; reasons: string[];
  evidence: { worked: number; fading: boolean };
};

type Draft = { title: string; symptom: string; cause: string; check: string; fix: string; avoid: string; tools: string; safety: string };

/** Builds the draft from what the technician already recorded, so nothing is retyped. */
export function draftFromContext(context: FaultContext, userId: string): Draft {
  const fault = context.fault;
  const mine = (rows: DataRow[], key: string) => rows.filter((row) => row[key] === userId);
  const diagnoses = mine(context.diagnoses, "author_id");
  const interventions = mine(context.interventions, "actor_id");
  const diagnosis = [...diagnoses].reverse().find((item) => item.verification_status === "CONFIRMED") ?? diagnoses[diagnoses.length - 1];
  const cause = String(diagnosis?.possible_cause ?? "");
  // The fix is what got it working: one step, or the whole sequence in order when it took several
  // (steps that partly worked are part of the sequence; steps that did not work go under "Don't bother with").
  const sequence = interventions.filter((item) => item.outcome === "SUCCESS" || item.outcome === "IN_PROGRESS");
  const fix = sequence.length === 1
    ? String(sequence[0].corrective_action)
    : sequence.map((item, index) => `${index + 1}. ${String(item.corrective_action)}`).join("\n");
  const failedHere = interventions.filter((item) => item.outcome === "FAILED").map((item) => String(item.corrective_action));
  const failedBefore = context.previous_faults.flatMap((item) => ((item.interventions || []) as DataRow[])
    .filter((step) => step.outcome === "FAILED").map((step) => String(step.corrective_action)));
  const avoid = [...new Set([...failedHere, ...failedBefore])];
  const tools = [...new Set(sequence.map((item) => String(item.tools_materials ?? "").trim()).filter(Boolean))].join("; ");
  const equipment = String(fault.equipment_name ?? fault.equipment_tag);
  return {
    title: cause ? `${String(fault.symptom)} on ${equipment}: check ${cause.charAt(0).toLowerCase()}${cause.slice(1)}` : `${String(fault.symptom)} on ${equipment}`,
    symptom: `${String(fault.symptom)} on ${String(fault.equipment_tag)} (${equipment}).`,
    cause,
    check: String(diagnosis?.quick_check || "") || (cause ? `Check for: ${cause}.` : ""),
    fix,
    avoid: avoid.length ? `${avoid.join("; ")}. These did not fix it.` : "",
    tools,
    safety: "",
  };
}

const FIELDS: Array<{ key: keyof Draft; label: string; from?: string; multiline?: boolean; placeholder?: string }> = [
  { key: "title", label: "Title" },
  { key: "symptom", label: "When you see", from: "From the fault report", multiline: true },
  { key: "cause", label: "Likely cause", from: "From “What did you find?”", multiline: true },
  { key: "check", label: "Check this first", multiline: true },
  { key: "fix", label: "Fix", from: "From the steps that got it working, in order", multiline: true },
  { key: "avoid", label: "Don't bother with", from: "From the steps that didn't work, on this job and earlier ones", multiline: true },
  { key: "tools", label: "Tools and parts", from: "From what you used on the visit", multiline: true, placeholder: "For example: loop calibrator, M20 cable gland, desiccant packs" },
  { key: "safety", label: "Safety", from: "Add permit or isolation points if this job needs them", multiline: true, placeholder: "For example: isolate the actuator supply at the MCC before opening the terminal box" },
];

/** The technician checks a procedure drafted from their write-up, then sends it for review. */
export function ProcedureDraft({ user }: { user: User }) {
  const { faultId = "" } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: ["fault", faultId, "context"], queryFn: () => loadFaultContext(faultId) });
  const [draft, setDraft] = useState<Draft | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);
  // Approved procedures this fix might add to (same equipment type, problem or cause): a new version, not a duplicate.
  const matches = useQuery({
    queryKey: ["fault", faultId, "procedure-matches"],
    queryFn: () => api<ProcedureMatch[]>(`/api/v1/faults/${encodeURIComponent(faultId)}/procedure-matches`),
  });
  const [buildsOn, setBuildsOn] = useState<string | null>(null); // null: not chosen yet; "": a new procedure
  const chosen = matches.data?.find((item) => item.id === buildsOn);
  const [changeReason, setChangeReason] = useState("");

  useEffect(() => {
    if (query.data && !draft) setDraft(draftFromContext(query.data.context, user.id));
  }, [query.data, draft, user.id]);

  const required: Array<keyof Draft> = ["title", "symptom", "cause", "fix"];
  const missing = draft ? required.filter((key) => !draft[key].trim()) : required;

  async function send(event: FormEvent) {
    event.preventDefault();
    if (!draft || missing.length || sending) return;
    setSending(true);
    setError("");
    try {
      await api(`/api/v1/faults/${encodeURIComponent(faultId)}/procedure-updates`, {
        method: "POST",
        body: JSON.stringify({
          title: draft.title.trim(),
          observed_symptom: draft.symptom.trim(),
          confirmed_cause: draft.cause.trim(),
          diagnostic_procedure: [draft.check.trim() || `Check for: ${draft.cause.trim()}.`, draft.avoid.trim() && `Don't bother with: ${draft.avoid.trim()}`]
            .filter(Boolean).join("\n"),
          corrective_action: draft.fix.trim(),
          safety: draft.safety.trim(),
          tools_materials: draft.tools.trim(),
          ...(buildsOn ? { builds_on_id: buildsOn, change_reason: changeReason.trim() } : {}),
        }),
      });
      setSent(true);
      await queryClient.invalidateQueries({ queryKey: ["jobs"] });
    } catch (reason) {
      setError(errorMessage(reason, "The procedure could not be sent."));
    } finally {
      setSending(false);
    }
  }

  const equipment = query.data ? `${String(query.data.context.fault.equipment_tag)}` : "";
  return (
    <Page>
      <div className="mx-auto grid max-w-3xl gap-5">
        <div>
          <Link to="/dashboard" className="text-sm font-bold">‹ My jobs</Link>
          <PageHeader className="mb-0 mt-2" title="Check the procedure draft" description={`We wrote this from your visit to ${equipment}. Correct anything that is wrong, then send it. No retyping.`} />
        </div>
        {query.isError && <Alert variant="destructive">{errorMessage(query.error, "This job could not be loaded.")}</Alert>}

        {sent && (
          <Card>
            <CardContent className="grid gap-3 pt-6" aria-live="polite">
              <div className="flex items-center gap-3"><CheckCircle2 className="size-8 text-success" aria-hidden /><h2 className="m-0 text-2xl">Sent for review</h2></div>
              <p className="m-0">
                {chosen
                  ? `It becomes version ${chosen.version + 1} of ${chosen.reference} once published, with your name added to it. The earlier version stays in the history.`
                  : "Your Chief Technician reviews it. Once a Supervisor publishes it, everyone sees it, with your name on it."}
              </p>
              <div><Button asChild><Link to="/dashboard">Back to My jobs</Link></Button></div>
            </CardContent>
          </Card>
        )}

        {!sent && draft && matches.data && matches.data.length > 0 && (
          <Card aria-label="Similar procedures">
            <CardContent className="grid gap-3 pt-6">
              <h2 className="m-0 text-lg">Does this add to a procedure we already have?</h2>
              <p className="m-0 text-sm text-muted-foreground">Improving an existing procedure keeps one clear answer for everyone and credits you as a contributor.</p>
              {matches.data.map((item) => (
                <label key={item.id} className={`grid cursor-pointer gap-1 rounded-lg border p-3 ${buildsOn === item.id ? "border-primary bg-primary/5" : "border-border"}`}>
                  <span className="flex items-start gap-2">
                    <input type="radio" name="builds-on" className="mt-1 size-4" checked={buildsOn === item.id} onChange={() => setBuildsOn(item.id)} />
                    <span>
                      <strong>Add to {item.reference} (v{item.version})</strong>: {item.title}
                      <span className="block text-xs text-muted-foreground">
                        {item.reasons.join(" · ")} · worked {item.evidence.worked} time(s){item.author ? ` · by ${item.author}` : ""}
                      </span>
                    </span>
                  </span>
                </label>
              ))}
              {chosen && (
                <div className="grid gap-1.5">
                  <label htmlFor="change-reason" className="text-[15px] font-bold">What does your version add or change? <span className="block text-xs font-semibold text-muted-foreground">Shown to reviewers next to a side-by-side comparison</span></label>
                  <Textarea id="change-reason" rows={2} value={changeReason} onChange={(event) => setChangeReason(event.target.value)}
                    placeholder="e.g. it blocks again within a week if the upstream tank has sediment: added that check" />
                </div>
              )}
              <label className={`flex cursor-pointer items-center gap-2 rounded-lg border p-3 ${buildsOn === "" ? "border-primary bg-primary/5" : "border-border"}`}>
                <input type="radio" name="builds-on" className="size-4" checked={buildsOn === ""} onChange={() => setBuildsOn("")} />
                <strong>No, this is a different problem: start a new procedure</strong>
              </label>
            </CardContent>
          </Card>
        )}

        {!sent && draft && (
          <Card>
            <CardContent className="pt-6">
              <form className="grid gap-5" onSubmit={send} noValidate>
                {FIELDS.map((field) => {
                  const id = `draft-${field.key}`;
                  const Control = field.multiline ? Textarea : Input;
                  return (
                    <div key={field.key} className="grid gap-1.5">
                      <label htmlFor={id} className="text-[15px] font-bold">
                        {field.label} {field.from && <span className="block text-xs font-semibold text-muted-foreground">{field.from}</span>}
                      </label>
                      <Control
                        id={id}
                        value={draft[field.key]}
                        placeholder={field.placeholder}
                        onChange={(event: { target: { value: string } }) => setDraft({ ...draft, [field.key]: event.target.value })}
                      />
                    </div>
                  );
                })}
                {error && <Alert variant="destructive">{error}</Alert>}
                <div className="flex flex-wrap items-center gap-4 border-t border-border pt-5">
                  <Button type="submit" size="lg" disabled={missing.length > 0 || sending || (Boolean(matches.data?.length) && buildsOn === null) || (Boolean(chosen) && changeReason.trim().length < 5)}>
                    {sending ? "Sending…" : chosen ? `Send as an improvement to ${chosen.reference}` : "Send for review"}
                  </Button>
                  <Button type="button" variant="outline" onClick={() => { skipProcedure(user.id, faultId); navigate("/dashboard"); }}>Nothing new to add</Button>
                  <span className="text-sm text-muted-foreground">
                    {missing.length ? `Still needed: ${missing.join(", ")}.`
                      : matches.data?.length && buildsOn === null ? "First say whether it adds to an existing procedure (above)."
                        : chosen && changeReason.trim().length < 5 ? "Say what your version adds or changes (above)."
                        : "Your Chief Technician checks it, then a Supervisor publishes it."}
                  </span>
                </div>
              </form>
            </CardContent>
          </Card>
        )}
      </div>
    </Page>
  );
}
