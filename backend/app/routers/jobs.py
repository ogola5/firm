from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.db import db_dep
from app.deps import current_user
from app.models import User
from app.schemas import VisitCreate
from app.services import fault_operations, jobs

router = APIRouter()


@router.get("/api/v1/me/jobs")
def my_jobs(user: User = Depends(current_user), db: Session = Depends(db_dep)):
    """The signed-in technician's jobs: to write up, assigned, available, waiting, ready for a procedure."""
    return jobs.my_jobs(db, user)


@router.post("/api/v1/faults/{fault_id}/visits")
def record_visit(fault_id: str, req: VisitCreate, user: User = Depends(current_user), db: Session = Depends(db_dep)):
    """Write up a site visit afterwards, with the times from the technician's notes."""
    result = fault_operations.record_visit(db, user, fault_id, req)
    db.commit()
    return result
