import React, { useEffect, useState } from "react";
import { RefreshCw, WifiOff } from "lucide-react";
import { db, type PendingEvent, type SyncLogEntry } from "../db";
import type { User } from "../auth";
import { api, isOfflineError } from "./api";
import { useConnection, useSyncState } from "./hooks";
import { getNetworkMode, setNetworkMode, type NetworkMode } from "./network";
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

export function NetworkSimulator({ compact = false }: { compact?: boolean }) {
  const [mode, setMode] = useState<NetworkMode>(getNetworkMode());
  const choose = (next: NetworkMode) => {
    setNetworkMode(next);
    setMode(next);
  };
  return (
    <div className={compact ? "simulator compact" : "simulator panel"}>
      {!compact && <h3><WifiOff size={16} /> Network simulator (demonstration only)</h3>}
      <div className="source-tabs" role="radiogroup" aria-label="Simulated network">
        {(["online", "intermittent", "offline"] as NetworkMode[]).map((option) => (
          <button key={option} type="button" role="radio" aria-checked={mode === option}
            className={`source-tab ${mode === option ? "active" : ""}`} onClick={() => choose(option)}>
            {option === "online" ? "Online" : option === "offline" ? "Offline" : "Intermittent"}
          </button>
        ))}
      </div>
      {!compact && <p className="muted">Applies to this browser only. Offline blocks every request to the server; intermittent drops about half of them. The app's real offline storage and sync are used.</p>}
    </div>
  );
}

export function SyncCentre({ user }: { user: User }) {
  const connection = useConnection();
  const { sync, pending, conflicts: localConflicts } = useSyncState(user.id);
  const [events, setEvents] = useState<PendingEvent[]>([]);
  const [log, setLog] = useState<SyncLogEntry[]>([]);
  const [device, setDevice] = useState("");
  const [serverConflicts, setServerConflicts] = useState<ServerConflict[] | null>(null);
  const [serverHistory, setServerHistory] = useState<ServerBatch[] | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function loadLocal() {
    const rows = await db.pendingEvents.toArray();
    setEvents(rows.filter((row) => row.actor_id === user.id).sort((a, b) => b.sequence_number - a.sequence_number));
    setLog((await db.syncLog.orderBy("id").reverse().limit(15).toArray()));
  }

  async function loadServer() {
    try {
      const [conflictRows, history] = await Promise.all([
        api<ServerConflict[]>("/api/v1/sync/conflicts"),
        api<ServerBatch[]>("/api/v1/sync/history?limit=10"),
      ]);
      setServerConflicts(conflictRows);
      setServerHistory(history);
    } catch (reason) {
      if (!isOfflineError(reason)) setError(reason instanceof Error ? reason.message : "Server sync records are unavailable.");
      setServerConflicts(null);
      setServerHistory(null);
    }
  }

  useEffect(() => {
    void deviceId().then(setDevice);
    void loadLocal();
    const stop = subscribeOutbox(() => void loadLocal());
    return stop;
  }, [user.id]);

  useEffect(() => {
    if (connection.online) void loadServer();
  }, [connection.online, sync.lastSyncAt]);

  async function resolve(conflict: ServerConflict, decision: "APPLY" | "DISCARD") {
    setError("");
    setMessage("");
    try {
      const result = await api<{ status: string }>(`/api/v1/sync/conflicts/${encodeURIComponent(conflict.event_id)}/resolve`, {
        method: "POST",
        body: JSON.stringify({ decision, note: notes[conflict.event_id] ?? "" }),
      });
      await markEventResolved(conflict.event_id, result.status);
      setMessage(decision === "APPLY" ? "The offline change was applied." : "The offline change was discarded and the decision recorded.");
      await loadServer();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The conflict could not be resolved.");
    }
  }

  const visible = events.filter((event) => event.sync_status !== "SYNCED" && event.sync_status !== "RESOLVED");
  const recent = events.filter((event) => event.sync_status === "SYNCED" || event.sync_status === "RESOLVED").slice(0, 10);

  return (
    <section className="page">
      <div className="page-heading">
        <div>
          <p className="eyebrow">OFFLINE WORK</p>
          <h2>Synchronisation</h2>
          <p className="muted">Changes are saved on this device first and sent when the server is reachable. The server checks every change again.</p>
        </div>
        <button className="primary" onClick={() => void getSyncEngine().syncNow("manual")} disabled={sync.phase === "syncing"}>
          <RefreshCw size={16} /> {sync.phase === "syncing" ? "Synchronising…" : "Sync now"}
        </button>
      </div>

      <div className="metrics">
        <div className="metric"><span>Connection</span><strong>{connection.online ? "Connected" : connection.mode === "offline" ? "Offline (simulated)" : "Server unreachable"}</strong></div>
        <div className="metric"><span>Waiting to send</span><strong>{pending}</strong></div>
        <div className="metric"><span>Need reconciliation</span><strong>{serverConflicts ? serverConflicts.length : localConflicts}</strong></div>
        <div className="metric"><span>This device</span><strong>{device}</strong></div>
      </div>
      <p className={sync.phase === "auth_required" ? "error" : "muted"}>
        {sync.lastMessage}
        {sync.phase === "waiting_retry" && sync.nextRetryAt ? ` Next automatic attempt ${time(sync.nextRetryAt)}.` : ""}
      </p>
      {message && <p className="confirmation">{message}</p>}
      {error && <p className="error">{error}</p>}

      {user.role === "system_administrator" && <NetworkSimulator />}

      <div className="panel">
        <h3>Needs reconciliation</h3>
        {serverConflicts === null && <p className="muted">Connect to review conflicts. {localConflicts} change(s) from this device are waiting.</p>}
        {serverConflicts?.length === 0 && <p className="muted">No offline changes are waiting for a decision.</p>}
        {serverConflicts?.map((conflict) => (
          <div key={conflict.event_id} className="history-item">
            <strong>{EVENT_LABELS[conflict.event_type] ?? conflict.event_type}: {describe(conflict)}</strong>
            <span className="error">{conflict.detail}</span>
            <span className="muted">
              Recorded on {conflict.device_id || "unknown device"} at {time(conflict.client_timestamp)} (device clock) · received {time(conflict.received_at)}
              {conflict.base_status ? ` · user saw status ${conflict.base_status}` : ""}
              {conflict.actor_id !== user.id ? ` · by ${conflict.actor_id}` : ""}
            </span>
            <input aria-label="Reason for decision" placeholder="Reason (required to discard)" value={notes[conflict.event_id] ?? ""}
              onChange={(event) => setNotes({ ...notes, [conflict.event_id]: event.target.value })} />
            <div className="action-row">
              <button className="secondary" onClick={() => void resolve(conflict, "APPLY")}>Apply to current record</button>
              <button className="secondary" onClick={() => void resolve(conflict, "DISCARD")}>Discard offline change</button>
            </div>
          </div>
        ))}
      </div>

      <div className="grid-two workflow-panel">
        <div className="panel table">
          <h3 style={{ padding: "0 14px" }}>On this device</h3>
          {visible.length === 0 && <p className="muted" style={{ padding: "0 14px" }}>Nothing waiting.</p>}
          {visible.length > 0 && (
            <table>
              <thead><tr><th>#</th><th>Change</th><th>Saved</th><th>Status</th></tr></thead>
              <tbody>{visible.map((event) => (
                <tr key={event.event_id}>
                  <td>{event.sequence_number}</td>
                  <td>{EVENT_LABELS[event.event_type] ?? event.event_type}<br /><small className="muted">{describe(event)}</small></td>
                  <td>{time(event.client_timestamp)}{event.attempts ? <><br /><small className="muted">{event.attempts} attempt(s)</small></> : null}</td>
                  <td><span className={`status ${event.sync_status === "REJECTED" ? "rejected" : "submitted"}`}>{event.sync_status}</span>
                    {event.server_detail && <><br /><small className="error">{event.server_detail}</small></>}</td>
                </tr>
              ))}</tbody>
            </table>
          )}
          {recent.length > 0 && <p className="muted" style={{ padding: "0 14px" }}>Recently sent: {recent.map((event) => `${EVENT_LABELS[event.event_type] ?? event.event_type} (${event.server_status ?? event.sync_status})`).join(", ")}</p>}
        </div>
        <div className="panel">
          <h3>Sync attempts on this device</h3>
          {log.length === 0 && <p className="muted">No attempts yet.</p>}
          {log.map((entry) => (
            <div key={entry.id} className="history-item">
              <strong>{entry.outcome.replace(/_/g, " ").toLowerCase()} · {entry.trigger}</strong>
              <span className="muted">{time(entry.at)}{entry.sent ? ` · sent ${entry.sent}: ${entry.applied} applied, ${entry.duplicates} already received, ${entry.conflicts} conflicts, ${entry.rejected} rejected` : ""}</span>
              {entry.detail && <span className="error">{entry.detail}</span>}
            </div>
          ))}
          {serverHistory && serverHistory.length > 0 && <>
            <h3>Received by the server</h3>
            {serverHistory.map((batch) => (
              <div key={batch.id} className="history-item">
                <strong>{time(batch.received_at)} · {batch.device_id || "device"}</strong>
                <span className="muted">{batch.event_count} event(s): {batch.applied} applied, {batch.duplicates} duplicates, {batch.conflicts} conflicts, {batch.rejected} rejected</span>
              </div>
            ))}
          </>}
        </div>
      </div>
    </section>
  );
}
