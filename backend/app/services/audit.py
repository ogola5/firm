from __future__ import annotations

from datetime import datetime
from sqlalchemy.orm import Session
import json
import uuid

from app.models import FaultEvent, User, UserAudit, utcnow

def add_event(db: Session, fault_id: str, event_type: str, actor_id: str, payload: dict, created_at: datetime | None = None):
    db.add(FaultEvent(
        id=str(uuid.uuid4()),
        fault_id=fault_id,
        event_type=event_type,
        actor_id=actor_id,
        payload=json.dumps(payload),
        created_at=created_at or utcnow(),
    ))


def audit_user_change(db: Session, actor_id: str, action: str, target: User, details: dict) -> None:
    db.add(UserAudit(
        id=str(uuid.uuid4()),
        actor_id=actor_id,
        action=action,
        target_user_id=target.id,
        details=json.dumps(details),
    ))
