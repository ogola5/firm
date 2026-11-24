from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.db import db_dep
from app.deps import current_user
from app.models import User
from app.schemas import DiagnosisCreate, InterventionCreate
from app.services import fault_operations

router = APIRouter()


@router.post("/api/v1/faults/{fault_id}/diagnoses")
def record_diagnosis(fault_id: str, req: DiagnosisCreate, user: User = Depends(current_user), db: Session = Depends(db_dep)):
    result = fault_operations.record_diagnosis(db, user, fault_id, req)
    db.commit()
    return result


@router.post("/api/v1/faults/{fault_id}/interventions")
def record_intervention(fault_id: str, req: InterventionCreate, user: User = Depends(current_user), db: Session = Depends(db_dep)):
    result = fault_operations.record_intervention(db, user, fault_id, req)
    db.commit()
    return result
