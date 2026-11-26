from __future__ import annotations

import json
import uuid
from contextlib import contextmanager
from contextvars import ContextVar
from datetime import datetime
from collections.abc import Iterator

from sqlalchemy.orm import Session

from app.models import FaultEvent, User, UserAudit, utcnow

# Set while an offline event is being applied, so every timeline entry it
# produces records the device, the device clock and the sync event id.
_offline_origin: ContextVar[dict | None] = ContextVar("offline_origin", default=None)


@contextmanager
def offline_origin(origin: dict) -> Iterator[None]:
    token = _offline_origin.set(origin)
    try:
        yield
    finally:
        _offline_origin.reset(token)


def add_event(db: Session, fault_id: str, event_type: str, actor_id: str, payload: dict, created_at: datetime | None = None):
    origin = _offline_origin.get()
    if origin:
        payload = {**payload, "offline": origin}
    db.add(FaultEvent(
        id=str(uuid.uuid4()),
        fault_id=fault_id,
        event_type=event_type,
        actor_id=actor_id,
        payload=json.dumps(payload, default=str),
        created_at=created_at or utcnow(),
    ))
    # Who should hear about it is decided just before the save commits (services/notifications.py).
    from app.services.notifications import queue_event
    queue_event(db, fault_id, event_type, actor_id, payload)


def audit_user_change(db: Session, actor_id: str, action: str, target: User, details: dict) -> None:
    db.add(UserAudit(
        id=str(uuid.uuid4()),
        actor_id=actor_id,
        action=action,
        target_user_id=target.id,
        details=json.dumps(details),
    ))
