from __future__ import annotations

from fastapi import Depends
from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session
import uuid
from fastapi import APIRouter

from app.db import db_dep
from app.deps import current_user
from app.models import Equipment, KnowledgeEntry, User, utcnow
from app.schemas import KnowledgeCreate
from app.services.access import require_equipment_scope, require_roles, role_key

router = APIRouter()

@router.get("/api/v1/knowledge")
def knowledge_list(status_filter: str = "", search: str = "", source_type: str = "", user: User = Depends(current_user), db: Session = Depends(db_dep)):
    require_roles(user, "systems_automation", "technician_st", "technician_pt", "technician_ct", "assistant_engineer", "engineer", "senior_engineer", "chief_engineer", "maintenance_manager", "general_manager_om", "supervisor", "system_administrator")
    query = select(KnowledgeEntry)
    if role_key(user) not in ("maintenance_manager", "general_manager_om", "supervisor", "system_administrator"):
        query = query.where(KnowledgeEntry.status == "APPROVED")
    if status_filter:
        if status_filter != "APPROVED" and role_key(user) not in ("maintenance_manager", "supervisor", "system_administrator"):
            raise HTTPException(status_code=403, detail="Only reviewers may view unapproved knowledge")
        query = query.where(KnowledgeEntry.status == status_filter)
    if search:
        needle = f"%{search.lower()}%"
        query = query.where(KnowledgeEntry.title.ilike(needle) | KnowledgeEntry.symptom.ilike(needle) | KnowledgeEntry.confirmed_cause.ilike(needle))
    if source_type:
        if source_type not in ("LEGACY_PROCEDURE", "FAULT_DERIVED"):
            raise HTTPException(status_code=422, detail="Unknown knowledge source type")
        query = query.where(KnowledgeEntry.source_type == source_type)
    entries = db.scalars(query.limit(200)).all()
    return [{
        "id": e.id,
        "reference": e.reference,
        "equipment_id": e.equipment_id,
        "title": e.title,
        "symptom": e.symptom,
        "confirmed_cause": e.confirmed_cause,
        "diagnostic_procedure": e.diagnostic_procedure,
        "corrective_action": e.corrective_action,
        "safety": e.safety,
        "status": e.status,
        "version": e.version,
        "source_type": e.source_type,
        "instruction_type": e.instruction_type,
        "usage_scope": e.usage_scope,
        "legacy_reference": e.legacy_reference,
        "step_by_step": e.step_by_step,
        "review_status": e.review_status,
        "superseded_by_id": e.superseded_by_id,
    } for e in entries]


@router.post("/api/v1/knowledge")
def create_knowledge(req: KnowledgeCreate, user: User = Depends(current_user), db: Session = Depends(db_dep)):
    require_roles(user, "technician_st", "technician_pt", "technician_ct", "assistant_engineer", "engineer", "senior_engineer", "chief_engineer", "maintenance_manager", "general_manager_om", "system_administrator")
    if req.equipment_id:
        equipment = db.get(Equipment, req.equipment_id)
        if not equipment:
            raise HTTPException(status_code=404, detail="Equipment not found")
        require_equipment_scope(user, equipment)
    if req.source_type not in ("LEGACY_PROCEDURE", "FAULT_DERIVED"):
        raise HTTPException(status_code=422, detail="Unknown knowledge source type")
    if req.source_type == "LEGACY_PROCEDURE" and not req.step_by_step.strip():
        raise HTTPException(status_code=422, detail="Legacy work instructions require numbered step-by-step text")
    count = db.query(KnowledgeEntry).count() + 1
    entry = KnowledgeEntry(
        id=str(uuid.uuid4()),
        reference=f"KN-DMO-{count:04d}",
        equipment_id=req.equipment_id,
        title=req.title,
        symptom=req.symptom,
        confirmed_cause=req.confirmed_cause,
        diagnostic_procedure=req.diagnostic_procedure,
        corrective_action=req.corrective_action,
        safety=req.safety,
        status="SUBMITTED" if req.source_type == "LEGACY_PROCEDURE" else "DRAFT",
        author_id=user.id,
        source_type=req.source_type,
        instruction_type=req.instruction_type,
        usage_scope=req.usage_scope,
        legacy_reference=req.legacy_reference,
        step_by_step=req.step_by_step,
        review_status="LEGACY_SUBMITTED" if req.source_type == "LEGACY_PROCEDURE" else "DIGITAL_REVIEW",
    )
    db.add(entry)
    db.commit()
    return {"id": entry.id, "reference": entry.reference, "status": entry.status}


@router.post("/api/v1/knowledge/{knowledge_id}/status")
def knowledge_status(knowledge_id: str, target_status: str, user: User = Depends(current_user), db: Session = Depends(db_dep)):
    require_roles(user, "maintenance_manager", "supervisor")
    entry = db.get(KnowledgeEntry, knowledge_id)
    if not entry:
        raise HTTPException(status_code=404, detail="Knowledge entry not found")
    if target_status not in ("SUBMITTED", "APPROVED", "REJECTED", "SUPERSEDED"):
        raise HTTPException(status_code=400, detail="Invalid knowledge status")
    entry.status = target_status
    if entry.source_type == "LEGACY_PROCEDURE":
        entry.review_status = {
            "APPROVED": "LEGACY_APPROVED",
            "REJECTED": "LEGACY_REJECTED",
            "SUPERSEDED": "LEGACY_SUPERSEDED",
            "SUBMITTED": "LEGACY_SUBMITTED",
        }[target_status]
    entry.updated_at = utcnow()
    db.commit()
    return {"id": entry.id, "status": entry.status, "version": entry.version}
