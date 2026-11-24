# Offline Synchronisation Design

The application keeps working when the maintenance server cannot be reached. Changes are written to the device first, sent when the server is reachable, and re-checked by the server, which stays authoritative.

## What works offline

| Capability | How |
|---|---|
| Open the app | Service worker serves the cached app shell (`frontend/public/sw.js`). API responses are never cached by the service worker; the app must see real failures to queue work. |
| Sign in | A previously verified account unlocks with the same password (see *Offline sign-in*). |
| Search equipment, view breakdowns | IndexedDB copies refreshed after each online sign-in and whenever a screen loads online. Equipment search uses the `tag` index. |
| View an investigation | The full investigation is cached each time it is opened online. |
| Report a breakdown, with evidence files | Queued as `FAULT_REPORTED` with a client-generated fault id; files are stored as blobs and uploaded once the report is accepted. |
| Acknowledge / on site / mark diagnosed / request completion review | Queued as `FAULT_ACTION`, carrying the status the user saw (`base_status`). |
| Record diagnoses and interventions (including failed attempts) | Queued with client-generated ids so an intervention can reference a diagnosis made offline. |
| Operator progress updates | Queued as `OPERATOR_UPDATE`. |
| Review pending synchronisation | Sync centre (`/sync`). |

Triage, allocation, Chief Technician reviews, procedure review and publication need a connection: they depend on decisions that must be made against current server state.

## Local storage (Dexie, `frontend/src/db.ts`)

`equipment`, `faults`, `faultContexts`, `knowledge`, `procedures`, `notifications`, `pendingEvents` (the outbox), `pendingAttachments`, `syncMeta` (device id, sequence counter, cache time), `syncLog` (last 200 attempts) and `offlineSessions`. Assignments, events and versions are held inside each cached `faultContexts` record rather than separate tables, because the server delivers them together and they are only read per fault.

## Event outbox

```json
{
  "event_id": "client UUID (idempotency key)",
  "fault_id": "server id, or a client UUID for a breakdown reported offline",
  "event_type": "FAULT_REPORTED | FAULT_ACTION | DIAGNOSIS_RECORDED | INTERVENTION_RECORDED | OPERATOR_UPDATE",
  "actor_id": "USER-…",
  "device_id": "DEVICE-…",
  "client_timestamp": "ISO-8601 device clock",
  "sequence_number": 7,
  "base_status": "status the user saw (workflow actions)",
  "payload": {}
}
```

The sequence counter is per device and incremented inside the same IndexedDB transaction as the event write. After queuing, the local cache is updated optimistically (status, pending diagnosis/intervention rows) so the user sees their own work.

## Server application (`backend/app/services/sync.py`)

`POST /api/v1/sync/events` accepts up to 500 events and returns a per-event acknowledgement.

1. Events are applied in `sequence_number` order through the same service functions as the REST routes (`services/fault_operations.py`), as the authenticated user. Offline clients cannot bypass permission or workflow rules.
2. Each event is committed on its own; one failure never loses another event's change.
3. Outcomes:
   - `APPLIED`: the change was made; `result` carries the server's response (e.g. the official fault reference).
   - `DUPLICATE`: the `event_id` was seen before; the stored outcome is returned and nothing is applied again.
   - `CONFLICT`: the workflow rules return 409, or the fault's status differs from `base_status`. The event is stored, not applied. Later events for the same fault in the batch are held behind it to preserve per-fault order.
   - `REJECTED`: permission or validation failure (other 4xx), or an event claiming a different actor. Stored for audit.
4. Every timeline entry produced by an offline event records `offline.device_id`, `offline.client_timestamp` (device clock) and `offline.received_at` (server clock). Record timestamps are the server's.
5. `sync_batches` records each upload (counts by outcome) as the synchronisation audit history.

## Conflict reconciliation

Conflicting changes are never silently applied or overwritten. `GET /api/v1/sync/conflicts` lists them for the author, for Chief Technicians/Chief Engineers in the fault's section, and for Supervisors, Maintenance Managers, the GM O&M and System Administrators.

`POST /api/v1/sync/conflicts/{event_id}/resolve` with:

- `APPLY`: re-run the change against the current record, **as the original author** (their permissions still apply), ignoring the stale `base_status`. If the rules still refuse it, it stays a conflict and the reason is returned.
- `DISCARD`: requires a reason.

Both record who decided, when and why, and add a `SYNC_CONFLICT_RESOLVED` entry to the fault timeline.

## Client synchronisation (`frontend/src/offline/sync.ts`)

- Reachability is checked against `/api/v1/health`, not `navigator.onLine`.
- Retry triggers: app start, connectivity returning, the app becoming visible, the simulator switching back online, a 60-second timer, a new queued change, a service-worker Background Sync message (where supported), and **Sync now**. Background Sync is never the only trigger.
- Failures back off exponentially (2 s doubling to 5 min) with full jitter.
- Events are sent in batches of 100. If a batch fails schema validation, events are re-sent one at a time so one malformed event cannot block the rest.
- A 401 stops automatic retries until the user signs in online; queued work is kept.
- Only the signed-in user's events are sent; another user's queued work waits for them.

## Offline sign-in (`frontend/src/offline/session.ts`)

After an online sign-in the device stores a PBKDF2-SHA-256 verifier (210,000 iterations, random salt), the profile and the server token. Passwords are never stored. The same credentials unlock the cached session offline for up to 7 days after the last online sign-in. An offline session can only read cached data and queue changes. If the server token has expired by the time the device reconnects, the user must sign in online before queued work is sent.

## Network simulator

`frontend/src/offline/network.ts` routes every API request. Modes: **online**, **offline** (every request fails before reaching the network) and **intermittent** (about half of requests fail after a delay). It drives the real offline paths. Controls appear on the sign-in screen and, in the app, on the Sync centre for System Administrators. The mode is per browser and persists across reloads, like a real outage.

## Limitations

- Evidence upload after reconnection is not idempotent: if an upload succeeds but its response is lost, the retry can store a second copy.
- A breakdown reported offline cannot be investigated offline, because it has no section assignment until the server routes it.
- Offline sessions trust the device: anyone who knows the password and has the device can read its cached data.
