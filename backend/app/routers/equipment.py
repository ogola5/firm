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
