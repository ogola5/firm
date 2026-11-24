/**
 * Synchronisation engine.
 *
 * Retries are driven by several triggers because Background Sync support and
 * timing vary between browsers: connectivity returning, the app becoming
 * visible, app start, the simulator switching back online, a periodic timer
 * while work is pending, a service-worker `sync` message, and "Sync now".
 * Failed attempts back off exponentially with full jitter.
 */
import { db, type PendingEvent, type SyncLogEntry } from "../db";
import { ApiError, API_BASE, api, isOfflineError } from "./api";
import { checkReachability, subscribeConnection, connectionState } from "./network";
import { applyServerResults, incrementAttempts, pendingFor, subscribeOutbox, type ServerEventResult } from "./outbox";

export type SyncPhase = "idle" | "syncing" | "waiting_retry" | "auth_required";

export type SyncState = {
  phase: SyncPhase;
  attempt: number;
  nextRetryAt: string | null;
  lastSyncAt: string | null;
  lastMessage: string;
};

export type IngestResponse = {
  results: ServerEventResult[];
  counts: { APPLIED: number; CONFLICT: number; REJECTED: number; DUPLICATE: number };
};

export type SyncDeps = {
  actorId: () => string | null;
  send: (events: PendingEvent[]) => Promise<IngestResponse>;
  ping: () => Promise<boolean>;
  uploadAttachments: () => Promise<number>;
  random: () => number;
  now: () => number;
  schedule: (fn: () => void, ms: number) => unknown;
  cancel: (handle: unknown) => void;
};

export const BATCH_SIZE = 100;
export const BASE_DELAY_MS = 2_000;
export const MAX_DELAY_MS = 5 * 60_000;

/** Exponential backoff with full jitter, never shorter than one second. */
export function backoffDelay(attempt: number, random: () => number = Math.random): number {
  const ceiling = Math.min(MAX_DELAY_MS, BASE_DELAY_MS * 2 ** Math.max(0, attempt - 1));
  return Math.max(1_000, Math.round(random() * ceiling));
}

export class SyncEngine {
  state: SyncState = { phase: "idle", attempt: 0, nextRetryAt: null, lastSyncAt: null, lastMessage: "" };
  private running: Promise<SyncState> | null = null;
  private retryHandle: unknown = null;
  private listeners = new Set<() => void>();

  constructor(private deps: SyncDeps) {}

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private set(changes: Partial<SyncState>) {
    this.state = { ...this.state, ...changes };
    this.listeners.forEach((listener) => listener());
  }

  private async log(entry: Omit<SyncLogEntry, "id" | "at">) {
    await db.syncLog.add({ at: new Date(this.deps.now()).toISOString(), ...entry });
    const count = await db.syncLog.count();
    if (count > 200) {
      const oldest = await db.syncLog.orderBy("id").limit(count - 200).primaryKeys();
      await db.syncLog.bulkDelete(oldest);
    }
  }

  private scheduleRetry(message: string) {
    const attempt = this.state.attempt + 1;
    const wait = backoffDelay(attempt, this.deps.random);
    if (this.retryHandle) this.deps.cancel(this.retryHandle);
    this.retryHandle = this.deps.schedule(() => {
      this.retryHandle = null;
      void this.syncNow("retry");
    }, wait);
    this.set({
      phase: "waiting_retry",
      attempt,
      nextRetryAt: new Date(this.deps.now() + wait).toISOString(),
      lastMessage: message,
    });
  }

  /** Clears auth-required state after the user signs in again online. */
  resumeAfterLogin() {
    this.set({ phase: "idle", attempt: 0, nextRetryAt: null, lastMessage: "" });
    void this.syncNow("login");
  }

  syncNow(trigger = "manual"): Promise<SyncState> {
    if (this.running) return this.running;
    if (this.state.phase === "auth_required" && trigger !== "manual" && trigger !== "login") {
      return Promise.resolve(this.state);
    }
    this.running = this.run(trigger).finally(() => {
      this.running = null;
    });
    return this.running;
  }

  private async run(trigger: string): Promise<SyncState> {
    const actorId = this.deps.actorId();
    if (!actorId) return this.state;
    const pending = await pendingFor(actorId);
    const attachmentsWaiting = await db.pendingAttachments.where("status").equals("PENDING").count();
    if (!pending.length && !attachmentsWaiting) {
      await this.log({ trigger, outcome: "NOTHING_TO_SYNC", sent: 0, applied: 0, conflicts: 0, rejected: 0, duplicates: 0 });
      this.set({ phase: "idle", attempt: 0, nextRetryAt: null, lastMessage: "Everything on this device is synchronised." });
      return this.state;
    }

    this.set({ phase: "syncing", lastMessage: `Synchronising ${pending.length} change(s)…` });
    if (!(await this.deps.ping())) {
      await this.log({ trigger, outcome: "UNREACHABLE", sent: 0, applied: 0, conflicts: 0, rejected: 0, duplicates: 0 });
      this.scheduleRetry("Server not reachable. Changes stay on this device and will retry automatically.");
      return this.state;
    }

    const totals = { APPLIED: 0, CONFLICT: 0, REJECTED: 0, DUPLICATE: 0 };
    try {
      for (let index = 0; index < pending.length; index += BATCH_SIZE) {
        const batch = pending.slice(index, index + BATCH_SIZE);
        await incrementAttempts(batch);
        const response = await this.sendIsolatingInvalid(batch);
        await applyServerResults(response.results);
        for (const key of Object.keys(totals) as Array<keyof typeof totals>) totals[key] += response.counts[key] ?? 0;
      }
      await this.deps.uploadAttachments();
    } catch (error) {
      const outcome = error instanceof ApiError && error.status === 401 ? "AUTH_REQUIRED" : isOfflineError(error) ? "UNREACHABLE" : "ERROR";
      await this.log({
        trigger, outcome, sent: pending.length, applied: totals.APPLIED, conflicts: totals.CONFLICT,
        rejected: totals.REJECTED, duplicates: totals.DUPLICATE, detail: error instanceof Error ? error.message : String(error),
      });
      if (outcome === "AUTH_REQUIRED") {
        this.set({ phase: "auth_required", lastMessage: "Your session has expired. Sign in while connected to send queued work." });
      } else {
        this.scheduleRetry(outcome === "UNREACHABLE"
          ? "Connection lost during synchronisation. Will retry automatically."
          : `Synchronisation failed: ${error instanceof Error ? error.message : "unknown error"}. Will retry.`);
      }
      return this.state;
    }

    await this.log({
      trigger, outcome: "SYNCED", sent: pending.length, applied: totals.APPLIED, conflicts: totals.CONFLICT,
      rejected: totals.REJECTED, duplicates: totals.DUPLICATE,
    });
    const problems = totals.CONFLICT + totals.REJECTED;
    this.set({
      phase: "idle",
      attempt: 0,
      nextRetryAt: null,
      lastSyncAt: new Date(this.deps.now()).toISOString(),
      lastMessage: problems
        ? `${totals.APPLIED} change(s) synchronised; ${totals.CONFLICT} need reconciliation and ${totals.REJECTED} were rejected.`
        : `${totals.APPLIED + totals.DUPLICATE} change(s) synchronised.`,
    });
    return this.state;
  }

  /** A malformed event fails schema validation for the whole batch; send one by one to isolate it. */
  private async sendIsolatingInvalid(batch: PendingEvent[]): Promise<IngestResponse> {
    try {
      return await this.deps.send(batch);
    } catch (error) {
      if (!(error instanceof ApiError && error.status === 422) || batch.length === 1) {
        if (error instanceof ApiError && error.status === 422) {
          return {
            results: [{ event_id: batch[0].event_id, status: "REJECTED", detail: `Malformed event: ${error.detail}` }],
            counts: { APPLIED: 0, CONFLICT: 0, REJECTED: 1, DUPLICATE: 0 },
          };
        }
        throw error;
      }
      const merged: IngestResponse = { results: [], counts: { APPLIED: 0, CONFLICT: 0, REJECTED: 0, DUPLICATE: 0 } };
      for (const event of batch) {
        const single = await this.sendIsolatingInvalid([event]);
        merged.results.push(...single.results);
        for (const key of Object.keys(merged.counts) as Array<keyof IngestResponse["counts"]>) merged.counts[key] += single.counts[key] ?? 0;
      }
      return merged;
    }
  }
}

/** Uploads evidence captured offline once its fault exists on the server. */
export async function uploadPendingAttachments(): Promise<number> {
  const waiting = await db.pendingAttachments.where("status").equals("PENDING").toArray();
  let uploaded = 0;
  for (const item of waiting) {
    const reportEvent = await db.pendingEvents
      .where("fault_id").equals(item.fault_id)
      .filter((event) => event.event_type === "FAULT_REPORTED")
      .first();
    if (reportEvent && reportEvent.sync_status !== "SYNCED") {
      if (reportEvent.sync_status === "REJECTED") {
        await db.pendingAttachments.put({ ...item, status: "FAILED", detail: "The breakdown report was rejected" });
      }
      continue;
    }
    const form = new FormData();
    form.append("file", new File([item.blob], item.name, { type: item.type }));
    try {
      await api(`/api/v1/faults/${encodeURIComponent(item.fault_id)}/attachments`, { method: "POST", body: form });
      await db.pendingAttachments.put({ ...item, status: "UPLOADED" });
      uploaded += 1;
    } catch (error) {
      if (isOfflineError(error) || (error instanceof ApiError && error.status === 401)) throw error;
      await db.pendingAttachments.put({ ...item, status: "FAILED", detail: error instanceof Error ? error.message : "Upload failed" });
    }
  }
  return uploaded;
}

let engine: SyncEngine | null = null;
let currentActor: string | null = null;

export function setSyncActor(actorId: string | null) {
  currentActor = actorId;
}

export function getSyncEngine(): SyncEngine {
  if (!engine) {
    engine = new SyncEngine({
      actorId: () => currentActor,
      send: (events) => api<IngestResponse>("/api/v1/sync/events", {
        method: "POST",
        body: JSON.stringify(events.map(({ sync_status, attempts, server_status, server_detail, server_result, acknowledged_at, ...event }) => event)),
      }),
      ping: () => checkReachability(API_BASE),
      uploadAttachments: uploadPendingAttachments,
      random: Math.random,
      now: Date.now,
      schedule: (fn, ms) => setTimeout(fn, ms),
      cancel: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
    });
  }
  return engine;
}

/** Wires every retry trigger. Returns a cleanup function. */
export function startAutoSync(): () => void {
  const sync = getSyncEngine();
  const onOnline = () => void sync.syncNow("online");
  const onVisible = () => {
    if (document.visibilityState === "visible") void sync.syncNow("visible");
  };
  let wasOnline = connectionState().online;
  const stopConnection = subscribeConnection(() => {
    const online = connectionState().online;
    if (online && !wasOnline) void sync.syncNow("connectivity");
    wasOnline = online;
  });
  const stopOutbox = subscribeOutbox(() => {
    if (sync.state.phase === "idle") void sync.syncNow("new-change");
  });
  const onMessage = (event: MessageEvent) => {
    if ((event.data as { type?: string })?.type === "kpc-sync") void sync.syncNow("background-sync");
  };
  window.addEventListener("online", onOnline);
  document.addEventListener("visibilitychange", onVisible);
  navigator.serviceWorker?.addEventListener("message", onMessage);
  const interval = setInterval(() => void sync.syncNow("periodic"), 60_000);
  void sync.syncNow("app-start");
  return () => {
    stopConnection();
    stopOutbox();
    window.removeEventListener("online", onOnline);
    document.removeEventListener("visibilitychange", onVisible);
    navigator.serviceWorker?.removeEventListener("message", onMessage);
    clearInterval(interval);
  };
}

/** Asks the service worker for a Background Sync wake-up where supported (best effort). */
export async function requestBackgroundSync(): Promise<void> {
  try {
    const registration = await navigator.serviceWorker?.ready;
    const syncManager = (registration as ServiceWorkerRegistration & { sync?: { register(tag: string): Promise<void> } })?.sync;
    await syncManager?.register("kpc-outbox");
  } catch {
    // Unsupported or denied: the other triggers still apply.
  }
}
