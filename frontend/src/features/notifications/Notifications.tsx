import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ArrowUpCircle, Bell, BookOpen, CheckCheck, ClipboardCheck, Sparkles, Wrench } from "lucide-react";
import type { ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { type User } from "../../auth";
import { Alert } from "../../components/ui/alert";
import { Button } from "../../components/ui/button";
import { Card, CardContent } from "../../components/ui/card";
import { EmptyState, Page, PageHeader } from "../../components/ui/page";
import { spokenTime } from "../../lib/format";
import { errorMessage } from "../../lib/query";
import { cn } from "../../lib/utils";
import { api } from "../../offline/api";
import { useConnection } from "../../offline/hooks";

type Item = { id: string; kind: string; title: string; body: string; link: string; created_at: string; read: boolean };
type Listing = { unread: number; items: Item[] };

const ICONS: Record<string, ReactNode> = {
  safety: <AlertTriangle className="size-5 text-destructive" />,
  fault: <AlertTriangle className="size-5 text-warning" />,
  work: <Wrench className="size-5 text-primary" />,
  review: <ClipboardCheck className="size-5 text-primary" />,
  escalation: <ArrowUpCircle className="size-5 text-warning" />,
  knowledge: <BookOpen className="size-5 text-success" />,
  recognition: <Sparkles className="size-5 text-success" />,
};

export function useNotifications() {
  const { online } = useConnection();
  return useQuery({
    queryKey: ["notifications"], enabled: online,
    queryFn: () => api<Listing>("/api/v1/notifications"),
    refetchInterval: 60_000, refetchOnWindowFocus: true,
  });
}

/** Header bell with the unread count. */
export function NotificationBell() {
  const listing = useNotifications();
  const unread = listing.data?.unread ?? 0;
  return (
    <Link to="/notifications" aria-label={unread ? `Notifications, ${unread} unread` : "Notifications"}
      className="relative grid size-11 shrink-0 place-items-center rounded-md border border-border text-foreground hover:bg-secondary">
      <Bell className="size-5" />
      {unread > 0 && (
        <span className="absolute -right-1 -top-1 grid min-w-5 place-items-center rounded-full bg-destructive px-1 text-[11px] font-bold text-destructive-foreground">
          {unread > 99 ? "99+" : unread}
        </span>
      )}
    </Link>
  );
}

export function Notifications({ user }: { user: User }) {
  const listing = useNotifications();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["notifications"] });
  const open = useMutation({
    mutationFn: (item: Item) => (item.read ? Promise.resolve(item) : api<Item>(`/api/v1/notifications/${item.id}/read`, { method: "POST" })),
    onSuccess: (_, item) => { void refresh(); if (item.link) navigate(item.link); },
  });
  const readAll = useMutation({ mutationFn: () => api("/api/v1/notifications/read-all", { method: "POST" }), onSuccess: refresh });
  const items = listing.data?.items ?? [];
  const today = new Date().toDateString();

  return (
    <Page>
      <PageHeader eyebrow={`${user.access.level} · Only what concerns you`} title="Notifications"
        description="New work, things waiting for you, escalations, reviews and when your knowledge helped someone. Also sent by email."
        actions={listing.data?.unread ? <Button variant="outline" onClick={() => readAll.mutate()} disabled={readAll.isPending}><CheckCheck />Mark all read</Button> : undefined} />
      {listing.isError && <Alert variant="destructive">{errorMessage(listing.error, "Notifications are not available.")}</Alert>}
      {listing.data && !items.length && <EmptyState>Nothing yet. You will see new work, reviews and escalations here.</EmptyState>}
      <Card>
        <CardContent className="grid p-0">
          {items.map((item, index) => {
            const day = new Date(item.created_at).toDateString();
            const heading = index === 0 || new Date(items[index - 1].created_at).toDateString() !== day;
            return (
              <div key={item.id}>
                {heading && <div className="border-b border-border bg-muted/50 px-4 py-1.5 text-xs font-bold uppercase text-muted-foreground">{day === today ? "Today" : spokenTime(item.created_at).replace(/ \d\d:\d\d$/, "")}</div>}
                <button type="button" onClick={() => open.mutate(item)} aria-label={`${item.read ? "" : "Unread: "}${item.title}`}
                  className={cn("flex w-full gap-3 border-b border-border px-4 py-3 text-left last:border-0 hover:bg-secondary/60", !item.read && "bg-primary/5")}>
                  <span className="mt-0.5 shrink-0">{ICONS[item.kind] ?? <Bell className="size-5" />}</span>
                  <span className="grid min-w-0 gap-0.5">
                    <span className={cn("text-[15px]", !item.read && "font-bold")}>{item.title}</span>
                    {item.body && <span className="text-sm text-muted-foreground">{item.body}</span>}
                    <span className="text-xs text-muted-foreground">{spokenTime(item.created_at)}</span>
                  </span>
                  {!item.read && <span className="ml-auto mt-2 size-2.5 shrink-0 rounded-full bg-primary" aria-hidden />}
                </button>
              </div>
            );
          })}
        </CardContent>
      </Card>
    </Page>
  );
}
