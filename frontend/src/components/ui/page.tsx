import * as React from "react";
import { cn } from "../../lib/utils";

/** Standard page frame: eyebrow, title, description and actions. */
export function PageHeader({
  eyebrow, title, description, actions, className,
}: { eyebrow?: React.ReactNode; title: React.ReactNode; description?: React.ReactNode; actions?: React.ReactNode; className?: string }) {
  return (
    <div className={cn("mb-5 flex flex-wrap items-end justify-between gap-4", className)}>
      <div className="min-w-0">
        {eyebrow && <p className="m-0 text-2xs font-extrabold uppercase tracking-[0.12em] text-muted-foreground">{eyebrow}</p>}
        <h2 className="mb-1 mt-1">{title}</h2>
        {description && <p className="m-0 max-w-3xl text-sm text-muted-foreground md:text-base">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Page({ className, ...props }: React.HTMLAttributes<HTMLElement>) {
  return <section className={cn("mx-auto w-full max-w-[1400px] px-3 py-4 sm:px-4 md:p-7", className)} {...props} />;
}

export function Stat({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string }) {
  return (
    <div className="grid gap-1 rounded-lg border border-border bg-card p-4">
      <span className="text-xs text-muted-foreground">{label}</span>
      <strong className="text-2xl leading-tight">{value}</strong>
      {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
    </div>
  );
}

export function EmptyState({ children }: { children: React.ReactNode }) {
  return <div className="rounded-lg border border-dashed border-input bg-card p-8 text-center text-muted-foreground">{children}</div>;
}
