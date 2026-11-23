# KPC Digital Fault Tracking and Maintenance Knowledge System

This repository contains a synthetic, offline-capable prototype for digitally tracking maintenance faults and preserving reusable maintenance knowledge. It is not connected to real KPC systems, SAP, SCADA, PLCs, RTUs or operational infrastructure.

## Stack

- FastAPI, SQLAlchemy and SQLite for the local prototype
- React, TypeScript and Vite
- Dexie.js and a service worker for offline caching
- Docker Compose for a reproducible development stack

## Quick start

```bash
docker compose up --build
```

The frontend runs on port `5173` and the API on port `8000`. API documentation is available at `http://localhost:8000/docs`.

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
uvicorn app.main:app --reload --port 8000
```

Synthetic demo credentials are documented in [DEMO_GUIDE.md](DEMO_GUIDE.md).
