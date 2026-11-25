# Changelog

## 2026-11-25 — Company-email accounts

Everyone signs in with their KPC email (`@kpc.co.ke`); what they see follows from the role and section approved for that address. See [ACCOUNTS.md](ACCOUNTS.md).

- **Enrolment:** the person enters their KPC email, name, staff number and requested job and section. They confirm the address with an emailed 6-digit code and choose a password. The System Administrator then approves (setting the role and section) or rejects with a reason.
- **Sign-in** by email. Unknown addresses and wrong passwords get the same answer. The account locks for 15 minutes after 5 failures. A clear reason is given when the account is waiting for approval, rejected or disabled.
- **Forgot password** by emailed code. Changing or resetting a password ends all other sessions.
- **My account** for everyone: details, who approved them, last sign-in, what they can do and see in plain words, change password, sign out.
- **User management:** an *Account requests* queue (approve with a corrected role or section, reject with a reason, duplicate staff-number warning); direct account creation now uses a KPC email; last sign-in shown.
- **Demo mailbox** (`/mailbox`): the prototype never sends real email. Turn it off with `DEMO_MAILBOX=false`.
- Seeded accounts are now `demo.<name>@kpc.co.ke` (same password). Migration `0004`.

## 2026-11-25 — Analytics, trends and intelligence

One definition per figure ([METRICS.md](METRICS.md)), computed in one place (`backend/app/services/analytics/`), and shown with the number of faults behind it.

- **Measures:** faults reported, time to first response, time to get on site, time to restore (medians), first-time fix, repeat faults (90 days), came back after fix (30 days), failed attempts per fault, open at period end. Periods are cut at midnight Kenya time; weeks start Monday.
- **Comparison with the previous period**, stated in words (better/worse by each measure's direction). Fewer than 5 faults: "too few to compare". Volume is shown as context, never as performance.
- **Analytics page** (`/analytics`): headline tiles, one trend chart per measure (single line, tooltip with n, "Show as table"). Weeks or months cut short by the period are drawn hollow and labelled "(3 of 7 days)", so a part-week is not read as a drop. Also the equipment needing attention, with reasons; the section comparison; and record completeness.
- **Similar earlier faults** on the fault page and beside the visit write-up: ranked by equipment, symptom, category and recency (configurable weights), each with its reasons and what worked or didn't. Labelled "Similar is not the same cause".
- **Access:** org-wide roles see all sections; Chief Technicians and Chief Engineers are held to their own section; the CEO sees headlines and trends only; Operations, HR and field technicians have no analytics.
- **Demo data:** a year of mostly-finished history, with a few assets that fail more often than the rest, varied response and restore times, and recorded causes and fixes on most restored faults. Illustrative only.

## 2026-11-25 — Desk workflow (control room and technician desks)

Designed for how the work is actually done: operators report from the control-room desk after seeing a fault on SCADA or a site walk, and technicians carry no device on site, writing up from a notebook afterwards.

- **Report a fault** in four answers: equipment by tag or plain description (best match, confirmed with one click, or left for Systems Automation to identify), where and when it was seen, what is wrong, and the effect (which sets priority). Ctrl+V pastes a SCADA screenshot.
- **My jobs** for investigating roles: to write up, assigned (take the job), new for Systems Automation, ready for a procedure, and waiting on others.
- **Printed job card** (A4) with the problem, last time's working and failed fixes, and note lines in the same order as the write-up screen.
- **Write up a visit** on one screen: arrival and back-in-service times from the notes, what was found, each step marked worked / didn't work / partly, parts, and sign-off. Replaces separate diagnosis, intervention and status steps for technicians.
- **Real times:** visit times are validated against the report time and the clock, recorded on the timeline with `recorded_at` kept separately, and the restoration time used by analytics is the technician's back-in-service time, not the sign-off click. Writing up a job that was not taken counts as taking it on arrival.
- **Procedure drafts** built from the write-up (including what didn't work), checked instead of retyped.
- Realistic illustrative equipment names and aliases; equipment search matches descriptions as well as tags (server and offline).
- Visit write-ups work offline (sync event `VISIT_RECORDED`). Migration `0003` adds equipment aliases, observation time and how a fault was seen, and the back-in-service time.

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
