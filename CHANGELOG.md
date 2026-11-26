# Changelog

## 2026-12-02 — UI/UX: next step, plain language, "Needs you now", search, night and sunlight modes, guided demo

- **Fault page:**
  - **Progress line in plain words:** Reported → Sorted (With Electrical) → Taken → On site → Signed off → Confirmed.
  - **Next step for this person:** for example "Take this job", "I'm on site", "Write up your visit", "Review and sign off" or "Confirm it works". On phones it stays within reach above the bottom tabs.
  - **Three tabs:** Now, What we know, History, kept in the address so a link can open a tab.
- **Plain language:** statuses and headings in the words people use ("Waiting to be taken", "Who has worked on it", "What happened, in order", "It's fixed: ask for sign-off").
- **Toasts and skeletons:** short confirmations near the thumb instead of a box at the top of a long page, and grey outlines while loading.
- **"Needs you now":** one prioritised list on each home, safety first, each item with one button (`GET /api/v1/me/needs-you`). The duplicate escalation panel on engineer homes is removed.
- **Equipment page** (`/equipment/{id}`): open faults, its own history with what worked, usual causes, likely-to-fail status, system, drawings and "Report a fault on this" (`GET /api/v1/equipment/{id}/summary`).
- **Search in the header** from any screen: tags and names go to the equipment page; words search the library or earlier faults. Equipment search works offline.
- **Display modes:** Day, Night (night shifts, control rooms), Sunlight (outdoors, higher contrast) or follow the phone. In the menu and on My account, saved on the device. Hard-coded whites replaced with theme colours.
- **Guided demo** (`/tour`, linked from sign-in): the Line 4 story in 11 chapters. Each chapter switches to that person's demo account and screen, with a bar saying what to notice and "Next".

## 2026-12-01 — Pillar C: smarter similar faults, related equipment, offline. Pillar B: system pages, tools and parts

**Pillar C — repeat-fault intelligence**
- **Shorthand and word forms:** similar-fault matching uses the same vocabulary as search (`services/vocabulary.py`). "VFD hot trip" finds "drive tripped on overtemperature"; "valves stuck" finds "valve sticking". A word or two in common no longer counts as a similar problem.
- **Related equipment:** equipment now belongs to systems (e.g. Line 4 pump A unit: pump, drive, lube-oil panel, vibration monitor, RTU).
  - Related equipment counts in the ranking (0.6, between same equipment 1.0 and same type 0.5), with the reason shown.
  - The fault page shows "Part of …" and recent faults on the equipment it works with.
- **Fixed — pump tags:** 11-P-501 and PUMP-101 are now recognised as the same type (pumps) in similar faults.
- **Fixed — matches across equipment types:** a fault no longer gets another equipment type's procedures or older instructions just because the problem words match ("Stopped / tripped").
- **Offline:** similar faults are ranked on the phone with no connection.
  - The case index (`GET /api/v1/intelligence/case-index`) is saved with the offline data and carries the server's weights and vocabulary, so the phone applies the same rules (`frontend/src/lib/similarity.ts`).
  - Offline results say when the copy was saved.
- **Fixed — stemming:** "valves" was reduced to "valv" and missed "valve". Fixed on both the server and the phone, with matching unit tests.

**Pillar B — knowledge library**
- **System pages** (`/library/systems/{id}`, Systems section on the Library home; legacy systems first), with:
  - what the system is, how the parts connect (interlocks, permits, signals) and its known limitations
  - **changes over the years** (re-wiring, replaced parts), which anyone in maintenance can record
  - its equipment, drawing differences, expert notes and recent faults

  CTs and engineers edit the text.
- **Tools and parts on procedures:** filled in from what was used on the visit, shown on the library card and included in version comparison.
- **API:**
  - `GET /api/v1/library/systems`, `GET /api/v1/library/systems/{id}`
  - `PATCH /api/v1/library/systems/{id}`, `POST /api/v1/library/systems/{id}/changes`
  - `system_id` on equipment; `system` and `related_faults` on the fault context
- **Migration `0012`.** Illustrative systems and change histories (`app/seed_systems.py`).

## 2026-11-30 — Notification centre; side-by-side procedure versions

- **Notification centre** (bell in the header, `/notifications`; also emailed where email already went):
  - **Who hears what:**
    - new fault → Systems Automation
    - safety report → SA and the owning section's CT in that region
    - hand-over to a section → that section's CT
    - job allocated → the technician (links to the job card)
    - job taken → CT
    - waiting for sign-off or hand-over → CT
    - returned → technician
    - signed off → reporter ("please confirm") and technician
    - "not fixed" → CT and technician
    - seen again → CT
    - escalations and guidance → SE / CE / CT
    - procedure to review → section CT and CE
    - ready to publish → supervisors
    - published / question / not accepted → author
    - knowledge owner named, procedure withdrawn, "your procedure helped" → the person concerned
  - **How it works:**
    - Driven from the fault timeline, in one place (`services/notifications.py`); nobody is notified of their own action.
    - Demo history is seeded quietly, so it doesn't fill anyone's bell.
    - `GET /api/v1/notifications`, `POST /api/v1/notifications/{id}/read`, `POST /api/v1/notifications/read-all`.
- **Side-by-side procedure versions** (`/procedures/{id}/versions`, linked from the library):
  - Pick any two versions and see the changes field by field, line by line (removed, added, unchanged listed).
  - Each version shows its author, date, source fault, change reason, who checked it and who published it, and the review notes.
  - Reviewers see "What changed since v…" with the reason on the approval card.
  - `GET /api/v1/procedure-updates/{id}/versions`; unpublished versions are visible only to the author and reviewers.
- **Change reasons are required** for every revision and every improvement to an existing procedure (proposal module 7: author, time, change reason and approving supervisor are all recorded).
- Migration `0011`.

## 2026-11-29 — Proper search, and report answers as queryable data (PostgreSQL, no second database)

- **Library search** across cases, approved procedures, expert knowledge and older instructions (`GET /api/v1/library/search?q=`):
  - **Matching:** full-text with stemming ("tripped" finds "trip"), and KPC shorthand ("vfd" also means drive, "hot" also means overtemperature, "comms" also means communication).
  - **Typos:** tolerated through `pg_trgm` ("overtemprature").
  - **Ranking:** by how many of the searched words match. One shared word is not a match.
  - **Results:** matched words are highlighted.
- **History search** (`/faults?search=`) is ranked the same way and also searches what was found and what was done. References and tags still match exactly.
- **Report answers as JSONB:** the reporter's follow-up answers are now JSONB with a GIN index.
  - `GET /api/v1/faults?answer=position:Stuck part-way` filters by answer.
  - The library shows "What reporters said" per problem, with what usually fixed it, e.g. "Position: Stuck part-way → usually fixed by cleaning and lubricating the stem".
  - Demo faults now carry the answers a reporter would have given.
- **Migration `0010`:**
  - The `pg_trgm` step is optional: if a host refuses it, search uses full-text only.
  - The JSONB conversion keeps existing data.
- **SQLite fallback:** SQLite (tests) uses the same sources and vocabulary with simpler matching.
- **Tests:** the backend suite passes on both SQLite and PostgreSQL.

## 2026-11-28 — Cleaner demo history; merged causes

- **Type-specific demo history:**
  - The generic demo history (the same four causes and "synthetic" text on every piece of equipment) is replaced by type-appropriate cases. For example, pumps get latched trips, seals and alignment; valves get selector switches and sticking stems; level transmitters get water in the housing.
  - Each case has a realistic failed attempt, and the procedures and older work instructions match.
  - It runs on start-up and only changes rows that still hold the generic text, so existing databases (Render) are cleaned too (`app/demo_content.py`).
- **Merged causes:** the library groups causes by cause category, so different wordings of the same cause become one line. The other wordings are listed under "Also recorded as", so nothing recorded is hidden.

## 2026-11-28 — Knowledge library by equipment type

See [KNOWLEDGE_LIBRARY.md](KNOWLEDGE_LIBRARY.md) for the philosophy and the decisions.

- **Library** (menu, and a bottom tab for technicians on phones):
  - pick the equipment type, then the problem
  - each problem shows likely causes with how often they were confirmed and what to check first, what worked and what didn't, approved procedures with evidence and "last confirmed working", and the cases
  - each type also shows its owner, watch-outs (expert notes, drawing differences, safety) and older work instructions
- **Knowledge owners:** a named CT or SE per equipment type, appointed by the Chief Engineer. Owners are emailed about new and improved procedures, see what needs checking, and can withdraw what no longer applies.
- **One clear answer:**
  - the write-up asks whether it adds to an existing procedure; if so it becomes the next version, credited to the new contributor
  - publishing a newer version marks the earlier ones **Superseded**
  - **Withdrawn** procedures stay in the history
  - credit stays in both cases
- **Freshness:** procedures not confirmed working for a year are marked "check before relying on it".
- **"Your knowledge at work"** on technician, CT and CE homes; the author is emailed when a colleague's fix used their procedure.
- **HR appraisal:** knowledge contribution columns, shown as *proposed* until management approves (`APPRAISAL_KNOWLEDGE_STATUS`).
- **Worked illustrative cases** for pumps, valves, level transmitters, strainers, RTUs and drives.
- **Fix:** the desktop sidebar scrolls when the menu is longer than the screen.
- Migration `0009` (knowledge owners).

## 2026-11-27 — Regions and escalation to the Senior and Chief Engineers

See [ESCALATION.md](ESCALATION.md).

- **Three regions:** Western, Nairobi and Coast. Each piece of equipment belongs to a region through its pump station.
  - Regional staff (ST, PT, CT, AE, E, SE) see their section in their region.
  - The Chief Engineer sees the whole section.
  - The CT allocates only within their region.
  - Procedures and the library stay section-wide.
- **Escalation, CT → regional SE → section CE:**
  - **To the SE:** when the CT asks, at once for a safety report, or automatically when not back in service after 8 hours.
  - **To the CE only if it persists:** the same equipment fails again within 30 days of a fix, or the SE escalates it (spares, design change, contractor, repeated fixes).
  - Each escalation is emailed and recorded on the timeline. The SE and CE can add guidance, which reaches the CT and the technician.
- **Screens:**
  - an "Escalated to you" panel on SE and CE homes, and an Escalations page
  - an escalation card on the fault page
  - badges and guidance in My jobs
  - the region in the sidebar, scope, enrolment, approvals, account creation, access changes and the people list
- **Accounts:** the region is part of the account and of the session's access version, so changing it signs the person out.
- **API:**
  - `POST /api/v1/faults/{id}/escalate`
  - `POST /api/v1/faults/{id}/escalation-guidance`
  - `GET /api/v1/escalations`
  - escalation fields on fault list, detail, context and jobs
- **Migration `0008`** (it backfills regions from stations and puts existing regional staff in Nairobi). Demo data: Coast and Western teams for every section.

## 2026-11-26 — Knowledge capture, recognition, drawings and "likely to fail"

See [KNOWLEDGE_CAPTURE.md](KNOWLEDGE_CAPTURE.md).

- **Recognition points**, earned only from verified contributions:
  - approved procedures, and colleagues' fixes using them
  - expert sessions, verified drawing differences, accepted answers
  - shadowing jobs, and complete write-ups

  Speed and volume never count. Each person sees every point and why. HR sets the values and the monthly cap, records redemptions (cash, voucher, day off), and records Employee of the Month, Quarter (financial-year quarters) and Year from a shortlist with the evidence. Awards are visible to everyone.
- **Write-up pick-lists:** the kind of cause (required) and the kind of action per step (a simplified ISO 14224 list). They work offline.
- **Drawing differences:**
  - recorded in the write-up, or directly against the equipment
  - verified by the section chief, then printed on every job card and shown on the fault page
  - verified ones become red-lines for the drawing office until a new revision is issued
- **Drawing register** as a placeholder for KPC's digitisation: paper only until a file is linked.
- **Expert knowledge:**
  - knowledge at risk, from HR's retirement dates and who actually fixes each equipment type
  - expert sessions, approved by the chief and credited by name, shown on job cards
  - Ask the expert
  - shadowing: an adviser paired by the Chief Technician
- **Likely to fail:** an explainable watch list per section, with reasons, usual cause and procedure, shown at the top of My jobs. Its accuracy is back-tested against what actually failed.
- Migration `0006`. Demo data: retirement dates, an illustrative drawing register and differences, an expert session, an answered question and one past award.

## 2026-11-25 — Weekly, monthly and financial-year reports

- **Reports** (menu, for CT, CE, MM, GM, Supervisor, System Administrator and CEO).
  - Weekly (Monday to Sunday), monthly, and financial year **July to June**, each compared with the period before. A financial year to date is compared with the same dates a year earlier.
  - Section leads get their own section; managers get all sections or one section; the CEO gets a headline-and-trends version.
- **Print:** an A4 document with only the report on paper and the online link in the footer.
- **Email:** *Email it to me* sends a report at once. Scheduled emails go out on Monday, the 1st and 1 July at 07:00 Kenya time, to each level's default readers, each person once (delivery log). People choose their reports under My account.
- **Scheduling:** `python -m app.cli send-reports` for a scheduled task. Migration `0005`. Details in [REPORTS.md](REPORTS.md).

## 2026-11-25 — Each level's view comes from the account

- **One access profile per level, built on the server** (OPS, SA, ST, PT, CT, AE, E, SE, CE, MM, GM, SUP, HR, MD, ADMIN). It sets the home page, menu, scope and abilities, and is sent with the account. The browser's own role lists are removed: the menu, routes, home page, analytics, similar faults, people and sync screens all follow the profile.
- **New homes:**
  - The Chief Engineer gets *Section engineering*: the section's last-4-week figures, equipment needing attention, then their jobs.
  - The System Administrator gets *Administration*: account requests and account counts.
  - The Supervisor gets *Supervision*, which points to procedures waiting for publication.
  - The level code is shown beside the person's name.
- **The session token carries the account:** email, role, level, section, an access version and a password version.
  - If an administrator changes someone's level or section (**Change access**, new) or disables them, the old session is refused at once. The person is signed out with the reason and signs in to their new view.
  - Forged or edited tokens are refused.

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
