# Deploying the backend to Render

The API is a FastAPI app in `backend/`, built from `backend/Dockerfile`, with a PostgreSQL database. On every start it applies migrations and loads the illustrative demo data. The data is loaded only into an empty database, so restarts are safe.

## Option A: Blueprint (recommended)

1. In Render: **New → Blueprint**, connect GitHub and pick the repository `ogola5/firm`, branch `main`.
2. Render reads `render.yaml` and proposes:
   - **kpc-maintenance-db**: PostgreSQL (free plan, Frankfurt)
   - **kpc-maintenance-api**: web service (Docker, root directory `backend`)
3. Fill in the two values it asks for:
   - `CORS_ORIGINS`: the frontend's address, for example `https://kpc-maintenance-web.onrender.com`. If there is no frontend yet, use `http://localhost:5173`.
   - `APP_URL`: the same frontend address (used in email links).
4. Click **Apply**. The first deploy takes a few minutes.
5. Check `https://kpc-maintenance-api.onrender.com/api/v1/health`. It should return `{"status":"ok","database":"postgresql"}`. The interactive API documentation is at `/docs`.

## Option B: Manual setup

**1. Database:** New → PostgreSQL. Name `kpc-maintenance-db`, database `kpc`, user `kpc`, region Frankfurt. Copy its **Internal Database URL**.

**2. Web service:** New → Web Service, then connect the repository.

| Setting | Value |
| --- | --- |
| Branch | `main` |
| **Root Directory** | `backend` |
| Runtime / Language | **Docker** |
| Dockerfile Path | `./Dockerfile` (relative to the root directory) |
| Docker Build Context | `.` |
| Region | Frankfurt (same as the database) |
| Health Check Path | `/api/v1/health` |
| Start command | leave empty (the Dockerfile's command runs migrations, seeds, then serves on `$PORT`) |

Without Docker (Python runtime) the settings are:
- Root Directory `backend`
- Build `pip install -r requirements.txt`
- Start `python -m app.cli init && uvicorn app.main:app --host 0.0.0.0 --port $PORT`
- Environment variable `PYTHON_VERSION=3.12.8`

**3. Environment variables**

| Key | Value | Notes |
| --- | --- | --- |
| `DATABASE_URL` | the database's Internal Database URL | `postgres://…` and `postgresql://…` are converted automatically |
| `JWT_SECRET` | a long random value (*Generate*) | Signs sessions. Keep it secret. Changing it signs everyone out. |
| `CORS_ORIGINS` | `https://your-frontend.onrender.com` | Comma-separate several. No trailing slash needed. |
| `APP_URL` | `https://your-frontend.onrender.com` | Links in emails |
| `REPORTING_TIMEZONE` | `Africa/Nairobi` | |
| `ALLOWED_EMAIL_DOMAINS` | `["kpc.co.ke"]` | JSON list |
| `DEMO_MAILBOX` | `true` | Demonstration only. Anyone can read `/mailbox`. Set `false` and connect KPC's mail relay before real use. |
| `REPORT_SCHEDULER` | `true` | Sends weekly, monthly and financial-year reports to the demo mailbox |
| `JWT_LIFETIME_HOURS` | `12` | Optional |

You don't set `PORT`: Render provides it.

## Demo accounts after deploy

The demo accounts are `demo.<name>@kpc.co.ke` with password `demo123`, for example `demo.maintenance-manager@kpc.co.ke` or `demo.admin@kpc.co.ke` (see DEMO_GUIDE.md). The password is public, so treat the deployment as a demonstration only.

To reset the demo data, open the service's **Shell** in Render and run `python -m app.cli reset`.

## Things to know about Render's free plans

- **The web service sleeps** after 15 minutes without requests. The next request takes up to about a minute to wake it. Scheduled reports go out when it wakes, once each.
- **The free PostgreSQL database expires** after 30 days unless upgraded. Use a paid plan (e.g. Basic) for anything longer.
- **Uploaded evidence files** are stored on the service's disk, which is wiped on every deploy or restart. For real use, add a Render persistent disk (paid) and set `ATTACHMENT_STORAGE_DIR` to its mount path, or use object storage.

## The frontend (later)

The frontend currently calls the API on the same address (`/api/...`). To host it separately:
- Build it with `VITE_API_URL=https://kpc-maintenance-api.onrender.com`, for example as a Render Static Site with root `frontend`, build `npm ci && npm run build` and publish directory `dist`.
- Add a rewrite of `/*` to `/index.html`.
- Put its address in the API's `CORS_ORIGINS` and `APP_URL`.
