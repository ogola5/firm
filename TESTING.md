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

## Frontend

```bash
cd frontend
npm install
npm run build
npm test
```

## Coverage

The API suite covers seed counts, authentication, role and section scope, fault reporting and unconfirmed assets, triage, Chief Technician allocation and review, section handoffs, evidence upload limits, operator confirmation, investigation-to-procedure review and reuse, HR/CEO visibility boundaries, analytics, repeat-fault ranking and idempotent synchronisation.
