# Testing

## Backend

Fast run on a throwaway SQLite database (schema built by the Alembic migrations, then seeded):

```bash
cd backend
.venv/bin/pytest -q
```

Run the same suite on PostgreSQL (the target database). The named database is reset at the start of the run:

```bash
docker compose up -d db
docker compose exec db psql -U kpc -d kpc -c 'CREATE DATABASE kpc_test'   # once
KPC_TEST_DATABASE_URL=postgresql+psycopg://kpc:kpc-demo@localhost:5433/kpc_test .venv/bin/pytest -q
```

Static check:

```bash
.venv/bin/python -m pyflakes app tests
```

## Frontend unit tests

```bash
cd frontend
npm install
npm test          # Vitest, IndexedDB via fake-indexeddb
npm run build     # type-check and production build
```

## End-to-end (Playwright)

Runs Chromium on the host against the Compose stack. One-time setup on Ubuntu/WSL:

```bash
sudo apt-get install -y libnss3 libnspr4 libasound2t64
cd frontend && npx playwright install chromium
```

```bash
scripts/e2e.sh            # build/start the stack, run all scenarios
scripts/e2e.sh --reset    # reset demo data first
scripts/e2e.sh -g offline # pass Playwright arguments
scripts/e2e.sh --docker   # use the official Playwright image instead (about 2 GB download)
```

The HTML report is written to `frontend/playwright-report/`. The suite runs against the production build in the frontend container, so service-worker behaviour is real.

## Performance

```bash
PERF=1 scripts/e2e.sh performance                  # browser: load, cached launch, local search/history/persistence
cd backend && .venv/bin/python scripts/perf_api.py # API timings, sync throughput, PostgreSQL query plans
```

Results are written to `frontend/perf-results/` and `backend/perf-results/` and summarised in [PERFORMANCE_REPORT.md](PERFORMANCE_REPORT.md).

## Coverage

- **API (pytest):** seed counts, authentication, role and section scope, fault reporting and unconfirmed assets, triage, Chief Technician allocation and review, section handoffs, evidence upload limits, operator confirmation, investigation-to-procedure review and reuse, HR/CEO visibility boundaries, analytics, repeat-fault ranking. Offline sync (`tests/test_sync.py`): ordered application of an offline lifecycle, exactly-once on resend, device timestamps on the timeline, concurrent-edit conflicts held and reconciled (apply/discard), and permission bypass attempts rejected.
- **Frontend unit (Vitest):** outbox sequencing and optimistic updates, server acknowledgement mapping, backoff with jitter, retry on unreachable server or dropped connection, auth-expiry handling, malformed-event isolation, offline sign-in verifier and expiry, network simulator.
- **End-to-end (Playwright)**, the six scenarios from the build brief:
  - *1 First-time fault* (`fault-lifecycle.spec.ts`), through the desk workflow: Operations reports from the control room in four answers; Systems Automation hands off; both chiefs approve and allocate; the technician takes the job in My jobs, prints the job card and writes up the visit with real times (a failed and a successful step); the chief signs off; Operations confirms; the procedure drafted from the write-up is checked, reviewed, published and found in the library.
  - *Desk workflow API* (`tests/test_desk_workflow.py`): descriptive equipment search, report observation time, visit times validated and carried to the timeline and restoration, implicit take-on-arrival, My jobs grouping, offline visit sync.
  - *2 Recurring fault*: the same problem shows "SEEN BEFORE", earlier attempts, ranked causes and the approved procedure, which is reused; the recurrence count comes from the database.
  - *3 Failed intervention*: the failed and successful attempts both stay in the log and are shown to the supervisor before publication.
  - *4 Offline maintenance* (`offline-maintenance.spec.ts`): offline reporting survives restart and offline sign-in and syncs once; an offline investigation syncs exactly once with device timestamps; the installed app cold-starts with no network.
  - *5 Concurrent edits* (`concurrent-edits.spec.ts`): a stale offline action is held as a conflict, nothing is overwritten, applying is refused, and discarding needs and records a reason.
  - *6 Knowledge governance* (`knowledge-governance.spec.ts`): clarification requested, revision v2, technical approval, publication, then v3, with earlier versions kept.
