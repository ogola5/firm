import { ChevronLeft, ChevronRight, Presentation, X } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "../../components/ui/button";
import { Card, CardContent } from "../../components/ui/card";
import { errorMessage } from "../../lib/query";
import { toast } from "../../lib/toast";
import { api } from "../../offline/api";
import { endTour, showChapter, STORY, tourStep } from "./story";

async function go(index: number, setBusy: (busy: boolean) => void) {
  setBusy(true);
  try {
    await showChapter(index, (path, init) => api(path, init));
  } catch (reason) {
    toast.error(errorMessage(reason, "Could not switch account. Is the server running?"));
    setBusy(false);
  }
}

/** The story, chapter by chapter, for presenting to the board. */
export function Tour() {
  const [busy, setBusy] = useState(false);
  return (
    <main className="mx-auto grid max-w-3xl gap-4 p-4 md:p-8">
      <div>
        <p className="m-0 text-2xs font-extrabold uppercase tracking-[0.12em] text-muted-foreground">Guided demo · illustrative data</p>
        <h1 className="flex items-center gap-2"><Presentation className="size-7" />One fault, from report to knowledge</h1>
        <p className="m-0 text-muted-foreground">Line 4 pump A will not start. Follow it through each person's screen. Each chapter switches to that person's demonstration account.</p>
      </div>
      <Button size="lg" className="w-fit" disabled={busy} onClick={() => void go(0, setBusy)}>Start the demo<ChevronRight /></Button>
      <ol className="m-0 grid gap-3 p-0">
        {STORY.map((chapter, index) => (
          <li key={chapter.title} className="list-none">
            <Card>
              <CardContent className="flex items-start justify-between gap-3 pt-5">
                <div className="min-w-0 flex-1">
                  <p className="m-0 text-xs font-bold text-muted-foreground">{index + 1} · {chapter.who}</p>
                  <p className="m-0 text-base font-bold">{chapter.title}</p>
                  <ul className="m-0 mt-1 grid gap-0.5 pl-5 text-sm">{chapter.notice.map((line) => <li key={line}>{line}</li>)}</ul>
                </div>
                <Button variant="outline" className="shrink-0" disabled={busy} onClick={() => void go(index, setBusy)}>Show</Button>
              </CardContent>
            </Card>
          </li>
        ))}
      </ol>
      <Link to="/" className="text-sm font-bold">‹ Back to sign in</Link>
    </main>
  );
}

/** While the demo runs: which chapter, what to notice, and the next chapter, on every screen. */
export function TourBar() {
  const [step, setStep] = useState(tourStep);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(true);
  if (step === null) return null;
  const chapter = STORY[step];
  return (
    <aside aria-label="Guided demo" className="sticky top-14 z-20 border-b border-primary/30 bg-primary/10 px-3 py-2 text-sm backdrop-blur md:top-16 md:px-7 print:hidden">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <button type="button" className="min-w-0 text-left" onClick={() => setOpen(!open)} aria-expanded={open}>
          <span className="font-bold">Demo {step + 1}/{STORY.length}: {chapter.title}</span>
          <span className="text-muted-foreground"> · {chapter.who}</span>
        </button>
        <div className="flex items-center gap-1">
          <Button size="sm" variant="ghost" disabled={busy || step === 0} onClick={() => void go(step - 1, setBusy)} aria-label="Previous chapter"><ChevronLeft /></Button>
          {step < STORY.length - 1
            ? <Button size="sm" disabled={busy} onClick={() => void go(step + 1, setBusy)}>Next<ChevronRight /></Button>
            : <Button size="sm" onClick={() => { endTour(); setStep(null); toast.success("Demo finished."); }}>Finish</Button>}
          <Button size="sm" variant="ghost" aria-label="End the demo" onClick={() => { endTour(); setStep(null); }}><X /></Button>
        </div>
      </div>
      {open && <ul className="m-0 mt-1 grid gap-0.5 pl-5 text-muted-foreground">{chapter.notice.map((line) => <li key={line}>{line}</li>)}</ul>}
    </aside>
  );
}
