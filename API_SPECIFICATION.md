# API Specification

All application APIs use `/api/v1/`. Interactive OpenAPI documentation is available at `/docs`.

Authentication:
- `POST /api/v1/auth/login`
- `GET /api/v1/auth/me`
- `GET /api/v1/auth/demo-accounts` (synthetic account selector)
- `GET /api/v1/access/roles` (System Administrator)

People and access:
- `GET /api/v1/users` (HR Officer and System Administrator)
- `GET /api/v1/users/summary` (HR, Maintenance Manager, General Manager O&M and System Administrator; counts only)
- `GET /api/v1/hr/appraisal?start_date=YYYY-MM-DD&end_date=YYYY-MM-DD` (HR-only attributed contribution evidence and timing measures; no fault narratives)
- `POST /api/v1/users` (System Administrator)
- `PATCH /api/v1/users/{id}/status` (System Administrator)
- `GET /api/v1/users/audit` (System Administrator)
- `GET /api/v1/chief/team` (Chief Technician; active status, availability, workload and competencies for the Chief's ST/PT pool)
- `PATCH /api/v1/me/availability` (Senior/Principal Technician; set `availability_status` to `AVAILABLE` or `UNAVAILABLE`)
- `PATCH /api/v1/chief/team/{user_id}/competencies` (Chief Technician; update competencies for an ST/PT in the same section)
- `GET /api/v1/chief/workspace` (Chief Technician; section-only active faults, review queue, escalations and team workload)

Visibility is enforced by the API: section technical roles are filtered to their assigned section, HR cannot access raw fault/equipment records, and the Managing Director/CEO receives summary analytics only. HR contribution evidence contains no individual fault narratives. See [ROLE_ACCESS_MATRIX.md](ROLE_ACCESS_MATRIX.md).

Equipment:
- `GET /api/v1/equipment?search=...` (tag, name, category, station, location, section and description search; section-scoped for technical roles)
- `GET /api/v1/equipment/{id}`
- `GET /api/v1/equipment/{id}/history`

Faults:
- `POST /api/v1/faults` accepts an optional equipment candidate, `equipment_confirmed`, the reporter's original equipment wording, known location, observed symptom, operating conditions and operational impact. Evidence is uploaded through the attachment endpoint. Every report starts with a Systems Automation assignment; repeat-fault history is shown but never bypasses this first response.
- `GET /api/v1/faults?queue=mine|section_open` (open work assigned to the signed-in user, or the user's section queue)
- `GET /api/v1/faults?history_scope=reported_by_me|worked_by_me&search=...` (previous-work search; no scope value returns the full permitted history)
- `GET /api/v1/faults/{id}`
- `GET /api/v1/faults/{id}/timeline`
- `GET /api/v1/faults/{id}/context` (equipment history, ordered section assignments, findings/recommendations, attachments, operator updates, diagnoses, interventions, approved procedures and review timeline)
- `POST /api/v1/faults/{id}/triage` (Systems Automation confirms the physical asset; the current assignment remains Systems Automation)
- `POST /api/v1/faults/{id}/assignments/{assignment_id}/allocate` (section Chief Technician assigns/reassigns an available ST/PT, priority, response target and instructions)
- `POST /api/v1/faults/{id}/assignments/escalate` (records required findings and recommendation; puts the current assignment into `AWAITING_CHIEF_REVIEW` without transferring ownership)
- `POST /api/v1/faults/{id}/assignments/{assignment_id}/review` (section Chief Technician approves/returns an escalation or approves/returns technical completion; escalation approval creates the next linked section assignment)
- `POST /api/v1/faults/{id}/action?action=acknowledge|on_site|diagnose|restore`; `restore` requests technical completion and waits for Chief approval; `close` is rejected because Operations must separately confirm restoration
- `POST /api/v1/faults/{id}/operator-updates` (Operations adds progress information for responding sections)
- `POST /api/v1/faults/{id}/operator-confirmation` (`confirmed: true` closes a restored fault; `confirmed: false` requires comments and reopens work with the restoring section)
- `POST /api/v1/faults/{id}/attachments` and `GET /api/v1/faults/{id}/attachments/{attachment_id}` (authorized local evidence; PNG/JPEG/WebP/PDF/CSV/TXT/JSON/LOG, 10 MiB per file)
- `POST /api/v1/faults/{id}/diagnoses` (technical roles; supports multiple possible causes and attributes each diagnosis to the active section assignment)
- Diagnosis fields include `quick_check`, `fix_summary`, `workaround` and `risk_level`; high-risk fixes require supervisor approval
- `POST /api/v1/faults/{id}/interventions` (technical roles; outcomes: `SUCCESS`, `FAILED`, `IN_PROGRESS`; linked to the active section assignment)
- `POST /api/v1/faults/{id}/procedure-updates` (after a recorded successful intervention and technical completion)
- `POST /api/v1/procedure-updates/{id}/revisions` (contributing author; creates a new version)
- `POST /api/v1/faults/{id}/procedure-reuse` (records use of an approved procedure)
- `POST /api/v1/procedure-reuse/{id}/outcome` (contributing user confirms `SUCCESS` or `FAILED` after restoration)

Knowledge and intelligence:
- `GET/POST /api/v1/knowledge`
- `GET /api/v1/knowledge?source_type=LEGACY_PROCEDURE|FAULT_DERIVED`
- `POST /api/v1/knowledge/{id}/status`
- `GET /api/v1/procedure-updates/review-queue` (section Chief Technician/Chief Engineer or Supervisor)
- `POST /api/v1/procedure-updates/{id}/review` (technical approval/clarification, then supervisor publication)
- `GET /api/v1/procedure-updates/library` (approved latest versions only)
- `GET /api/v1/intelligence/equipment/{id}`
- `GET /api/v1/recognition/leaderboard` (SOCA-compatible local recognition model)
- `GET /api/v1/integrations/sap/status` (read-only integration is deferred; write-back is disabled)
- `GET /api/v1/analytics/overview`

The HR appraisal endpoint returns attributed work evidence and time measures without equipment identifiers or individual fault narratives. Report volume is contextual only. The prototype recognition weighting is illustrative and not an approved appraisal policy.

The Chief Technician APIs are section-scoped. Only a Chief Technician can allocate/reassign or review work for their section; allocation accepts only active, available ST/PT accounts from that section. Technical completion approval requires a successful intervention on the active assignment. Operations confirmation remains a separate action and is required to close the fault.

GM O&M analytics include stage counts, section handoffs, wrong-first-assignment counts, timing baselines, repeat-fault context and knowledge reuse. The CEO response remains executive-summary-only. Synthetic data and timestamps are not operational performance claims.

Evidence files are stored locally under `backend/storage/attachments/` in this prototype and are excluded from Git. A deployment must provide persistent, access-controlled storage before relying on uploaded evidence. SAP integration remains deferred until the operational workflow is complete.

Synchronisation:
- `POST /api/v1/sync/events`
- `GET /api/v1/sync/status`
