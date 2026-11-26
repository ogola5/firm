import { cn } from "../../lib/utils";

/** Grey outline of content that is on its way: the page feels faster than a "Loading…" line. */
export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn("animate-pulse rounded-xl bg-muted motion-reduce:animate-none", className)} />;
}

/** A few placeholder lines for a list or card. */
export function SkeletonLines({ lines = 3 }: { lines?: number }) {
  return (
    <div className="grid gap-2" aria-hidden>
      {Array.from({ length: lines }, (_, index) => <Skeleton key={index} className={cn("h-4", index === lines - 1 ? "w-2/3" : "w-full")} />)}
    </div>
  );
}
