"""FastAPI application assembly.

Schema changes are managed by Alembic (`python -m app.cli migrate`) and demo
data by `python -m app.cli seed`; importing this module has no side effects on
the database.
"""
from __future__ import annotations

import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import text

from app.core.config import settings
from app.db import engine
from app.routers import (
    admin,
    knowledge_library,
    notifications,
    accounts,
    analytics,
    assignments,
    attachments,
    auth,
    equipment,
    faults,
    insights,
    integrations,
    intelligence,
    investigation,
    jobs,
    knowledge,
    people,
    procedures,
    recognition,
    library,
    expertise,
    reports,
    sync,
    team,
)

logger = logging.getLogger("kpc")
REPORT_CHECK_SECONDS = 600


def _send_due_reports() -> int:
    from app.db import SessionLocal
    from app.services import escalation, points
    from app.services.reports import send_due

    from app.services.system_settings import apply_saved

    with SessionLocal() as db:
        apply_saved(db)  # rules changed in the admin console
        escalation.run(db)  # not back in service after the set hours -> SE; came back soon after a fix -> CE
        points.sync(db)  # credit newly verified contributions
        return send_due(db)


async def _report_scheduler() -> None:
    """Every 10 minutes: escalation checks, points, and any weekly/monthly/financial-year report that is due."""
    from app.services.system_status import scheduler_ran

    while True:
        try:
            sent = await asyncio.to_thread(_send_due_reports)
            scheduler_ran()
            if sent:
                logger.info("Scheduled reports sent: %s", sent)
        except Exception as exc:  # keep the API running; try again next time
            scheduler_ran(type(exc).__name__)
            logger.exception("Scheduled report run failed")
        await asyncio.sleep(REPORT_CHECK_SECONDS)


READ_ONLY_METHODS = ("GET", "HEAD", "OPTIONS")


async def view_as_is_read_only(request: Request, call_next):
    """A "view as" session (the developer looking at someone else's screens) can look, never change anything."""
    if request.method not in READ_ONLY_METHODS:
        authorization = request.headers.get("authorization", "")
        if authorization.startswith("Bearer "):
            from jose import JWTError, jwt
            try:
                claims = jwt.decode(authorization[7:], settings.jwt_secret, algorithms=["HS256"])
            except JWTError:
                claims = {}
            if claims.get("view_as"):
                return JSONResponse(status_code=403, content={
                    "detail": "You are viewing as someone else (read-only). Go back to your own account to make changes."})
    return await call_next(request)


@asynccontextmanager
async def lifespan(_: FastAPI):
    try:
        from app.db import SessionLocal
        from app.services.system_settings import apply_saved
        with SessionLocal() as db:
            apply_saved(db)
    except Exception:  # the table may not exist before the first migration
        logger.warning("Saved settings not loaded at start-up")
    task = asyncio.create_task(_report_scheduler()) if settings.report_scheduler else None
    yield
    if task:
        task.cancel()


app = FastAPI(title="KPC Maintenance Prototype", version="0.2.0", lifespan=lifespan)
app.middleware("http")(view_as_is_read_only)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.exception_handler(Exception)
async def unhandled_error(request: Request, exc: Exception) -> JSONResponse:
    # Never leak stack traces or SQL to clients; keep the detail in server logs.
    logger.exception("Unhandled error on %s %s", request.method, request.url.path)
    return JSONResponse(status_code=500, content={"detail": "Internal server error"})


@app.get("/api/v1/health")
def health() -> dict:
    with engine.connect() as connection:
        connection.execute(text("SELECT 1"))
    return {"status": "ok", "database": engine.dialect.name}


for module in (
    auth, admin, accounts, people, team, reports, recognition, library, knowledge_library, notifications, expertise, equipment, faults, investigation, jobs, procedures,
    assignments, attachments, knowledge, intelligence, analytics, insights, integrations, sync,
):
    app.include_router(module.router)
