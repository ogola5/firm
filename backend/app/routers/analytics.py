from __future__ import annotations

from fastapi import Depends
from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session
from fastapi import APIRouter

from app.db import db_dep
from app.deps import current_user
from app.models import Equipment, Fault, KnowledgeEntry, ProcedureUpdate, User
from app.services.access import role_key
from app.services.workflow_metrics import workflow_summary

router = APIRouter()

@router.get("/api/v1/analytics/overview")
def analytics(user: User = Depends(current_user), db: Session = Depends(db_dep)):
    key = role_key(user)
    if key == "hr_officer":
        raise HTTPException(status_code=403, detail="HR roles use the workforce directory, not maintenance analytics")
    query = select(Fault)
    section_scoped = key in ("technician_st", "technician_pt", "technician_ct", "assistant_engineer", "engineer", "senior_engineer", "chief_engineer")
    if section_scoped:
        query = query.join(Equipment, Fault.equipment_id == Equipment.id).where(
            (Fault.assigned_section == user.section) | (Equipment.section == user.section)
        )
    faults = db.scalars(query).all()
    categories = {}
    stations = {}
    sections = {}
    for f in faults:
        categories[f.category] = categories.get(f.category, 0) + 1
        sections[f.assigned_section or "Unassigned"] = sections.get(f.assigned_section or "Unassigned", 0) + 1
        if f.equipment:
            stations[f.equipment.station] = stations.get(f.equipment.station, 0) + 1
    open_count = sum(f.status not in ("RESTORED", "CLOSED") for f in faults)
    resolved_count = sum(f.status in ("RESTORED", "CLOSED") for f in faults)
    restore_times = [(f.restored_at - f.created_at).total_seconds() / 3600 for f in faults if f.restored_at]
    acknowledge_times = [(f.acknowledged_at - f.created_at).total_seconds() / 60 for f in faults if f.acknowledged_at]
    result = {
        "total_faults": len(faults),
        "open_faults": open_count,
        "resolved_faults": resolved_count,
        "approved_knowledge": db.query(KnowledgeEntry).filter(KnowledgeEntry.status == "APPROVED").count()
        + db.query(ProcedureUpdate).filter(ProcedureUpdate.status == "APPROVED").count(),
        "data_type": "Illustrative synthetic demonstration statistics",
    }
    if key == "managing_director":
        result["resolved_rate_percent"] = round(resolved_count * 100 / len(faults), 1) if faults else 0
        result["view_level"] = "Executive summary"
        return result
    result.update({
        "by_category": categories,
        "by_station": stations,
        "by_section": sections if not section_scoped else {user.section: len(faults)},
        "mean_time_acknowledge_minutes": round(sum(acknowledge_times) / len(acknowledge_times), 1) if acknowledge_times else None,
        "mean_time_restore_hours": round(sum(restore_times) / len(restore_times), 1) if restore_times else None,
        "knowledge_entries": db.query(KnowledgeEntry).count() + db.query(ProcedureUpdate).count(),
        "view_level": f"{user.section} section" if section_scoped else "Operations and maintenance detail",
    })
    if key in ("general_manager_om", "maintenance_manager", "supervisor", "system_administrator"):
        result["workflow"] = workflow_summary(faults, db)
    return result
