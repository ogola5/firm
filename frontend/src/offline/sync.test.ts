import { beforeEach, describe, expect, it, vi } from "vitest";
import { db, type PendingEvent } from "../db";
import { ApiError } from "./api";
import { NetworkUnavailableError } from "./network";
import { enqueue } from "./outbox";
import { BASE_DELAY_MS, MAX_DELAY_MS, SyncEngine, backoffDelay, type IngestResponse, type SyncDeps } from "./sync";

const ACTOR = "USER-automation";

function applyAll(events: PendingEvent[]): IngestResponse {
  return {
    results: events.map((event) => ({ event_id: event.event_id, status: "APPLIED" })),
    counts: { APPLIED: events.length, CONFLICT: 0, REJECTED: 0, DUPLICATE: 0 },
  };
}

function makeDeps(overrides: Partial<SyncDeps> = {}) {
  const scheduled: Array<{ fn: () => void; ms: number }> = [];
  const deps: SyncDeps = {
    actorId: () => ACTOR,
    send: vi.fn(async (events: PendingEvent[]) => applyAll(events)),
    ping: vi.fn(async () => true),
    uploadAttachments: vi.fn(async () => 0),
    random: () => 0.5,
    now: () => Date.parse("2026-11-24T10:00:00Z"),
    schedule: (fn, ms) => { scheduled.push({ fn, ms }); return scheduled.length; },
    cancel: () => undefined,
    ...overrides,
  };
  return { deps, scheduled };
}

beforeEach(async () => {
  await db.delete();
  await db.open();
});

describe("backoffDelay", () => {
  it("grows exponentially, is jittered and capped", () => {
    expect(backoffDelay(1, () => 1)).toBe(BASE_DELAY_MS);
    expect(backoffDelay(3, () => 1)).toBe(BASE_DELAY_MS * 4);
    expect(backoffDelay(30, () => 1)).toBe(MAX_DELAY_MS);
    expect(backoffDelay(5, () => 0)).toBe(1_000);
    expect(backoffDelay(5, () => 0.25)).toBe(Math.round(0.25 * BASE_DELAY_MS * 16));
  });
});

describe("SyncEngine", () => {
  it("does nothing when the outbox is empty", async () => {
    const { deps } = makeDeps();
    const state = await new SyncEngine(deps).syncNow();
    expect(state.phase).toBe("idle");
    expect(deps.send).not.toHaveBeenCalled();
  });

  it("keeps events and schedules a backed-off retry when the server is unreachable", async () => {
    await enqueue({ eventType: "OPERATOR_UPDATE", actorId: ACTOR, faultId: "F1", payload: { note: "x" } });
    const { deps, scheduled } = makeDeps({ ping: vi.fn(async () => false) });
    const engine = new SyncEngine(deps);
    const state = await engine.syncNow();
    expect(state.phase).toBe("waiting_retry");
    expect(state.attempt).toBe(1);
    expect(scheduled).toHaveLength(1);
    expect((await db.pendingEvents.toArray())[0].sync_status).toBe("PENDING");
    const log = await db.syncLog.toArray();
    expect(log[log.length - 1]?.outcome).toBe("UNREACHABLE");

    deps.ping = vi.fn(async () => true);
    scheduled[0].fn();
    await vi.waitFor(() => expect(engine.state.phase).toBe("idle"));
    expect((await db.pendingEvents.toArray())[0].sync_status).toBe("SYNCED");
    expect(engine.state.attempt).toBe(0);
  });

  it("retries after a connection drop mid-sync without losing events", async () => {
    await enqueue({ eventType: "OPERATOR_UPDATE", actorId: ACTOR, faultId: "F1", payload: {} });
    const { deps, scheduled } = makeDeps({ send: vi.fn(async () => { throw new NetworkUnavailableError(); }) });
    const state = await new SyncEngine(deps).syncNow();
    expect(state.phase).toBe("waiting_retry");
    expect(scheduled).toHaveLength(1);
    const [event] = await db.pendingEvents.toArray();
    expect(event.sync_status).toBe("PENDING");
    expect(event.attempts).toBe(1);
  });

  it("stops retrying and asks for sign-in when the session has expired", async () => {
    await enqueue({ eventType: "OPERATOR_UPDATE", actorId: ACTOR, faultId: "F1", payload: {} });
    const { deps, scheduled } = makeDeps({ send: vi.fn(async () => { throw new ApiError(401, "Invalid demo session"); }) });
    const engine = new SyncEngine(deps);
    expect((await engine.syncNow()).phase).toBe("auth_required");
    expect(scheduled).toHaveLength(0);
    expect((await engine.syncNow("periodic")).phase).toBe("auth_required");
    expect(deps.send).toHaveBeenCalledTimes(1);
  });

  it("isolates a malformed event instead of blocking the whole batch", async () => {
    const good = await enqueue({ eventType: "OPERATOR_UPDATE", actorId: ACTOR, faultId: "F1", payload: {} });
    const bad = await enqueue({ eventType: "OPERATOR_UPDATE", actorId: ACTOR, faultId: "F1", payload: { broken: true } });
    const send = vi.fn(async (events: PendingEvent[]) => {
      if (events.some((event) => event.payload.broken)) throw new ApiError(422, "client_timestamp missing");
      return applyAll(events);
    });
    const { deps } = makeDeps({ send });
    await new SyncEngine(deps).syncNow();
    expect((await db.pendingEvents.get(good.event_id))?.sync_status).toBe("SYNCED");
    expect((await db.pendingEvents.get(bad.event_id))?.sync_status).toBe("REJECTED");
  });

  it("shares one run between concurrent triggers", async () => {
    await enqueue({ eventType: "OPERATOR_UPDATE", actorId: ACTOR, faultId: "F1", payload: {} });
    const { deps } = makeDeps();
    const engine = new SyncEngine(deps);
    await Promise.all([engine.syncNow("a"), engine.syncNow("b"), engine.syncNow("c")]);
    expect(deps.send).toHaveBeenCalledTimes(1);
  });

  it("sends only the signed-in user's events", async () => {
    await enqueue({ eventType: "OPERATOR_UPDATE", actorId: "USER-other", faultId: "F1", payload: {} });
    const mine = await enqueue({ eventType: "OPERATOR_UPDATE", actorId: ACTOR, faultId: "F1", payload: {} });
    const { deps } = makeDeps();
    await new SyncEngine(deps).syncNow();
    const sent = (deps.send as ReturnType<typeof vi.fn>).mock.calls[0][0] as PendingEvent[];
    expect(sent.map((event) => event.event_id)).toEqual([mine.event_id]);
  });
});
