# Changelog

## 2026-11-24

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
