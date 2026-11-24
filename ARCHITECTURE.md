# Architecture

The prototype is a modular monolith. The FastAPI backend owns domain rules and persistence; the React frontend provides role-specific workflows; PostgreSQL is the system of record; IndexedDB and a service worker provide offline operation on the client.

## Backend layout (`backend/app`)

| Module | Responsibility |
|---|---|
| `main.py` | Application assembly only: CORS, error handler, health check, router registration. Importing it has no database side effects. |
| `core/config.py` | Environment-based settings (`DATABASE_URL`, `JWT_SECRET`, attachment limits, CORS origins). |
| `db.py` | Engine, session factory, declarative `Base`, request-scoped session dependency. |
| `models.py` | SQLAlchemy ORM models. |
| `schemas.py` | Pydantic request schemas. |
| `deps.py` | Authentication dependency (`current_user`). |
| `services/access.py` | Role definitions, permission and section-scope checks. |
| `services/audit.py` | Append-only fault events and user-audit records. |
| `services/storage.py` | Attachment storage abstraction (local filesystem now; S3-compatible later). |
| `services/people.py`, `services/workflow_metrics.py`, `services/procedures.py` | Contribution evidence, handoff/timing metrics, procedure payloads. |
| `routers/*.py` | One router per API area: auth, people, team, equipment, faults, assignments, investigation, attachments, procedures, knowledge, intelligence, analytics, integrations, sync. |
| `seed.py` | Deterministic illustrative dataset. |
| `cli.py` | `migrate`, `seed`, `init` and `reset` commands. |

Schema changes are Alembic migrations in `backend/migrations/versions`. The container runs `python -m app.cli init` (migrate + seed if empty) before serving.

## Principles

- Important records are append-only: state changes are recorded as `fault_events`; failed interventions and earlier procedure versions are retained.
- Authorisation is enforced on the server for every endpoint; the frontend only hides what the server would refuse.
- Synchronisation uses client-generated event IDs as idempotency keys.
- Route handlers still contain much of the domain logic carried over from the original single-file prototype. Logic is being moved into `services/` as each area is reworked (offline event application is the next consumer that needs it).
