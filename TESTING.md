# Testing

Run backend tests:

```bash
cd backend
.venv/bin/pytest -q
```

Build the frontend:

```bash
cd frontend
npm install
npm run build
```

Current automated coverage verifies seed counts, authentication, role permissions, reporting, triage, acknowledgement, analytics and idempotent synchronisation.
