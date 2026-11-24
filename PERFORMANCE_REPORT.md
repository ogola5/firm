# Performance Report

Measured on 24 November 2026 against the synthetic demonstration dataset. These are development-environment measurements, not field results.

## Environment

| Item | Value |
|---|---|
| Host | Windows 11, WSL 2 (Ubuntu 24.04), Docker Desktop |
| Frontend | Production build served by `vite preview` in Docker (Node 22), Workbox service worker |
| Browser | Headless Chromium 131 (Playwright 1.49), desktop viewport, same machine |
| Backend | FastAPI in Docker, PostgreSQL 16 in Docker |
| Data | 111 faults, 782 fault events, 34 equipment records; 2,000 extra synthetic equipment rows on the device for the search test |

Network latency is effectively zero (everything is local). Field devices on a site network or a mobile connection will see slower *online* figures; the offline figures do not depend on the network.

## Results against the build brief's budgets

| Budget (MASTER BUILD PROMPT §8) | Target | Measured | Result |
|---|---|---|---|
| Cached application launch | < 2 s | p50 93 ms, p95 109 ms (fully offline, from the service-worker cache) | Met |
| Local equipment search | < 200 ms | Tag prefix p95 2.9 ms; free-text p95 20.8 ms (max 51 ms); no-match p95 30.1 ms, over 2,030 rows | Met |
| Local equipment history | < 300 ms | Cached investigation lookup p95 0.6 ms | Met (see note) |
| Local fault persistence | < 150 ms | Outbox write p95 2.7 ms | Met |
| Cached dashboard initial display | < 1 s | Dashboard heading visible p50 93 ms offline, 100 ms online | Met |

Note on history: the lookup is a primary-key read of one cached investigation record, so its cost does not grow with the number of cached records. The measurement used one cached investigation; the test opened several breakdowns but only the first had finished caching when the timer ran.

## Frontend detail

| Measurement | Value |
|---|---|
| First visit, empty cache: navigation to sign-in form visible | 161 ms |
| First visit: DOMContentLoaded / load event | 65 ms / 65 ms |
| First visit: transferred | 162 KiB (gzip) |
| Cached launch, offline (8 runs) | p50 93 ms, p95 109 ms |
| Cached launch, online (8 runs) | p50 100 ms, p95 105 ms |
| Local search, tag prefix "PERF-01" (indexed `startsWithIgnoreCase`) | p50 2.2 ms, p95 2.9 ms |
| Local search, text "bay 17" (index miss, filtered scan) | p50 14.3 ms, p95 20.8 ms |
| Local search, no match (full scan) | p50 26.8 ms, p95 30.1 ms |
| Outbox write (event + sequence counter in one transaction) | p50 2.0 ms, p95 2.7 ms |

Bundle: the initial chunk is 480 KB (152 KB gzip). Each screen is its own chunk, and the chart library (Recharts) loads only for management dashboards. The service worker precaches 31 files (about 1.1 MB) so the installed app opens without a network.

## API detail (30 requests each, after one warm-up)

| Endpoint | p50 | p95 | Payload |
|---|---|---|---|
| `GET /faults` (Systems Automation, 111 visible) | 82.9 ms | 96.0 ms | 70 KB |
| `GET /faults/{id}/context` | 28.7 ms | 34.5 ms | 12 KB |
| `GET /faults/{id}/timeline` | 4.7 ms | 5.6 ms | 4 KB |
| `GET /equipment` | 5.0 ms | 5.8 ms | 9 KB |
| `GET /intelligence/equipment/{id}` | 11.5 ms | 12.7 ms | 2 KB |
| `GET /knowledge` | 5.0 ms | 5.9 ms | 26 KB |
| `GET /analytics/overview` | 46.7 ms | 79.6 ms | 3 KB |

## Offline synchronisation throughput

Each event is applied through the full permission and workflow checks and committed on its own (see OFFLINE_SYNC_DESIGN.md).

| Batch | Time | Throughput | Resend (all duplicates) |
|---|---|---|---|
| 1 event | 16 ms | — | 10 ms |
| 50 events | 197 ms | 254 events/s | 34 ms |
| 200 events | 694 ms | 288 events/s | 113 ms |

A device returning from a long outage with a few hundred queued changes synchronises in about a second on this hardware.

## Database

Query plans (`EXPLAIN ANALYZE`, PostgreSQL 16):

| Query | Plan | Execution |
|---|---|---|
| Fault timeline by `fault_id` | Index scan on `ix_fault_events_fault_id` | 0.21 ms |
| Sync idempotency check by `event_id` | Index-only scan on the primary key | 0.03 ms |
| Repeat lookup by equipment, last 90 days | Sequential scan of `faults` | 0.05 ms |
| Open-fault count by status | Sequential scan of `faults` | 0.03 ms |

The two sequential scans are the planner's correct choice for a 111-row table; the indexes on `faults.equipment_id`, `faults.status` and `faults.created_at` exist for when the table grows. This was not tested at production scale.

## Findings and next steps

- **`GET /faults` returns every visible fault (70 KB).** It is the slowest read and grows linearly with history. The UI pages the list client-side; server-side pagination (`limit`/`offset` with a total count) should replace that before real data volumes.
- **Analytics are computed on each request** (p95 80 ms here). Fine for the prototype; at larger volumes, cache the overview for a short period or precompute daily aggregates.
- **Free-text equipment search scans the device table.** It stays well inside budget at 2,000 rows. Beyond roughly 20,000 rows, add a word index (a multi-entry Dexie index on name tokens).
- These figures come from one machine with no network latency. Repeat them on a target tablet over the site network before drawing operational conclusions.

## Reproducing

```bash
docker compose up -d --build
PERF=1 scripts/e2e.sh performance                      # writes frontend/perf-results/frontend.json
cd backend && .venv/bin/python scripts/perf_api.py      # writes backend/perf-results/api.json
docker compose exec backend python -m app.cli reset     # the throughput test adds synthetic operator updates
```
