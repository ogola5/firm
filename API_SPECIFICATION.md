# API Specification

All application APIs use `/api/v1/`. Interactive OpenAPI documentation is available at `/docs`.

Authentication:
- `POST /api/v1/auth/login`
- `GET /api/v1/auth/me`

Equipment:
- `GET /api/v1/equipment`
- `GET /api/v1/equipment/{id}`
- `GET /api/v1/equipment/{id}/history`

Faults:
- `POST /api/v1/faults`
- `GET /api/v1/faults`
- `GET /api/v1/faults/{id}`
- `GET /api/v1/faults/{id}/timeline`
- `POST /api/v1/faults/{id}/triage`
- `POST /api/v1/faults/{id}/action?action=acknowledge|on_site|diagnose|restore|close`

Knowledge and intelligence:
- `GET/POST /api/v1/knowledge`
- `POST /api/v1/knowledge/{id}/status`
- `GET /api/v1/intelligence/equipment/{id}`
- `GET /api/v1/analytics/overview`

Synchronisation:
- `POST /api/v1/sync/events`
- `GET /api/v1/sync/status`
