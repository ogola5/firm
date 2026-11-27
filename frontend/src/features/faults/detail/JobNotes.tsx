import { MessageSquare } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Button } from "../../../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../../../components/ui/card";
import { Textarea } from "../../../components/ui/form-controls";
import { spokenTime } from "../../../lib/format";
import { cn } from "../../../lib/utils";
import { api } from "../../../offline/api";
import { useDetail } from "./context";

const WRITERS = [
  "systems_automation", "technician_st", "technician_pt", "technician_ct", "assistant_engineer", "engineer", "senior_engineer",
  "chief_engineer", "maintenance_manager", "general_manager_om", "supervisor", "system_administrator",
];

/**
 * Notes on the job, at the top of the fault: the Chief Technician's instructions and comments, questions and
 * answers. Whoever takes the job sees them here, on the job card and in My jobs, and is told of each new one.
 * The person on the job can ask the Chief Technician for help from here.
 */
export function JobNotes() {
  const { faultId, context, can, user, offline, done, fail } = useDetail();
  const [note, setNote] = useState("");
  const [askChief, setAskChief] = useState(false);
  const [busy, setBusy] = useState(false);
  const notes = context.job_notes ?? [];
  const instructions = String(can.activeAssignment?.instructions ?? "");
  const canWrite = WRITERS.includes(user.role) && !offline && !["CLOSED"].includes(can.status);
  if (!notes.length && !instructions && !canWrite) return null;

  async function send(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      await api(`/api/v1/faults/${encodeURIComponent(faultId)}/notes`, {
        method: "POST", body: JSON.stringify({ note, ask_chief: askChief }),
      });
      setNote("");
      setAskChief(false);
      await done(askChief ? "Sent. Your Chief Technician has been asked." : can.onTheJob ? "Note added." : "Note sent to whoever is on the job.");
    } catch (reason) {
      fail(reason, "The note was not sent.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card id="fault-notes" aria-label="Notes on this job" className={cn((notes.length > 0 || instructions) && "border-primary/50")}>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-lg"><MessageSquare className="size-5" aria-hidden /> Notes on this job{notes.length ? ` (${notes.length})` : ""}</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-3">
        {instructions && (
          <div className="rounded-lg border-l-4 border-l-primary bg-primary/5 px-3 py-2">
            <strong className="text-sm">Chief Technician's instructions</strong>
            <p className="m-0 whitespace-pre-line text-[15px]">{instructions}</p>
          </div>
        )}
        {notes.length > 0 && (
          <ol className="m-0 grid gap-2 p-0">
            {notes.map((item) => (
              <li key={item.id} className={cn("list-none rounded-lg border px-3 py-2", item.ask_chief ? "border-warning/60 bg-warning/5" : "border-border")}>
                <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
                  <strong>{item.by}{item.ask_chief ? " asked the Chief Technician for help" : ""}</strong>
                  <span className="text-muted-foreground">{spokenTime(item.created_at)}</span>
                </div>
                <p className="m-0 whitespace-pre-line text-[15px]">{item.note}</p>
              </li>
            ))}
          </ol>
        )}
        {!notes.length && !instructions && <p className="m-0 text-sm text-muted-foreground">No notes yet. Notes reach whoever is on the job.</p>}
        {canWrite && (
          <form onSubmit={send} className="grid gap-2">
            <Textarea aria-label="Add a note" value={note} onChange={(event) => setNote(event.target.value)} rows={2}
              placeholder={can.onTheJob ? "What you found, what you need, a question…" : "Instructions or a comment for whoever does the job"} />
            <div className="flex flex-wrap items-center justify-between gap-2">
              {can.onTheJob && !can.isSectionChief
                ? (
                  <label className="flex items-center gap-2 text-sm font-semibold">
                    <input type="checkbox" className="size-5" checked={askChief} onChange={(event) => setAskChief(event.target.checked)} />
                    Ask the Chief Technician for help
                  </label>
                )
                : <span />}
              <Button type="submit" disabled={busy || !note.trim()}>{askChief ? "Send and ask" : "Add note"}</Button>
            </div>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
