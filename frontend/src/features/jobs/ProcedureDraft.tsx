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

type Draft = { title: string; symptom: string; cause: string; check: string; fix: string; avoid: string; safety: string };

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
  const equipment = String(fault.equipment_name ?? fault.equipment_tag);
  return {
    title: cause ? `${String(fault.symptom)} on ${equipment}: check ${cause.charAt(0).toLowerCase()}${cause.slice(1)}` : `${String(fault.symptom)} on ${equipment}`,
    symptom: `${String(fault.symptom)} on ${String(fault.equipment_tag)} (${equipment}).`,
    cause,
    check: String(diagnosis?.quick_check || "") || (cause ? `Check for: ${cause}.` : ""),
    fix,
    avoid: avoid.length ? `${avoid.join("; ")}. These did not fix it.` : "",
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
              <p className="m-0">Your Chief Technician reviews it. Once a Supervisor publishes it, everyone sees it, with your name on it.</p>
              <div><Button asChild><Link to="/dashboard">Back to My jobs</Link></Button></div>
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
                  <Button type="submit" size="lg" disabled={missing.length > 0 || sending}>{sending ? "Sending…" : "Send for review"}</Button>
                  <Button type="button" variant="outline" onClick={() => { skipProcedure(user.id, faultId); navigate("/dashboard"); }}>Nothing new to add</Button>
                  <span className="text-sm text-muted-foreground">
                    {missing.length ? `Still needed: ${missing.join(", ")}.` : "Your Chief Technician checks it, then a Supervisor publishes it."}
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
