from __future__ import annotations

from fastapi import Depends
from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session
from fastapi import APIRouter

from app.db import db_dep
from app.deps import current_user
from app.models import Equipment, Fault, User
from app.services.access import region_filter, require_equipment_scope, require_roles, role_key
from app.services.equipment_search import rank_equipment

router = APIRouter()

@router.get("/api/v1/equipment")
def equipment_list(search: str = "", station: str = "", user: User = Depends(current_user), db: Session = Depends(db_dep)):
    require_roles(user, "operations", "systems_automation", "technician_st", "technician_pt", "technician_ct", "assistant_engineer", "engineer", "senior_engineer", "chief_engineer", "maintenance_manager", "general_manager_om", "supervisor", "system_administrator")
    query = select(Equipment).where(~Equipment.tag.like("UNCONFIRMED-%"))
    if station:
        query = query.where(Equipment.station == station)
    if role_key(user) in ("technician_st", "technician_pt", "technician_ct", "assistant_engineer", "engineer", "senior_engineer", "chief_engineer"):
        query = query.where(Equipment.section == user.section)
    in_region = region_filter(user)
    if in_region is not None:
        query = query.where(in_region)
    equipment = list(db.scalars(query.order_by(Equipment.tag)).all())
    if search.strip():
        equipment = rank_equipment(equipment, search)
    return [
        {
            "id": e.id, "tag": e.tag, "name": e.name, "aliases": e.aliases, "category": e.category,
            "station": e.station, "location": e.location, "section": e.section, "region": e.region,
            "system_id": e.system_id,
            "criticality": e.criticality, "operational_status": e.operational_status,
            "description": e.description,
        }
        for e in equipment[:100]
    ]


@router.get("/api/v1/equipment/{equipment_id}")
def equipment_detail(equipment_id: str, user: User = Depends(current_user), db: Session = Depends(db_dep)):
    item = db.get(Equipment, equipment_id)
    if not item:
        raise HTTPException(status_code=404, detail="Equipment not found")
    require_equipment_scope(user, item)
    return {"id": item.id, "tag": item.tag, "name": item.name, "category": item.category, "station": item.station, "location": item.location, "section": item.section, "criticality": item.criticality, "operational_status": item.operational_status, "manufacturer": item.manufacturer, "model": item.model, "description": item.description}


@router.get("/api/v1/equipment/{equipment_id}/history")
def equipment_history(equipment_id: str, user: User = Depends(current_user), db: Session = Depends(db_dep)):
    equipment = db.get(Equipment, equipment_id)
    if not equipment:
        raise HTTPException(status_code=404, detail="Equipment not found")
    require_equipment_scope(user, equipment)
    faults = db.scalars(select(Fault).where(Fault.equipment_id == equipment_id).order_by(Fault.created_at.desc())).all()
    return [{"id": f.id, "reference": f.reference, "symptom": f.symptom, "severity": f.severity, "status": f.status, "created_at": f.created_at.isoformat()} for f in faults]


@router.get("/api/v1/equipment/{equipment_id}/summary")
def equipment_summary(equipment_id: str, user: User = Depends(current_user), db: Session = Depends(db_dep)):
    """Everything about one piece of equipment on one page: open faults, past faults with what worked,
    its usual causes, likely-to-fail status, system, drawings and drawing differences."""
    from collections import Counter

    from app.models import Diagnosis, Intervention, utcnow
    from app.services import systems
    from app.services.analytics import watchlist
    from app.services.analytics.facts import load_facts
    from app.services.catalogue import CAUSE_CATEGORIES, type_name, type_of
    from app.services.drawings import differences_for_equipment, drawings_for_equipment

    item = db.get(Equipment, equipment_id)
    if not item:
        raise HTTPException(status_code=404, detail="Equipment not found")
    require_equipment_scope(user, item)
    faults = db.scalars(select(Fault).where(Fault.equipment_id == item.id, Fault.equipment_confirmed == 1)
                        .order_by(Fault.created_at.desc())).all()
    ids = [fault.id for fault in faults]
    diagnoses = db.scalars(select(Diagnosis).where(Diagnosis.fault_id.in_(ids))).all() if ids else []
    worked = {row.diagnosis_id for row in db.scalars(select(Intervention).where(Intervention.fault_id.in_(ids), Intervention.outcome == "SUCCESS"))} if ids else set()
    causes: Counter = Counter()
    confirmed: Counter = Counter()
    for diagnosis in diagnoses:
        label = CAUSE_CATEGORIES.get(diagnosis.cause_category) or diagnosis.possible_cause
        causes[label] += 1
        confirmed[label] += int(diagnosis.id in worked)
    listed = watchlist.build(db, load_facts(db, item.section), utcnow())
    watch = next(({"reasons": row["reasons"], "level": row["level"]} for row in listed if row["equipment_id"] == item.id), None)
    code = type_of(item.tag)
    return {
        "id": item.id, "tag": item.tag, "name": item.name, "station": item.station, "region": item.region, "location": item.location,
        "section": item.section, "criticality": item.criticality, "type_code": code, "type_name": type_name(code),
        "system": systems.summary(db, item), "watch": watch,
        "open_faults": [{"id": fault.id, "reference": fault.reference, "symptom": fault.symptom, "status": fault.status,
                         "safety_hazard": bool(fault.safety_hazard), "created_at": fault.created_at.isoformat()}
                        for fault in faults if fault.status not in ("RESTORED", "CLOSED")],
        "past_faults": [systems._case(db, fault) for fault in faults if fault.status in ("RESTORED", "CLOSED")][:6],
        "fault_count": len(faults),
        "usual_causes": [{"cause": label, "times": times, "confirmed": confirmed[label]} for label, times in causes.most_common(4)],
        "drawings": drawings_for_equipment(db, item.id),
        "drawing_differences": differences_for_equipment(db, item.id),
    }