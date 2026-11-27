import { HelpCircle, X } from "lucide-react";
import { useId, useState } from "react";
import { Link } from "react-router-dom";
import { type User } from "../../auth";
import { Button } from "../../components/ui/button";
import { guideFor, TERMS } from "./guides";

const dismissedKey = (user: User) => `kpc-welcome-dismissed:${user.id}:${user.access.home}`;

/** Three lines on what this home is for, shown until the person dismisses it (kept on this device). */
export function Welcome({ user }: { user: User }) {
  const [hidden, setHidden] = useState(() => localStorage.getItem(dismissedKey(user)) === "1");
  if (hidden) return null;
  const guide = guideFor(user.access.home);
  return (
    <section aria-label="Welcome" className="mb-4 rounded-xl border border-primary/30 bg-primary/5 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="grid gap-1">
          <strong className="text-base">Welcome. Here is how this page works:</strong>
          <ol className="m-0 grid gap-0.5 pl-5 text-[15px]">{guide.welcome.map((line) => <li key={line}>{line}</li>)}</ol>
          <Link to="/guide" className="mt-1 text-sm font-bold">Open the quick guide for your role</Link>
        </div>
        <Button variant="ghost" size="sm" aria-label="Got it, hide this" onClick={() => { localStorage.setItem(dismissedKey(user), "1"); setHidden(true); }}>
          <X /><span className="hidden sm:inline">Got it</span>
        </Button>
      </div>
    </section>
  );
}

/** A small "?" next to a term; tap or click to read what it means. */
export function Term({ name, label }: { name: keyof typeof TERMS | string; label?: string }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const text = TERMS[name];
  if (!text) return null;
  return (
    <span className="relative inline-flex align-middle">
      <button type="button" aria-expanded={open} aria-controls={id} aria-label={`What is ${label ?? name.replace(/-/g, " ")}?`}
        onClick={() => setOpen(!open)}
        className="inline-grid size-6 place-items-center rounded-full text-muted-foreground hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <HelpCircle className="size-4" aria-hidden />
      </button>
      {open && (
        <span id={id} role="note" className="absolute left-0 top-7 z-40 w-72 max-w-[80vw] rounded-lg border border-border bg-card p-3 text-left text-sm font-normal normal-case tracking-normal text-foreground shadow-lg">
          {text}
        </span>
      )}
    </span>
  );
}
