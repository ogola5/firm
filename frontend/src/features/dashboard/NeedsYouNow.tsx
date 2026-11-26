import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, ChevronRight } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "../../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../../components/ui/card";
import { SkeletonLines } from "../../components/ui/skeleton";
import { cn } from "../../lib/utils";
import { api } from "../../offline/api";

type Item = { priority: number; kind: string; title: string; detail: string; link: string; action: string; safety: boolean; reference: string };

/** One list, in priority order, at the top of each home: what is waiting for this person, each with one button. */
export function NeedsYouNow() {
  const query = useQuery({ queryKey: ["needs-you"], queryFn: () => api<{ items: Item[] }>("/api/v1/me/needs-you"), refetchInterval: 60_000 });
  const [all, setAll] = useState(false);
  const items = query.data?.items ?? [];
  if (query.isError) return null; // offline: the lists below still work from the device
  const shown = all ? items : items.slice(0, 5);
  return (
    <Card aria-label="Needs you now" className={cn(items.some((item) => item.safety) && "border-destructive/50")}>
      <CardHeader className="pb-2">
        <CardTitle className="text-lg">{query.isLoading ? "Needs you now" : items.length ? `Needs you now (${items.length})` : "Nothing waiting for you"}</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-2 pt-0">
        {query.isLoading && <SkeletonLines lines={3} />}
        {query.data && !items.length && (
          <p className="m-0 flex items-center gap-2 text-sm text-muted-foreground">
            <CheckCircle2 className="size-4 text-success" aria-hidden />You are up to date. Anything new will appear here and under the bell.
          </p>
        )}
        {shown.map((item, index) => (
          <Link key={`${item.link}-${index}`} to={item.link}
            className={cn("flex min-w-0 items-center gap-3 rounded-lg border bg-card px-3 py-2.5 text-foreground no-underline hover:border-primary",
              item.safety ? "border-destructive border-l-4" : item.priority <= 1 ? "border-l-4 border-l-warning border-border" : "border-border")}>
            <span className="grid min-w-0 flex-1 gap-0.5">
              <span className="flex flex-wrap items-center gap-2">
                {item.safety && <span className="rounded bg-destructive px-1.5 py-0.5 text-2xs font-extrabold text-destructive-foreground">SAFETY</span>}
                <strong className="min-w-0 break-words text-[15px]">{item.title}</strong>
              </span>
              <span className="break-words text-sm text-muted-foreground">{item.detail}{item.reference ? ` · ${item.reference}` : ""}</span>
            </span>
            <span className="flex shrink-0 items-center gap-1 text-sm font-bold text-primary">{item.action}<ChevronRight className="size-4" aria-hidden /></span>
          </Link>
        ))}
        {items.length > 5 && (
          <Button variant="ghost" className="w-fit" onClick={() => setAll(!all)}>{all ? "Show fewer" : `Show all ${items.length}`}</Button>
        )}
      </CardContent>
    </Card>
  );
}
