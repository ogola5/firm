# API Specification

All application APIs use `/api/v1/`. Interactive OpenAPI documentation is available at `/docs`.

Accounts and sign-in (company email; see [ACCOUNTS.md](ACCOUNTS.md)):
- `POST /api/v1/auth/login` `{email, password}`. The email must end `@kpc.co.ke` (422 otherwise). Responses:
  - 401: the same message for an unknown address or a wrong password.
  - 429: locked after 5 wrong passwords, for 15 minutes.
  - 403 `{detail: {message, account_status}}`: the password is right, but the account is `UNVERIFIED`, `PENDING_APPROVAL`, `REJECTED` or `DISABLED`.
- `GET /api/v1/auth/me`
- `GET /api/v1/auth/demo-accounts` (seeded synthetic accounts only)
- `GET /api/v1/enrolment/options` (public): roles a person may request, sections, password length, whether the demo mailbox is on
- `POST /api/v1/enrolment/start` (public) `{email, display_name, staff_number, job_title?, requested_role, requested_section?}`. Returns 202 with the same message whether or not the address already has an account.
- `POST /api/v1/enrolment/verify` (public) `{email, code, password}`. The account becomes `PENDING_APPROVAL`, and the administrators are notified.
- `GET /api/v1/enrolment/requests` (System Administrator): waiting and rejected requests, with duplicate staff-number warnings
- `POST /api/v1/enrolment/requests/{id}/approve` `{role?, section?}`: the administrator's role and section win over the request
- `POST /api/v1/enrolment/requests/{id}/reject` `{reason}`: the reason is shown to the person
- `POST /api/v1/auth/password-reset/start` (public) `{email}`. Always returns 202.
- `POST /api/v1/auth/password-reset/complete` (public) `{email, code, password}`
- `GET /api/v1/account`: My account (details, approval, last sign-in, what you can do and see)
- `POST /api/v1/account/password` `{current_password, new_password}`. Returns a fresh token; all other sessions end.
- `GET /api/v1/demo/mailbox?email=` (demonstration only; 404 when `DEMO_MAILBOX=false`)
- `GET /api/v1/access/roles` (System Administrator)

People and access:
- `GET /api/v1/users` (HR Officer and System Administrator)
- `GET /api/v1/users/summary` (HR, Maintenance Manager, General Manager O&M and System Administrator; counts only)
- `GET /api/v1/hr/appraisal?start_date=YYYY-MM-DD&end_date=YYYY-MM-DD` (HR-only attributed contribution evidence and timing measures; no fault narratives)
- `POST /api/v1/users` (System Administrator; `{email, display_name, staff_number?, job_title?, role, section, password}`, with the same email and password rules as enrolment)
- `PATCH /api/v1/users/{id}/status` (System Administrator)
- `PATCH /api/v1/users/{id}/access` `{role, section}` (System Administrator; not their own account): change a person's level and section. The person's current session ends at once, and they are emailed. The change is audited as `USER_ACCESS_CHANGED`.

The user payload (`/auth/login`, `/auth/me`) includes `access`: `{level, level_label, home, home_title, home_purpose, scope, menu[{key,label}], can[], version}`. It is built on the server from the account's approved role and section (see ACCOUNTS.md).
- `GET /api/v1/users/audit` (System Administrator)
- `GET /api/v1/chief/team` (Chief Technician; active status, availability, workload and competencies for the Chief's ST/PT pool)
- `PATCH /api/v1/me/availability` (Senior/Principal Technician; set `availability_status` to `AVAILABLE` or `UNAVAILABLE`)
- `PATCH /api/v1/chief/team/{user_id}/competencies` (Chief Technician; update competencies for an ST/PT in the same section)
- `GET /api/v1/chief/workspace` (Chief Technician; section-only active faults, review queue, escalations and team workload)

Visibility is enforced by the API: section technical roles are filtered to their assigned section, HR cannot access raw fault/equipment records, and the Managing Director/CEO receives summary analytics only. HR contribution evidence contains no individual fault narratives. See [ROLE_ACCESS_MATRIX.md](ROLE_ACCESS_MATRIX.md).

Equipment:
- `GET /api/v1/equipment?search=...` (matches tags and plain descriptions: "11-MOV-501", "mov 501", "tank 601 inlet valve", "T601 inlet"; best match first; section-scoped for technical roles)
- `GET /api/v1/equipment/{id}`
- `GET /api/v1/equipment/{id}/history`

Faults:
- `POST /api/v1/faults` accepts `seen_via` (`SCADA` or `SITE_WALK`) and `observed_at` (when it was seen; not in the future, not older than 7 days), plus an optional equipment candidate, `equipment_confirmed`, the reporter's original equipment wording, known location, observed symptom, operating conditions and operational impact. Evidence is uploaded through the attachment endpoint. Every report starts with a Systems Automation assignment; repeat-fault history is shown but never bypasses this first response.
- `GET /api/v1/me/jobs` (investigating roles: `to_write_up`, `assigned`, `available` (Systems Automation first response), `waiting` and `procedure_ready`)
- `POST /api/v1/faults/{id}/visits` (write up a site visit afterwards: `on_site_at`, optional `back_in_service_at`, `found`, ordered `attempts` of `{action, result: worked|failed|partly}`, `parts`, `notes`, `workaround`, `request_signoff`). Times are the technician's, checked against the report time and the clock; timeline entries carry them and keep `recorded_at`. Writing up an allocated job that was not taken counts as taking it at arrival. With `request_signoff` (needs a step that worked and the back-in-service time) the job goes to Chief Technician review; on approval the restoration time is the recorded back-in-service time. Also accepted offline as sync event `VISIT_RECORDED`.
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

### Analytics and intelligence

Every measure is defined in [METRICS.md](METRICS.md). Dates are local calendar days (Kenya time, `YYYY-MM-DD`); a period is at most three years. Every value is returned with `n`, the number of faults behind it.

| Endpoint | Who | Returns |
| --- | --- | --- |
| `GET /api/v1/analytics/measures` | analytics roles | Measure definitions, units, which direction is better, `min_n_to_compare` |
| `GET /api/v1/analytics/summary?start&end&section` | analytics roles | Headline measures for the period (default last 84 days), each with the previous period of the same length and a verdict: `better`, `worse`, `same`, `context` (volume), `too_few` (n < 5) or `no_data` |
| `GET /api/v1/analytics/trends?start&end&section&granularity=week\|month&measure=…` | analytics roles | `buckets` (`label`, `from`, `days`, `full_days`, `partial`) and `series[measure] = [{value, n}]`. Weeks start Monday. Partial buckets are cut short by the period edges. |
| `GET /api/v1/analytics/equipment-attention?start&end&section&limit` | org-wide, section leads | Equipment ranked by faults + repeats + 2 × came back after fix, with the reasons in words and the most common recorded cause |
| `GET /api/v1/analytics/sections?start&end` | org-wide, section leads (own section) | Per-section faults, first response, restore time, first-time fix, repeats, open now |
| `GET /api/v1/analytics/data-quality?start&end&section` | org-wide, section leads | Record completeness checks (unidentified equipment, no back-in-service time, late write-up, no cause, stale) |
| `GET /api/v1/intelligence/similar-faults?fault_id&limit` | technical roles, org-wide | Earlier faults most like this one: score 0–1, reasons, causes, what worked and what did not. Section roles only see their section's history (Systems Automation sees all). |

Analytics roles: org-wide (Maintenance Manager, GM O&M, Supervisor, System Administrator); section leads (Chief Technician, Chief Engineer), always limited to their own section whatever `section` is sent; and the Managing Director/CEO, who gets `summary` and `trends` only. Operations, HR and field technicians get 403. Similarity weights (`SIMILARITY_WEIGHTS`, default equipment 0.40, symptom 0.25, category 0.20, recency 0.15) and the reporting time zone (`REPORTING_TIMEZONE`) are configuration.

The HR appraisal endpoint returns attributed work evidence and time measures without equipment identifiers or individual fault narratives. Report volume is contextual only. The prototype recognition weighting is illustrative and not an approved appraisal policy.

The Chief Technician APIs are section-scoped. Only a Chief Technician can allocate/reassign or review work for their section; allocation accepts only active, available ST/PT accounts from that section. Technical completion approval requires a successful intervention on the active assignment. Operations confirmation remains a separate action and is required to close the fault.

GM O&M analytics include stage counts, section handoffs, wrong-first-assignment counts, timing baselines, repeat-fault context and knowledge reuse. The CEO response remains executive-summary-only. Synthetic data and timestamps are not operational performance claims.

Evidence files are stored locally under `backend/storage/attachments/` in this prototype and are excluded from Git. A deployment must provide persistent, access-controlled storage before relying on uploaded evidence. SAP integration remains deferred until the operational workflow is complete.

Synchronisation (see [OFFLINE_SYNC_DESIGN.md](OFFLINE_SYNC_DESIGN.md)):
- `POST /api/v1/sync/events`: apply queued offline events; per-event `APPLIED`, `DUPLICATE`, `CONFLICT` or `REJECTED`
- `GET /api/v1/sync/status`: counts by outcome, open conflicts visible to the caller, server time
- `GET /api/v1/sync/conflicts`: offline changes awaiting reconciliation
- `POST /api/v1/sync/conflicts/{event_id}/resolve`: `{"decision": "APPLY" | "DISCARD", "note": "..."}`
- `GET /api/v1/sync/history?limit=20`: upload batches with per-event outcomes

Operations:
- `GET /api/v1/health`: API and database reachability
