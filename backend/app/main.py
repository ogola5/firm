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
    knowledge_library,
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

    with SessionLocal() as db:
        escalation.run(db)  # 8 h not back in service -> SE; came back within 30 days -> CE
        points.sync(db)  # credit newly verified contributions
        return send_due(db)


async def _report_scheduler() -> None:
    """Every 10 minutes: email any weekly/monthly/financial-year report that is due (each person once)."""
    while True:
        try:
            sent = await asyncio.to_thread(_send_due_reports)
            if sent:
                logger.info("Scheduled reports sent: %s", sent)
        except Exception:  # keep the API running; try again next time
            logger.exception("Scheduled report run failed")
        await asyncio.sleep(REPORT_CHECK_SECONDS)


@asynccontextmanager
async def lifespan(_: FastAPI):
    task = asyncio.create_task(_report_scheduler()) if settings.report_scheduler else None
    yield
    if task:
        task.cancel()


app = FastAPI(title="KPC Maintenance Prototype", version="0.2.0", lifespan=lifespan)
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
    auth, accounts, people, team, reports, recognition, library, knowledge_library, expertise, equipment, faults, investigation, jobs, procedures,
    assignments, attachments, knowledge, intelligence, analytics, insights, integrations, sync,
):
    app.include_router(module.router)
