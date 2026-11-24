# Architecture

The prototype is a modular monolith. The FastAPI backend owns domain rules and persistence; the React frontend provides role-specific workflows; PostgreSQL is the system of record; IndexedDB and a service worker provide offline operation on the client.

In Docker Compose the frontend container serves the production build with `vite preview` (so the installed PWA works offline) and proxies `/api` to the backend container. For development, run `npm run dev` in `frontend/`.

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

## Frontend layout (`frontend/src`)

React 18 + TypeScript + Vite, with Tailwind CSS and shadcn/ui-style components, TanStack Query for server state, React Hook Form + Zod for forms, Recharts for charts, Dexie for IndexedDB and Workbox for the service worker.

| Path | Responsibility |
|---|---|
| `main.tsx` | Entry: QueryClient, router, styles. |
| `app/` | `App` (session), `Login`, `Shell` (navigation, connection/sync status, lazy routes), `pwa.ts` (service-worker registration). |
| `components/ui/` | shadcn/ui-convention primitives (Button, Card, Badge, Field/Input/Textarea/NativeSelect, Table, Alert, Page, Pagination). Source lives in the repo, as shadcn intends. |
| `components/charts/` | Recharts components (single-hue ranked bars with tooltip and table view). |
| `features/<area>/` | One folder per screen: dashboard, equipment, faults, knowledge, procedures, people. `faults/detail/` splits the breakdown view into panels sharing a `DetailContext`. |
| `offline/` | Network layer and simulator, API client, IndexedDB caches, outbox, sync engine, offline sign-in, Sync centre. |
| `lib/` | Query client and offline fallback, shared types, hooks, `cn()`. |
| `sw.ts` | Workbox service worker (precache, SPA navigation fallback, Background Sync wake-up; never caches `/api`). |

Data flow: screens read through TanStack Query. Queries that must work offline use `withOfflineFallback`, which returns the IndexedDB copy when the server cannot be reached and marks the result `fromCache` so the screen says so. Writes that are allowed offline fall back to the outbox (`offline/outbox.ts`). The browser always calls same-origin `/api`; Vite's dev and preview servers proxy it to the backend.

Routes are code-split (each screen is its own chunk), and the chart library only loads for management dashboards.

## Principles

- Important records are append-only: state changes are recorded as `fault_events`; failed interventions and earlier procedure versions are retained.
- Authorisation is enforced on the server for every endpoint; the frontend only hides what the server would refuse.
- Synchronisation uses client-generated event IDs as idempotency keys.
- Route handlers still contain much of the domain logic carried over from the original single-file prototype. Logic is being moved into `services/` as each area is reworked (offline event application is the next consumer that needs it).
