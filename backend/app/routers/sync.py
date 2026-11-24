from __future__ import annotations

from fastapi import Depends
from fastapi import HTTPException
from sqlalchemy.orm import Session
import uuid
from fastapi import APIRouter

from app.db import db_dep
from app.deps import current_user
from app.models import SyncEvent, User, utcnow
from app.services.access import require_roles

router = APIRouter()

@router.post("/api/v1/sync/events")
def sync_events(events: list[dict], user: User = Depends(current_user), db: Session = Depends(db_dep)):
    require_roles(user, "operations", "systems_automation", "technician_st", "technician_pt", "technician_ct", "assistant_engineer", "engineer", "senior_engineer", "chief_engineer", "maintenance_manager", "general_manager_om", "supervisor", "system_administrator")
    accepted = []
    duplicates = []
    for event in events:
        event_id = str(event.get("event_id", uuid.uuid4()))
        if event.get("actor_id") and event["actor_id"] != user.id:
            raise HTTPException(status_code=403, detail="Offline events must belong to the authenticated user")
        if db.get(SyncEvent, event_id):
            duplicates.append(event_id)
            continue
        db.add(SyncEvent(
            event_id=event_id,
            fault_id=event.get("fault_id"),
            event_type=str(event.get("event_type", "UNKNOWN")),
            actor_id=user.id,
            payload=str(event.get("payload", {})),
            client_timestamp=str(event.get("client_timestamp", utcnow().isoformat())),
        ))
        accepted.append(event_id)
    db.commit()
    return {"accepted": accepted, "duplicates": duplicates}


@router.get("/api/v1/sync/status")
def sync_status(user: User = Depends(current_user), db: Session = Depends(db_dep)):
    require_roles(user, "operations", "systems_automation", "technician_st", "technician_pt", "technician_ct", "assistant_engineer", "engineer", "senior_engineer", "chief_engineer", "maintenance_manager", "general_manager_om", "supervisor", "system_administrator")
    count = db.query(SyncEvent).count()
    return {"received_events": count, "authoritative": True, "conflicts": 0}
