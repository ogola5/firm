from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.db import db_dep
from app.deps import current_user
from app.models import User
from app.schemas import ConflictResolution, SyncEventIn
from app.services import sync

router = APIRouter()


@router.post("/api/v1/sync/events")
def sync_events(events: list[SyncEventIn], user: User = Depends(current_user), db: Session = Depends(db_dep)):
    """Apply queued offline events; returns a per-event acknowledgement."""
    return sync.ingest(db, user, events)


@router.get("/api/v1/sync/status")
def sync_status(user: User = Depends(current_user), db: Session = Depends(db_dep)):
    return sync.status_summary(db, user)


@router.get("/api/v1/sync/conflicts")
def sync_conflicts(user: User = Depends(current_user), db: Session = Depends(db_dep)):
    return sync.list_conflicts(db, user)


@router.post("/api/v1/sync/conflicts/{event_id}/resolve")
def resolve_sync_conflict(
    event_id: str, req: ConflictResolution, user: User = Depends(current_user), db: Session = Depends(db_dep),
):
    return sync.resolve_conflict(db, user, event_id, req.decision, req.note)


@router.get("/api/v1/sync/history")
def sync_history(limit: int = 20, user: User = Depends(current_user), db: Session = Depends(db_dep)):
    return sync.history(db, user, limit)
