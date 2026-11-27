"""What the health page reports: recent errors, the background timer, storage, versions and queues."""
from __future__ import annotations

import logging
import os
import time
from collections import deque
from datetime import datetime, timezone
from pathlib import Path

from sqlalchemy import func, select, text
from sqlalchemy.orm import Session

from app.core.config import settings

APP_VERSION = "0.2.0"
STARTED_AT = datetime.now(timezone.utc)

# The background timer (escalation checks, points, scheduled reports): when it last ran and how it went.
scheduler = {"last_run": None, "last_error": "", "runs": 0}


class _RecentErrors(logging.Handler):
    """Keeps the last few errors in memory (message only: no stack traces or data leave the server)."""

    def __init__(self, size: int = 25):
        super().__init__(level=logging.ERROR)
        self.items: deque[dict] = deque(maxlen=size)

    def emit(self, record: logging.LogRecord) -> None:
        self.items.appendleft({
            "at": datetime.fromtimestamp(record.created, timezone.utc).isoformat(),
            "where": record.name,
            "message": record.getMessage()[:300],
            "kind": record.exc_info[0].__name__ if record.exc_info and record.exc_info[0] else "",
        })


recent_errors = _RecentErrors()
logging.getLogger().addHandler(recent_errors)


def scheduler_ran(error: str = "") -> None:
    scheduler["last_run"] = datetime.now(timezone.utc).isoformat()
    scheduler["last_error"] = error
    scheduler["runs"] += 1


def _migration(db: Session) -> dict:
    try:
        current = db.execute(text("SELECT version_num FROM alembic_version")).scalar()
    except Exception:  # tests create tables directly, without Alembic
        db.rollback()
        current = None
    try:
        from alembic.script import ScriptDirectory
        from app.cli import alembic_config
        head = ScriptDirectory.from_config(alembic_config()).get_current_head()
    except Exception:
        head = None
    return {"current": current, "latest": head, "up_to_date": current is not None and current == head}


def _storage() -> dict:
    root = Path(settings.attachment_storage_dir)
    files = [path for path in root.rglob("*") if path.is_file()] if root.exists() else []
    on_render = bool(os.environ.get("RENDER"))
    return {
        "path": str(root),
        "files": len(files),
        "bytes": sum(path.stat().st_size for path in files),
        "persistent": not on_render,
        "warning": "Render deletes uploaded files whenever the service restarts or redeploys. Evidence needs a "
                   "persistent disk or object storage before real use." if on_render else "",
    }


def health(db: Session) -> dict:
    from app.models import Fault, MailOutbox, SyncEvent, User

    started = time.perf_counter()
    db.execute(text("SELECT 1"))
    latency = round((time.perf_counter() - started) * 1000, 1)
    open_faults = db.scalar(select(func.count()).select_from(Fault).where(Fault.status.notin_(("RESTORED", "CLOSED")))) or 0
    conflicts = db.scalar(select(func.count()).select_from(SyncEvent).where(SyncEvent.status == "CONFLICT")) or 0
    return {
        "version": {
            "app": APP_VERSION,
            "commit": (os.environ.get("RENDER_GIT_COMMIT") or os.environ.get("GIT_COMMIT") or "")[:7] or "local build",
            "started_at": STARTED_AT.isoformat(),
            "host": "Render" if os.environ.get("RENDER") else "this computer",
        },
        "database": {"ok": True, "kind": db.get_bind().dialect.name, "latency_ms": latency, "migration": _migration(db)},
        "scheduler": {"enabled": settings.report_scheduler, **scheduler},
        "mail": {"demo_mailbox": settings.demo_mailbox, "messages": db.scalar(select(func.count()).select_from(MailOutbox)) or 0},
        "sync": {"conflicts_waiting": conflicts},
        "storage": _storage(),
        "counts": {
            "people_active": db.scalar(select(func.count()).select_from(User).where(User.active == 1)) or 0,
            "faults_open": open_faults,
        },
        "errors": list(recent_errors.items),
    }
