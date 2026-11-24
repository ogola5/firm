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

The HTML report is written to `frontend/playwright-report/`.

## Coverage

- **API (pytest):** seed counts, authentication, role and section scope, fault reporting and unconfirmed assets, triage, Chief Technician allocation and review, section handoffs, evidence upload limits, operator confirmation, investigation-to-procedure review and reuse, HR/CEO visibility boundaries, analytics, repeat-fault ranking. Offline sync (`tests/test_sync.py`): ordered application of an offline lifecycle, exactly-once on resend, device timestamps on the timeline, concurrent-edit conflicts held and reconciled (apply/discard), and permission bypass attempts rejected.
- **Frontend unit (Vitest):** outbox sequencing and optimistic updates, server acknowledgement mapping, backoff with jitter, retry on unreachable server or dropped connection, auth-expiry handling, malformed-event isolation, offline sign-in verifier and expiry, network simulator.
- **End-to-end (Playwright):** Scenario 4, offline maintenance. An offline report survives closing the app and an offline sign-in, then syncs once. An offline acknowledgement, diagnosis and failed plus successful interventions survive a reload and reach the server exactly once, with device timestamps.
