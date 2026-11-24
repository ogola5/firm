import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import type { User } from "../auth";
import { Alert } from "../components/ui/alert";
import { Badge, statusVariant } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Input } from "../components/ui/form-controls";
import { Page, PageHeader, Stat } from "../components/ui/page";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../components/ui/table";
import { db, type PendingEvent, type SyncLogEntry } from "../db";
import { errorMessage } from "../lib/query";
import { api } from "./api";
import { useConnection, useSyncState } from "./hooks";
import { NetworkSimulator } from "./NetworkSimulator";
import { deviceId, markEventResolved, subscribeOutbox } from "./outbox";
import { getSyncEngine } from "./sync";

type ServerConflict = {
  event_id: string;
  fault_id: string | null;
  event_type: string;
  detail: string;
  client_timestamp: string;
  received_at: string;
  device_id: string;
  actor_id: string;
  base_status: string | null;
  payload: Record<string, unknown>;
};

type ServerBatch = {
  id: string;
  received_at: string;
  device_id: string;
  event_count: number;
  applied: number;
  conflicts: number;
  rejected: number;
  duplicates: number;
};

const EVENT_LABELS: Record<string, string> = {
  FAULT_REPORTED: "Breakdown report",
  FAULT_ACTION: "Workflow step",
  DIAGNOSIS_RECORDED: "Diagnosis",
  INTERVENTION_RECORDED: "Intervention",
  OPERATOR_UPDATE: "Operator update",
};

const time = (value?: string | null) => (value ? new Date(value).toLocaleString() : "—");

function describe(event: { event_type: string; payload: Record<string, unknown> }): string {
  const payload = event.payload ?? {};
  if (event.event_type === "FAULT_ACTION") return `Action: ${String(payload.action ?? "").replace("_", " ")}`;
  return String(payload.symptom ?? payload.possible_cause ?? payload.corrective_action ?? payload.note ?? "");
}

function useLocalOutbox(userId: string) {
  const [events, setEvents] = useState<PendingEvent[]>([]);
  const [log, setLog] = useState<SyncLogEntry[]>([]);
  const [device, setDevice] = useState("");
  useEffect(() => {
    const load = async () => {
      const rows = await db.pendingEvents.toArray();
      setEvents(rows.filter((row) => row.actor_id === userId).sort((a, b) => b.sequence_number - a.sequence_number));
      setLog(await db.syncLog.orderBy("id").reverse().limit(15).toArray());
    };
    void deviceId().then(setDevice);
    void load();
    return subscribeOutbox(() => void load());
  }, [userId]);
  return { events, log, device };
}

export function SyncCentre({ user }: { user: User }) {
  const connection = useConnection();
  const { sync, pending, conflicts: localConflicts } = useSyncState(user.id);
  const { events, log, device } = useLocalOutbox(user.id);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [message, setMessage] = useState("");
  const queryClient = useQueryClient();

  const conflictsQuery = useQuery({
    queryKey: ["sync", "conflicts", sync.lastSyncAt],
    queryFn: () => api<ServerConflict[]>("/api/v1/sync/conflicts"),
    enabled: connection.online,
  });
  const historyQuery = useQuery({
    queryKey: ["sync", "history", sync.lastSyncAt],
    queryFn: () => api<ServerBatch[]>("/api/v1/sync/history?limit=10"),
    enabled: connection.online,
  });

  const resolve = useMutation({
    mutationFn: ({ conflict, decision }: { conflict: ServerConflict; decision: "APPLY" | "DISCARD" }) =>
      api<{ status: string }>(`/api/v1/sync/conflicts/${encodeURIComponent(conflict.event_id)}/resolve`, {
        method: "POST",
        body: JSON.stringify({ decision, note: notes[conflict.event_id] ?? "" }),
      }),
    onSuccess: async (result, { conflict, decision }) => {
      await markEventResolved(conflict.event_id, result.status);
      setMessage(decision === "APPLY" ? "The offline change was applied." : "The offline change was discarded and the decision recorded.");
      await queryClient.invalidateQueries({ queryKey: ["sync"] });
    },
    onError: () => setMessage(""),
  });

  const serverConflicts = connection.online ? conflictsQuery.data : undefined;
  const visible = events.filter((event) => event.sync_status !== "SYNCED" && event.sync_status !== "RESOLVED");
  const recent = events.filter((event) => event.sync_status === "SYNCED" || event.sync_status === "RESOLVED").slice(0, 10);

  return (
    <Page>
      <PageHeader
        eyebrow="Offline work"
        title="Synchronisation"
        description="Changes are saved on this device first and sent when the server is reachable. The server checks every change again."
        actions={(
          <Button onClick={() => void getSyncEngine().syncNow("manual")} disabled={sync.phase === "syncing"}>
            <RefreshCw /> {sync.phase === "syncing" ? "Synchronising…" : "Sync now"}
          </Button>
        )}
      />

      <div className="mb-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Connection" value={connection.online ? "Connected" : connection.mode === "offline" ? "Offline (simulated)" : "Server unreachable"} />
        <Stat label="Waiting to send" value={pending} />
        <Stat label="Need reconciliation" value={serverConflicts ? serverConflicts.length : localConflicts} />
        <Stat label="This device" value={<span className="text-base">{device}</span>} />
      </div>
      {sync.lastMessage && (
        <p className={sync.phase === "auth_required" ? "font-semibold text-destructive" : "text-sm text-muted-foreground"}>
          {sync.lastMessage}
          {sync.phase === "waiting_retry" && sync.nextRetryAt ? ` Next automatic attempt ${time(sync.nextRetryAt)}.` : ""}
        </p>
      )}
      {message && <Alert variant="success" className="mb-3">{message}</Alert>}
      {resolve.isError && <Alert variant="destructive" className="mb-3">{errorMessage(resolve.error, "The conflict could not be resolved.")}</Alert>}
      {conflictsQuery.isError && <Alert variant="destructive" className="mb-3">{errorMessage(conflictsQuery.error)}</Alert>}

      {user.role === "system_administrator" && <NetworkSimulator />}

      <Card className="mb-4">
        <CardHeader><CardTitle>Needs reconciliation</CardTitle></CardHeader>
        <CardContent className="grid gap-3">
          {!serverConflicts && <p className="m-0 text-sm text-muted-foreground">Connect to review conflicts. {localConflicts} change(s) from this device are waiting.</p>}
          {serverConflicts?.length === 0 && <p className="m-0 text-sm text-muted-foreground">No offline changes are waiting for a decision.</p>}
          {serverConflicts?.map((conflict) => (
            <div key={conflict.event_id} className="grid gap-2 border-t border-border pt-3 text-sm first:border-0 first:pt-0">
              <strong>{EVENT_LABELS[conflict.event_type] ?? conflict.event_type}: {describe(conflict)}</strong>
              <span className="font-semibold text-destructive">{conflict.detail}</span>
              <span className="text-muted-foreground">
                Recorded on {conflict.device_id || "unknown device"} at {time(conflict.client_timestamp)} (device clock) · received {time(conflict.received_at)}
                {conflict.base_status ? ` · user saw status ${conflict.base_status}` : ""}
                {conflict.actor_id !== user.id ? ` · by ${conflict.actor_id}` : ""}
              </span>
              <Input
                aria-label="Reason for decision"
                placeholder="Reason (required to discard)"
                value={notes[conflict.event_id] ?? ""}
                onChange={(event) => setNotes({ ...notes, [conflict.event_id]: event.target.value })}
              />
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" disabled={resolve.isPending} onClick={() => resolve.mutate({ conflict, decision: "APPLY" })}>Apply to current record</Button>
                <Button variant="outline" disabled={resolve.isPending} onClick={() => resolve.mutate({ conflict, decision: "DISCARD" })}>Discard offline change</Button>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <Card>
          <CardHeader><CardTitle>On this device</CardTitle></CardHeader>
          <CardContent>
            {visible.length === 0 ? <p className="m-0 text-sm text-muted-foreground">Nothing waiting.</p> : (
              <Table>
                <TableHeader><TableRow><TableHead>#</TableHead><TableHead>Change</TableHead><TableHead>Saved</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
                <TableBody>{visible.map((event) => (
                  <TableRow key={event.event_id}>
                    <TableCell>{event.sequence_number}</TableCell>
                    <TableCell>{EVENT_LABELS[event.event_type] ?? event.event_type}<br /><small className="text-muted-foreground">{describe(event)}</small></TableCell>
                    <TableCell>{time(event.client_timestamp)}{event.attempts ? <><br /><small className="text-muted-foreground">{event.attempts} attempt(s)</small></> : null}</TableCell>
                    <TableCell>
                      <Badge variant={statusVariant(event.sync_status)}>{event.sync_status}</Badge>
                      {event.server_detail && <><br /><small className="text-destructive">{event.server_detail}</small></>}
                    </TableCell>
                  </TableRow>
                ))}</TableBody>
              </Table>
            )}
            {recent.length > 0 && (
              <p className="mb-0 text-sm text-muted-foreground">
                Recently sent: {recent.map((event) => `${EVENT_LABELS[event.event_type] ?? event.event_type} (${event.server_status ?? event.sync_status})`).join(", ")}
              </p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Sync attempts on this device</CardTitle></CardHeader>
          <CardContent className="grid gap-0">
            {log.length === 0 && <p className="m-0 text-sm text-muted-foreground">No attempts yet.</p>}
            {log.map((entry) => (
              <div key={entry.id} className="grid gap-0.5 border-t border-border py-2 text-sm first:border-0">
                <strong className="capitalize">{entry.outcome.replace(/_/g, " ").toLowerCase()} · {entry.trigger}</strong>
                <span className="text-muted-foreground">
                  {time(entry.at)}
                  {entry.sent ? ` · sent ${entry.sent}: ${entry.applied} applied, ${entry.duplicates} already received, ${entry.conflicts} conflicts, ${entry.rejected} rejected` : ""}
                </span>
                {entry.detail && <span className="text-destructive">{entry.detail}</span>}
              </div>
            ))}
            {historyQuery.data && historyQuery.data.length > 0 && <>
              <h3 className="mt-4">Received by the server</h3>
              {historyQuery.data.map((batch) => (
                <div key={batch.id} className="grid gap-0.5 border-t border-border py-2 text-sm">
                  <strong>{time(batch.received_at)} · {batch.device_id || "device"}</strong>
                  <span className="text-muted-foreground">{batch.event_count} event(s): {batch.applied} applied, {batch.duplicates} duplicates, {batch.conflicts} conflicts, {batch.rejected} rejected</span>
                </div>
              ))}
            </>}
          </CardContent>
        </Card>
      </div>
    </Page>
  );
}
