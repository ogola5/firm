# Build Plan

Live checklist. A feature is ticked only when it works and is covered by tests.

## Done before this plan

- [x] Login and role-based access (15 tiered roles, section scope, backend-enforced)
- [x] Equipment registry and history
- [x] Fault reporting, Systems Automation triage, Chief Technician allocation/review, section handoffs, operator confirmation
- [x] Diagnoses, failed and successful interventions, evidence attachments
- [x] Fault-derived procedures: technical review, clarification, revision, Supervisor publication, reuse outcomes
- [x] Repeat-fault flag and ranked troubleshooting
- [x] Database-driven analytics, HR/GM/CEO views, recognition leaderboard

## Stage 1 — Backend foundation

- [x] Split the single-file backend into config, db, models, schemas, services and routers
- [x] PostgreSQL via Docker Compose; Alembic initial migration with indexes
- [x] `app.cli` migrate / seed / init / reset commands
- [x] Attachment storage abstraction
- [x] Generic 500 handler (no internal details to clients) and health endpoint
- [x] Test suite passes on SQLite and PostgreSQL

## Stage 2 — Offline-first

- [x] Move fault/investigation operations into services callable from routes and sync
- [x] Apply synced events to real records, per-fault ordering, server acknowledgements
- [x] Conflict detection and reconciliation workflow
- [x] Retry with backoff and jitter; Sync Now; sync history
- [x] Offline session for previously authenticated users
- [x] Expanded IndexedDB schema and cached datasets
- [x] Network simulator (online / offline / intermittent)
- [x] Playwright Scenario 4 (offline maintenance)

## Stage 3 — Frontend stack and structure

- [x] Split `main.tsx` into app, feature, component, offline and lib modules; `FaultDetail` into panels
- [x] Tailwind CSS and shadcn/ui-style primitives; TanStack Query; Recharts; React Hook Form and Zod
- [x] Workbox service worker, web app manifest and icons; production build in Docker; cold offline start tested
- [x] Playwright Scenarios 1–3, 5–6 (all six scenarios pass)
- [x] Performance measurements and PERFORMANCE_REPORT.md
- [ ] Server-side pagination for `GET /faults` (see performance report)

## Stage 4 — Missing modules

- [ ] Notifications and overdue escalation
- [ ] QR generation and scanning
- [ ] Weighted similar-fault ranking with explanations and configurable weights
- [ ] Legacy system documentation area
- [ ] SAP integration simulator (read-only mappings, unresolved identifiers)

## Implementation assumptions

- Demo credentials are synthetic and must not be reused.
- Offline synchronisation is event-based and append-only; the server is authoritative.
- Approved knowledge is the only knowledge surfaced as verified guidance.
