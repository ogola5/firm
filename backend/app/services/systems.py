"""Systems: equipment that works together, and the page for each one (proposal module 12, legacy systems).

A system page brings together what people know about the whole: what it is, how the parts
connect, known limitations, the history of changes over the years, its drawings and drawing
differences, expert notes, procedures and recent faults on every part of it.
"""
from __future__ import annotations

import uuid
from datetime import date, datetime, timedelta

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import (
    Diagnosis, DrawingDifference, Equipment, ExpertSession, Fault, Intervention, System, SystemChange, User, utc_datetime, utcnow,
)
from app.services.access import role_key
from app.services.catalogue import type_name, type_of

EDITORS = ("technician_ct", "assistant_engineer", "engineer", "senior_engineer", "chief_engineer", "maintenance_manager",
           "system_administrator")
RECORDERS = ("systems_automation", "technician_st", "technician_pt", *EDITORS)


def _iso(value) -> str | None:
    if value is None:
        return None
    return value.isoformat() if isinstance(value, date) and not isinstance(value, datetime) else utc_datetime(value).isoformat()


def summary(db: Session, equipment: Equipment | None) -> dict | None:
    system = db.get(System, equipment.system_id) if equipment and equipment.system_id else None
    if not system:
        return None
    return {"id": system.id, "name": system.name, "legacy": bool(system.legacy), "station": system.station}


def _case(db: Session, fault: Fault) -> dict:
    causes = [item.possible_cause for item in db.scalars(select(Diagnosis).where(Diagnosis.fault_id == fault.id))]
    attempts = db.scalars(select(Intervention).where(Intervention.fault_id == fault.id).order_by(Intervention.created_at)).all()
    return {
        "id": fault.id, "reference": fault.reference, "equipment_tag": fault.equipment.tag if fault.equipment else "",
        "equipment_name": fault.equipment.name if fault.equipment else "", "symptom": fault.symptom,
        "reported_at": _iso(fault.created_at), "status": fault.status, "cause": causes[0] if causes else "",
        "worked": next((item.corrective_action for item in attempts if item.outcome == "SUCCESS"), ""),
        "did_not_work": [item.corrective_action for item in attempts if item.outcome == "FAILED"][:2],
    }


def related_faults(db: Session, fault: Fault, days: int = 365, limit: int = 5) -> list[dict]:
    """Recent faults on the other equipment in the same system (a pump that won't start: what has its drive been doing?)."""
    equipment = fault.equipment if fault.equipment_confirmed else None
    if not equipment or not equipment.system_id:
        return []
    others = [item.id for item in db.scalars(select(Equipment).where(Equipment.system_id == equipment.system_id,
                                                                     Equipment.id != equipment.id))]
    if not others:
        return []
    since = utcnow() - timedelta(days=days)
    rows = db.scalars(select(Fault).where(Fault.equipment_id.in_(others), Fault.equipment_confirmed == 1, Fault.id != fault.id,
                                          Fault.created_at >= since).order_by(Fault.created_at.desc()).limit(limit)).all()
    return [_case(db, item) for item in rows]


def system_list(db: Session) -> list[dict]:
    rows = []
    for system in db.scalars(select(System).order_by(System.legacy.desc(), System.name)):
        equipment = db.scalars(select(Equipment).where(Equipment.system_id == system.id)).all()
        ids = [item.id for item in equipment]
        faults = db.query(Fault).filter(Fault.equipment_id.in_(ids), Fault.created_at >= utcnow() - timedelta(days=365)).count() if ids else 0
        rows.append({"id": system.id, "name": system.name, "station": system.station, "legacy": bool(system.legacy),
                     "equipment_count": len(equipment), "faults_last_year": faults,
                     "changes": db.query(SystemChange).filter(SystemChange.system_id == system.id).count(),
                     "types": sorted({type_of(item.tag) for item in equipment})})
    return rows


def system_page(db: Session, user: User, system_id: str) -> dict:
    system = db.get(System, system_id)
    if not system:
        raise HTTPException(status_code=404, detail="System not found")
    equipment = db.scalars(select(Equipment).where(Equipment.system_id == system.id).order_by(Equipment.tag)).all()
    ids = [item.id for item in equipment]
    types = sorted({type_of(item.tag) for item in equipment})
    faults = db.scalars(select(Fault).where(Fault.equipment_id.in_(ids), Fault.equipment_confirmed == 1)
                        .order_by(Fault.created_at.desc()).limit(8)).all() if ids else []
    changes = db.scalars(select(SystemChange).where(SystemChange.system_id == system.id)
                         .order_by(SystemChange.changed_on.desc(), SystemChange.created_at.desc())).all()
    differences = db.scalars(select(DrawingDifference).where(DrawingDifference.equipment_id.in_(ids),
                                                             DrawingDifference.status.in_(("VERIFIED", "REPORTED")))).all() if ids else []
    experts = db.scalars(select(ExpertSession).where(ExpertSession.status == "APPROVED", ExpertSession.equipment_type.in_(types))).all()
    updater = db.get(User, system.updated_by_id) if system.updated_by_id else None
    key = role_key(user)
    return {
        "id": system.id, "name": system.name, "station": system.station, "legacy": bool(system.legacy),
        "description": system.description, "how_it_connects": system.how_it_connects, "known_limitations": system.known_limitations,
        "updated_by": updater.display_name if updater else "", "updated_at": _iso(system.updated_at),
        "can_edit": key in EDITORS, "can_record_change": key in RECORDERS,
        "equipment": [{"id": item.id, "tag": item.tag, "name": item.name, "type_code": type_of(item.tag), "type_name": type_name(type_of(item.tag)),
                       "section": item.section, "region": item.region, "location": item.location} for item in equipment],
        "changes": [{"id": item.id, "changed_on": _iso(item.changed_on), "what_changed": item.what_changed,
                     "recorded_by": (db.get(User, item.recorded_by_id).display_name if db.get(User, item.recorded_by_id) else "")}
                    for item in changes],
        "drawing_differences": [{"id": item.id, "equipment_tag": db.get(Equipment, item.equipment_id).tag, "description": item.description,
                                 "drawing": item.drawing_number_text, "status": item.status} for item in differences],
        "expert_notes": [{"id": item.id, "title": item.title, "equipment_type": item.equipment_type,
                          "expert": (db.get(User, item.expert_id).display_name if db.get(User, item.expert_id) else ""),
                          "what_fools_people": item.what_fools_people} for item in experts],
        "recent_faults": [_case(db, item) for item in faults],
    }


def update_system(db: Session, user: User, system_id: str, fields: dict) -> dict:
    if role_key(user) not in EDITORS:
        raise HTTPException(status_code=403, detail="Chief Technicians and engineers keep system pages up to date")
    system = db.get(System, system_id)
    if not system:
        raise HTTPException(status_code=404, detail="System not found")
    for key in ("description", "how_it_connects", "known_limitations"):
        if fields.get(key) is not None:
            setattr(system, key, str(fields[key]).strip()[:4000])
    system.updated_by_id, system.updated_at = user.id, utcnow()
    db.commit()
    return system_page(db, user, system_id)


def record_change(db: Session, user: User, system_id: str, what_changed: str, changed_on: date | None) -> dict:
    if role_key(user) not in RECORDERS:
        raise HTTPException(status_code=403, detail="Only maintenance staff record changes to a system")
    system = db.get(System, system_id)
    if not system:
        raise HTTPException(status_code=404, detail="System not found")
    text = what_changed.strip()
    if len(text) < 10:
        raise HTTPException(status_code=422, detail="Describe what was changed")
    if changed_on and changed_on > utcnow().date():
        raise HTTPException(status_code=422, detail="The date cannot be in the future")
    db.add(SystemChange(id=str(uuid.uuid4()), system_id=system.id, changed_on=changed_on, what_changed=text[:2000],
                        recorded_by_id=user.id, created_at=utcnow()))
    db.commit()
    return system_page(db, user, system_id)
