# KPC Digital Fault Tracking and Maintenance Knowledge System

This repository contains a synthetic, offline-capable prototype for digitally tracking maintenance faults and preserving reusable maintenance knowledge. It is not connected to real KPC systems, SAP, SCADA, PLCs, RTUs or operational infrastructure.

## Stack

- FastAPI, SQLAlchemy 2, Alembic and PostgreSQL 16
- React, TypeScript and Vite
- Dexie.js and a service worker for offline caching
- Docker Compose for a reproducible development stack

See [ARCHITECTURE.md](ARCHITECTURE.md) for the code layout.

## Quick start

```bash
docker compose up --build
```

The frontend runs on port `5173` and the API on port `8000`. API documentation is available at `http://localhost:8000/docs`. PostgreSQL is published on host port `5433` (set `POSTGRES_HOST_PORT` to change it). The backend container applies migrations and loads the demo data on first start.

Reset the demonstration data at any time:

```bash
docker compose exec backend python -m app.cli reset
```

### Docker Desktop from Ubuntu on WSL

Use Docker Desktop on Windows with its WSL 2 engine and Ubuntu integration enabled. Do not install or start a separate Docker Engine inside Ubuntu.

In Docker Desktop, open **Settings → Resources → WSL Integration** and enable `Ubuntu-24.04` if the `docker` command is unavailable in a new Ubuntu terminal. Restart the distro with `wsl --shutdown`, reopen Ubuntu, then check:

```bash
docker version
docker compose version
docker compose config
```

The WSL Docker CLI and `/var/run/docker.sock` are provided by Docker Desktop. The project is stored in the Ubuntu filesystem, so run Compose from the repository directory in Ubuntu.

For local Python development:

```bash
cd backend
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
docker compose up -d db        # from the repository root
python -m app.cli init         # migrate + seed
uvicorn app.main:app --reload --port 8000
```

Set `DATABASE_URL` to use a different database (the default is the Compose PostgreSQL on `localhost:5433`).

Synthetic demo credentials are documented in [DEMO_GUIDE.md](DEMO_GUIDE.md).

Role scope and account-management rules are documented in [ROLE_ACCESS_MATRIX.md](ROLE_ACCESS_MATRIX.md).
