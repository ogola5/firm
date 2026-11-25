import { useQuery } from "@tanstack/react-query";
import { Printer } from "lucide-react";
import { Link, useParams } from "react-router-dom";
import { type User } from "../../auth";
import { Alert } from "../../components/ui/alert";
import { Button } from "../../components/ui/button";
import { shortEffect, spokenTime } from "../../lib/format";
import { errorMessage } from "../../lib/query";
import { type DataRow } from "../../lib/types";
import { loadFaultContext } from "../faults/detail/context";

const Line = () => <div className="h-7 border-b-[1.5px] border-black" />;

function Tick({ label }: { label: string }) {
  return <span className="inline-flex items-center gap-1.5 whitespace-nowrap"><span className="inline-block size-4 border-[1.5px] border-black" />{label}</span>;
}

/**
 * One A4 sheet to take on the job: the problem, what worked and failed last
 * time, and note lines in the same order as the write-up screen, so notes
 * copy straight across.
 */
export function JobCard({ user }: { user: User }) {
  const { faultId = "" } = useParams();
  const query = useQuery({ queryKey: ["fault", faultId, "context"], queryFn: () => loadFaultContext(faultId) });
  const context = query.data?.context;
  if (!context) {
    return (
      <div className="p-8">
        {query.isError ? <Alert variant="destructive">{errorMessage(query.error, "This job could not be loaded.")}</Alert> : <p className="text-muted-foreground">Loading the job card…</p>}
      </div>
    );
  }
  const fault = context.fault;
  const active = context.assignments.find((item) => item.is_active);
  const previous = context.previous_faults.slice(0, 2);
  const procedure = context.approved_procedures[0];
  const differences = context.drawing_differences ?? [];
  const notes = (context.expert_notes ?? []).slice(0, 1);
  const drawings = context.drawings ?? [];
  const seen = fault.seen_via === "SCADA" ? "On SCADA" : fault.seen_via === "SITE_WALK" ? "On a site walk" : "Reported";

  return (
    <div className="p-4 md:p-8 print:p-0">
      <div className="mx-auto mb-4 flex max-w-[794px] flex-wrap items-center justify-between gap-3 print:hidden">
        <Link to="/dashboard" className="text-sm font-bold">‹ My jobs</Link>
        <Button onClick={() => window.print()}><Printer /> Print job card</Button>
      </div>

      <article
        aria-label="Job card"
        className="mx-auto flex min-h-[1123px] w-full max-w-[794px] flex-col gap-4 bg-white px-12 py-11 text-[15px] leading-snug text-black shadow-md print:min-h-0 print:max-w-none print:px-0 print:py-0 print:shadow-none"
      >
        <header className="flex items-start justify-between gap-4 border-b-2 border-black pb-2.5">
          <div>
            <div className="text-xs font-extrabold tracking-[0.14em]">KPC MAINTENANCE · JOB CARD</div>
            <div className="text-3xl font-extrabold leading-tight">{String(fault.reference)}</div>
          </div>
          <div className="text-right text-xs">
            Printed {spokenTime(new Date().toISOString())}<br />
            For: {user.display_name}<br />
            <strong>Illustrative demonstration data</strong>
          </div>
        </header>

        <div>
          <div className="text-2xl font-extrabold">{String(fault.equipment_tag)} · {String(fault.equipment_name ?? "")}</div>
          <div>{String(fault.equipment_location ?? fault.reported_location ?? "")}{active ? ` · ${String(active.section)} section` : ""}</div>
        </div>

        {Boolean(fault.safety_hazard) && (
          <div className="border-[3px] border-black px-3.5 py-2 text-lg font-extrabold">
            SAFETY: the reporter says someone or something is at risk. Follow the permit and isolation procedure before you start.
          </div>
        )}
        <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 rounded-md border-[1.5px] border-black px-3.5 py-3">
          <div><strong>Problem:</strong> {String(fault.symptom)}</div>
          <div><strong>Effect:</strong> {shortEffect(fault.operational_impact) || "—"} (priority {String(fault.severity ?? "—")})</div>
          <div><strong>Seen:</strong> {seen}, {spokenTime(fault.observed_at || fault.created_at)}</div>
          <div><strong>Respond by:</strong> {active?.response_due_at ? spokenTime(active.response_due_at) : "—"}</div>
          {Boolean(fault.description) && (
            <div className="col-span-2 grid gap-0.5">
              <strong>What Operations reported:</strong>
              {String(fault.description).split("\n").filter((line) => !line.startsWith("⚠")).map((line, index) => <span key={index}>{line}</span>)}
            </div>
          )}
          {Boolean(fault.callback) && <div className="col-span-2"><strong>Reach the reporter on:</strong> {String(fault.callback)}</div>}
          {Boolean(active?.instructions) && <div className="col-span-2"><strong>Chief Technician's note:</strong> {String(active?.instructions)}</div>}
          {Boolean(active?.findings) && <div className="col-span-2"><strong>Found by the previous section:</strong> {String(active?.findings)}</div>}
        </div>

        <section className="grid gap-1">
          <div className="text-[13px] font-extrabold tracking-[0.1em]">FROM LAST TIME ON THIS EQUIPMENT</div>
          {!previous.length && <div>No earlier reports on this equipment.</div>}
          {previous.length > 0 && <div>Seen {context.previous_faults.length} time(s) before.</div>}
          {previous.map((item) => (
            <div key={String(item.id)}>
              {spokenTime(item.created_at).replace(/ \d\d:\d\d$/, "")}: {String(((item.diagnoses || []) as DataRow[])[0]?.possible_cause ?? item.symptom)}.{" "}
              {((item.interventions || []) as DataRow[]).map((step, index) => (
                <span key={index}><strong>{step.outcome === "SUCCESS" ? "Worked" : step.outcome === "FAILED" ? "Didn't work" : "Partly"}:</strong> {String(step.corrective_action)}. </span>
              ))}
            </div>
          ))}
          {procedure && <div><strong>Procedure:</strong> {String(procedure.reference)}, “{String(procedure.title)}”</div>}
        </section>

        {differences.length > 0 && (
          <section className="grid gap-1 border-[2.5px] border-black px-3.5 py-2.5">
            <div className="text-[13px] font-extrabold tracking-[0.1em]">DIFFERS FROM THE DRAWING: CHECK BEFORE YOU WORK</div>
            {differences.map((item) => (
              <div key={item.id}>
                <strong>{item.description}</strong>
                {item.drawing_number ? ` (drawing ${item.drawing_number}${item.drawing_revision ? ` rev ${item.drawing_revision}` : ""})` : ""}
                {item.permanence === "TEMPORARY" ? " · temporary" : ""}{item.status === "REPORTED" ? " · reported, not yet verified" : ""}
              </div>
            ))}
          </section>
        )}

        {(notes.length > 0 || drawings.length > 0 || Boolean(active?.adviser_name)) && (
          <section className="grid gap-1">
            {notes.map((note) => (
              <div key={note.id}>
                <strong>From an experienced colleague ({note.credit.replace("Expert knowledge: ", "")}):</strong> first check {note.first_checks}
                {note.what_fools_people ? ` What fools people: ${note.what_fools_people}` : ""}
              </div>
            ))}
            {drawings.length > 0 && (
              <div><strong>Drawings:</strong> {drawings.map((item) => `${item.number}${item.revision ? ` rev ${item.revision}` : ""}${item.status === "PAPER" ? " (paper)" : ""}`).join("; ")}</div>
            )}
            {Boolean(active?.adviser_name) && <div><strong>Adviser on this job:</strong> {String(active?.adviser_name)}</div>}
          </section>
        )}

        <section className="flex flex-1 flex-col gap-3.5 border-t-2 border-black pt-3">
          <div className="text-[13px] font-extrabold tracking-[0.1em]">YOUR NOTES (SAME ORDER AS THE WRITE-UP SCREEN)</div>
          <div className="flex flex-wrap items-end gap-7">
            <span className="flex items-end gap-2"><strong>Arrived on site</strong><span className="inline-block h-5 w-24 border-b-[1.5px] border-black" /></span>
            <span className="flex items-end gap-2"><strong>Back in service</strong><span className="inline-block h-5 w-24 border-b-[1.5px] border-black" /></span>
            <Tick label="Not back in service" />
          </div>
          <div className="grid gap-1"><strong>What I found</strong><Line /><Line /></div>
          <div className="grid gap-1">
            <div className="flex justify-between"><strong>What I did, in order</strong><strong>Did it work?</strong></div>
            {[1, 2, 3].map((number) => (
              <div key={number} className="flex items-end gap-3.5">
                <span className="w-4">{number}</span>
                <span className="h-7 flex-1 border-b-[1.5px] border-black" />
                <span className="flex gap-3"><Tick label="Yes" /><Tick label="No" /><Tick label="Partly" /></span>
              </div>
            ))}
          </div>
          <div className="grid gap-1"><strong>Parts and materials used</strong><Line /></div>
          <div className="flex flex-wrap items-end gap-4"><strong>Anything different from the drawing?</strong><Tick label="No" /><Tick label="Yes:" /><span className="h-6 flex-1 border-b-[1.5px] border-black" /></div>
          <div className="grid gap-1"><strong>Other notes</strong><Line /><Line /><Line /></div>
        </section>

        <footer className="flex justify-between gap-4 border-t-2 border-black pt-2.5 text-[13px]">
          <span>Back at your desk: KPC Maintenance › My jobs › To write up.</span>
          <span>Follow permit, isolation and site safety procedures.</span>
        </footer>
      </article>
    </div>
  );
}
