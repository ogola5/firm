import { AlertCircle, CheckCircle2, Info, X } from "lucide-react";
import { useEffect, useState } from "react";
import { dismiss, subscribe, type Toast } from "../../lib/toast";
import { cn } from "../../lib/utils";

/** Bottom of the screen, above the phone's bottom tabs; announced to screen readers. */
export function Toaster() {
  const [items, setItems] = useState<Toast[]>([]);
  useEffect(() => subscribe(setItems), []);
  return (
    <div aria-live="polite" aria-label="Messages"
      className="pointer-events-none fixed inset-x-0 bottom-[calc(5rem+env(safe-area-inset-bottom))] z-[60] flex flex-col items-center gap-2 px-3 md:bottom-6 md:items-end md:pr-6 print:hidden">
      {items.map((item) => (
        <div key={item.id} className={cn(
          "pointer-events-auto flex w-full max-w-md items-start gap-2.5 rounded-xl border px-4 py-3 text-sm font-semibold shadow-lg toast-in",
          item.tone === "success" && "border-success/40 bg-card text-foreground",
          item.tone === "error" && "border-destructive/50 bg-card text-foreground",
          item.tone === "info" && "border-border bg-card text-foreground",
        )}>
          {item.tone === "success" ? <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-success" aria-hidden />
            : item.tone === "error" ? <AlertCircle className="mt-0.5 size-5 shrink-0 text-destructive" aria-hidden />
              : <Info className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden />}
          <span className="flex-1">{item.text}</span>
          {item.action && (
            <button type="button" className="font-extrabold text-primary underline-offset-4 hover:underline"
              onClick={() => { item.action!.run(); dismiss(item.id); }}>{item.action.label}</button>
          )}
          <button type="button" aria-label="Dismiss" className="-mr-1 grid size-6 place-items-center rounded text-muted-foreground hover:bg-secondary" onClick={() => dismiss(item.id)}>
            <X className="size-4" />
          </button>
        </div>
      ))}
    </div>
  );
}
