from __future__ import annotations

from fastapi import Depends
from fastapi import HTTPException
from sqlalchemy.orm import Session
import uuid
from fastapi import APIRouter

from app.db import db_dep
from app.deps import current_user
from app.models import Diagnosis, Fault, Intervention, User
from app.schemas import DiagnosisCreate, InterventionCreate
from app.services.access import INVESTIGATION_ROLES, current_assignment, require_current_assignment, require_fault_scope, require_roles
from app.services.audit import add_event

router = APIRouter()

@router.post("/api/v1/faults/{fault_id}/diagnoses")
def record_diagnosis(fault_id: str, req: DiagnosisCreate, user: User = Depends(current_user), db: Session = Depends(db_dep)):
    require_roles(user, *INVESTIGATION_ROLES)
    fault = db.get(Fault, fault_id)
    if not fault:
        raise HTTPException(status_code=404, detail="Fault not found")
    require_fault_scope(user, fault)
    assignment = current_assignment(fault)
    if not assignment:
        raise HTTPException(status_code=409, detail="There is no active section assignment for this breakdown")
    require_current_assignment(user, fault)
    if assignment.escalation_status == "PENDING" or assignment.completion_review_status == "PENDING":
        raise HTTPException(status_code=409, detail="This assignment is awaiting Chief Technician review")
    if not req.possible_cause.strip() or not req.diagnostic_method.strip():
        raise HTTPException(status_code=422, detail="A possible cause and diagnostic method are required")
    if req.confidence is not None and not 0 <= req.confidence <= 1:
        raise HTTPException(status_code=422, detail="Confidence must be between 0 and 1")
    if req.risk_level not in ("Normal", "Caution", "High"):
        raise HTTPException(status_code=422, detail="Risk level must be Normal, Caution or High")
    if req.risk_level == "High" and not req.fix_summary.strip():
        raise HTTPException(status_code=422, detail="A fix summary is required for a high-risk diagnosis")
    diagnosis = Diagnosis(
        id=str(uuid.uuid4()),
        fault_id=fault.id,
        assignment_id=assignment.id,
        author_id=user.id,
        possible_cause=req.possible_cause.strip(),
        diagnostic_method=req.diagnostic_method.strip(),
        observations=req.observations.strip(),
        test_results=req.test_results.strip(),
        confidence=req.confidence,
        quick_check=req.quick_check.strip(),
        fix_summary=req.fix_summary.strip(),
        workaround=int(req.workaround),
        risk_level=req.risk_level,
    )
    db.add(diagnosis)
    fault.status = "DIAGNOSED"
    add_event(db, fault.id, "DIAGNOSIS_RECORDED", user.id, req.model_dump())
    db.commit()
    return {"id": diagnosis.id, "status": diagnosis.verification_status, "created_at": diagnosis.created_at.isoformat()}


@router.post("/api/v1/faults/{fault_id}/interventions")
def record_intervention(fault_id: str, req: InterventionCreate, user: User = Depends(current_user), db: Session = Depends(db_dep)):
    require_roles(user, *INVESTIGATION_ROLES)
    fault = db.get(Fault, fault_id)
    if not fault:
        raise HTTPException(status_code=404, detail="Fault not found")
    require_fault_scope(user, fault)
    assignment = current_assignment(fault)
    if not assignment:
        raise HTTPException(status_code=409, detail="There is no active section assignment for this breakdown")
    require_current_assignment(user, fault)
    if assignment.escalation_status == "PENDING" or assignment.completion_review_status == "PENDING":
        raise HTTPException(status_code=409, detail="This assignment is awaiting Chief Technician review")
    if req.outcome not in ("SUCCESS", "FAILED", "IN_PROGRESS"):
        raise HTTPException(status_code=422, detail="Outcome must be SUCCESS, FAILED or IN_PROGRESS")
    if not req.corrective_action.strip():
        raise HTTPException(status_code=422, detail="A corrective action is required")
    if req.diagnosis_id:
        diagnosis = db.get(Diagnosis, req.diagnosis_id)
        if not diagnosis or diagnosis.fault_id != fault.id:
            raise HTTPException(status_code=422, detail="Diagnosis must belong to this fault")
        if req.outcome == "SUCCESS":
            diagnosis.verification_status = "CONFIRMED"
    intervention = Intervention(
        id=str(uuid.uuid4()),
        fault_id=fault.id,
        assignment_id=assignment.id,
        diagnosis_id=req.diagnosis_id,
        actor_id=user.id,
        corrective_action=req.corrective_action.strip(),
        tools_materials=req.tools_materials.strip(),
        outcome=req.outcome,
        notes=req.notes.strip(),
    )
    db.add(intervention)
    add_event(db, fault.id, f"INTERVENTION_{req.outcome}", user.id, req.model_dump())
    db.commit()
    return {"id": intervention.id, "outcome": intervention.outcome, "created_at": intervention.created_at.isoformat()}
