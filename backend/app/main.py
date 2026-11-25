"""FastAPI application assembly.

Schema changes are managed by Alembic (`python -m app.cli migrate`) and demo
data by `python -m app.cli seed`; importing this module has no side effects on
the database.
"""
from __future__ import annotations

import logging

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import text

from app.core.config import settings
from app.db import engine
from app.routers import (
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
    sync,
    team,
)

logger = logging.getLogger("kpc")

app = FastAPI(title="KPC Maintenance Prototype", version="0.2.0")
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
    auth, accounts, people, team, equipment, faults, investigation, jobs, procedures,
    assignments, attachments, knowledge, intelligence, analytics, insights, integrations, sync,
):
    app.include_router(module.router)
