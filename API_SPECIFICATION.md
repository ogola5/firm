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

Visibility is enforced by the API: section technical roles are filtered to their assigned section, HR cannot access raw fault/equipment records, and the Managing Director/CEO receives summary analytics only. HR contribution evidence contains no individual fault narratives. See [ROLE_ACCESS_MATRIX.md](ROLE_ACCESS_MATRIX.md).

Equipment:
- `GET /api/v1/equipment`
- `GET /api/v1/equipment/{id}`
- `GET /api/v1/equipment/{id}/history`

Faults:
- `POST /api/v1/faults`
- `GET /api/v1/faults`
- `GET /api/v1/faults/{id}`
- `GET /api/v1/faults/{id}/timeline`
- `GET /api/v1/faults/{id}/context` (equipment history, diagnoses, interventions, approved procedures, review timeline and reuse records)
- `POST /api/v1/faults/{id}/triage`
- `POST /api/v1/faults/{id}/action?action=acknowledge|on_site|diagnose|restore|close`
- `POST /api/v1/faults/{id}/diagnoses` (technical roles; supports multiple possible causes)
- Diagnosis fields include `quick_check`, `fix_summary`, `workaround` and `risk_level`; high-risk fixes require supervisor approval
- `POST /api/v1/faults/{id}/interventions` (technical roles; outcomes: `SUCCESS`, `FAILED`, `IN_PROGRESS`)
- `POST /api/v1/faults/{id}/procedure-updates` (after restoration and a recorded successful intervention)
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

GM O&M analytics include stage counts, section handoffs, wrong-first-assignment counts, timing baselines, repeat-direct routing and knowledge reuse. The CEO response remains executive-summary-only. Synthetic data and timestamps are not operational performance claims.

Synchronisation:
- `POST /api/v1/sync/events`
- `GET /api/v1/sync/status`
