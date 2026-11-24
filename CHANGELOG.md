# Changelog

## 2026-11-24 — Frontend stack and structure (Stage 3)

- Split the 1,800-line `main.tsx` into app, feature, component, offline and lib modules; `FaultDetail` became a data hook and nine panels.
- Adopted Tailwind CSS (design tokens keep the existing look), shadcn/ui-style primitives, TanStack Query, React Hook Form + Zod and Recharts; removed the legacy stylesheet.
- Lazy-loaded routes; charts load only for management dashboards; paginated breakdown and knowledge lists.
- Workbox service worker with precached app shell, web app manifest and icons; the Docker frontend now serves the production build.
- Playwright Scenarios 1, 2, 3, 5 and 6 added; the installed app is tested cold-starting with no network.
- Performance measured and reported (PERFORMANCE_REPORT.md); all build-brief budgets met on the development machine.
- Fixed: the "seen before" warning never showed to Operations while reporting (the intelligence endpoint refused that role).
- Fixed: a late session check could sign a user back in, or out, after they had changed user.
- Fixed: Operations was offered the section hand-off form, which the server rejects.
- Sync conflicts now show which breakdown they concern, newest first.

## 2026-11-24 — Offline-first (Stage 2)

- Offline events are now applied to real records through shared service functions (`services/fault_operations.py`), with per-event `APPLIED`/`DUPLICATE`/`CONFLICT`/`REJECTED` acknowledgements. Previously they were only stored.
- Conflict detection (workflow 409s and stale `base_status`), per-fault holding of later events, and a reconciliation API (apply as the original author, or discard with a reason).
- Sync batches, per-event outcome history, device and client timestamps on timeline entries; migration `0002`.
- Frontend: durable outbox with device sequence numbers, optimistic local updates, sync engine with reachability checks, exponential backoff with jitter, multiple retry triggers and Background Sync where supported.
- Offline sign-in using a PBKDF2 verifier; offline reporting with evidence files, offline workflow steps, diagnoses, interventions and operator updates; cached equipment, breakdowns, investigations and knowledge.
- Sync centre page and demonstration network simulator (online/offline/intermittent) that drives the real request path.
- The browser now calls a same-origin `/api` that Vite proxies to the backend, so the hardcoded `localhost:8000` is gone. The service worker no longer caches API responses or cross-origin requests.
- Playwright end-to-end suite running in the official Playwright Docker image (`scripts/e2e.sh`).

## 2026-11-24 — Backend foundation (Stage 1)

- Split the 3,500-line `backend/app/main.py` into `core/config`, `db`, `models`, `schemas`, `deps`, `services/*` and 14 routers. API paths and behaviour are unchanged.
- Moved to PostgreSQL 16 (Docker Compose service on host port 5433) with Alembic migrations; removed the ad-hoc SQLite `ALTER TABLE` upgrade code.
- Added indexes on fault, assignment, procedure and equipment foreign keys and on fault status/creation time.
- Added `python -m app.cli migrate|seed|init|reset`; the backend container migrates and seeds on start.
- Fixed seed insert ordering that violated foreign keys (hidden by SQLite).
- Added an attachment storage abstraction, environment-based settings, a generic error handler and `/api/v1/health`.
- Test suite now builds its schema through the migrations and can run against PostgreSQL.

## 2026-11-23

- Added repeat-fault Seen Before reporting and direct routing to the responsible maintenance section.
- Added ranked troubleshooting with quick checks, confirmed/failed fix counts, recurrence and workaround warnings, and risky-fix supervisor flags.
- Added critical-window minute-level handoff analytics and a repeat-versus-first-fault 60% improvement target baseline.
- Added a SOCA-compatible contributor recognition leaderboard based on approved procedures, revisions and confirmed reuse.
- Added a deferred SAP integration status model; read-only consideration is planned only after workflow stabilisation and write-back remains disabled.
- Connected fault investigation to reusable work-procedure updates, including attributed diagnoses, failed/successful interventions and equipment history.
- Added Chief Technician/Chief Engineer technical review, clarification-and-revision history, and separate Supervisor publication of approved versions.
- Added colleague-attributed knowledge reuse and post-restoration outcome confirmation.
- Added HR date-filtered employee contribution evidence with contextual response/restoration times and no fault narratives.
- Added GM O&M section handoff funnel, timing baselines, wrong first assignments and repeat direct-routing analytics.
- Added synthetic investigation, procedure-review and repeat-reuse history to the demonstration data.
- Added end-to-end API coverage for the contribution, clarification, publication, reuse and appraisal cycle.
- Normalized and refreshed older cached browser sessions to prevent missing role-permission data from crashing the React shell.
- Added section-specific technician (ST/PT/CT) and engineer (Assistant/Engineer/Senior/Chief) roles.
- Added HR directory, maintenance leadership, GM O&M and CEO visibility boundaries.
- Added backend-protected account creation/status management for System Administrators.
- Added an administrator-only audit history for account provisioning and status changes.
- Added the role access matrix and synthetic demo accounts for each section/tier.
- Verified Ubuntu 24.04 WSL Docker CLI and daemon connection through Windows Docker Desktop.
- Added Docker build-context exclusions and documented WSL Compose startup.
- Built both images and started the frontend/API with Docker Compose.

## 2026-11-20

- Established FastAPI and React/Vite foundation.
- Added synthetic users, 30 equipment records, 105 faults and 30 knowledge entries.
- Added JWT login, backend RBAC, fault reporting, triage and analytics.
- Added IndexedDB outbox and PWA service-worker shell caching.
- Added Docker Compose and demonstration documentation.
