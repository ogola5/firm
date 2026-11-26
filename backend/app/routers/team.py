from __future__ import annotations

from fastapi import Depends
from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session
import json
from fastapi import APIRouter

from app.db import db_dep
from app.deps import current_user
from app.models import Equipment, Fault, FaultAssignment, User, utc_datetime, utcnow
from app.schemas import AvailabilityUpdate, CompetenciesUpdate
from app.services.access import ASSIGNABLE_TECHNICIAN_ROLES, current_assignment, region_filter, require_roles, role_key, user_region
from app.services.audit import audit_user_change
from app.services.people import section_technician_payloads

router = APIRouter()

@router.get("/api/v1/chief/team")
def chief_team(user: User = Depends(current_user), db: Session = Depends(db_dep)):
    require_roles(user, "technician_ct")
    return section_technician_payloads(db, user.section, user_region(user))


@router.patch("/api/v1/me/availability")
def update_my_availability(
    req: AvailabilityUpdate,
    user: User = Depends(current_user),
    db: Session = Depends(db_dep),
):
    require_roles(user, *ASSIGNABLE_TECHNICIAN_ROLES)
    if req.availability_status not in ("AVAILABLE", "UNAVAILABLE"):
        raise HTTPException(status_code=422, detail="Availability must be AVAILABLE or UNAVAILABLE")
    user.availability_status = req.availability_status
    audit_user_change(db, user.id, "TECHNICIAN_AVAILABILITY_CHANGED", user, {
        "availability_status": user.availability_status,
    })
    db.commit()
    return {"id": user.id, "availability_status": user.availability_status}


@router.patch("/api/v1/chief/team/{user_id}/competencies")
def update_team_competencies(
    user_id: str,
    req: CompetenciesUpdate,
    user: User = Depends(current_user),
    db: Session = Depends(db_dep),
):
    require_roles(user, "technician_ct")
    target = db.get(User, user_id)
    if (not target or target.section != user.section or role_key(target) not in ASSIGNABLE_TECHNICIAN_ROLES
            or (user_region(user) and target.region != user.region)):
        raise HTTPException(status_code=404, detail="Technician not found in your section")
    competencies = []
    seen = set()
    for value in req.competencies:
        competency = value.strip()
        key = competency.casefold()
        if competency and key not in seen:
            competencies.append(competency)
            seen.add(key)
    if len(competencies) > 20 or any(len(value) > 80 for value in competencies):
        raise HTTPException(status_code=422, detail="Enter at most 20 competencies, each no longer than 80 characters")
    target.competencies = json.dumps(competencies)
    audit_user_change(db, user.id, "TECHNICIAN_COMPETENCIES_CHANGED", target, {
        "competencies": competencies,
    })
    db.commit()
    return {"id": target.id, "competencies": competencies}


@router.get("/api/v1/chief/workspace")
def chief_workspace(user: User = Depends(current_user), db: Session = Depends(db_dep)):
    require_roles(user, "technician_ct")
    query = (
        select(Fault)
        .join(Equipment, Fault.equipment_id == Equipment.id)
        .where(
            (Fault.assigned_section == user.section)
            | (Equipment.section == user.section)
            | Fault.id.in_(select(FaultAssignment.fault_id).where(FaultAssignment.section == user.section))
        )
        .order_by(Fault.created_at.desc())
    )
    in_region = region_filter(user)
    if in_region is not None:
        query = query.where(in_region)
    scoped_faults = db.scalars(query.limit(200)).all()
    records = []
    now = utcnow()
    for fault in scoped_faults:
        # The write-up is checked after the fix, so a working (even closed) fault can still be waiting for it.
        to_check = next((item for item in fault.assignments
                         if item.section == user.section and item.completion_review_status == "PENDING"), None)
        if fault.status == "CLOSED" and not to_check:
            continue
        assignment = current_assignment(fault)
        section_history = any(item.section == user.section for item in fault.assignments)
        if fault.assigned_section != user.section and (not fault.equipment or fault.equipment.section != user.section) and not section_history:
            continue
        due_at = assignment.response_due_at if assignment else None
        is_current_section = bool(assignment and assignment.section == user.section)
        escalated = bool(assignment and assignment.section != user.section and section_history)
        awaiting_assignment = bool(
            is_current_section and assignment and not assignment.assigned_user_id
            and assignment.escalation_status != "PENDING"
        )
        handover_review = bool(is_current_section and assignment and assignment.escalation_status == "PENDING")
        awaiting_review = handover_review or bool(to_check)
        untaken_minutes = (
            max(0, int((now - utc_datetime(assignment.created_at)).total_seconds() // 60)) if awaiting_assignment else 0
        )
        overdue = bool(
            is_current_section and assignment and due_at
            and utc_datetime(due_at) < now
            and fault.status not in ("RESTORED", "CLOSED")
        )
        records.append({
            "id": fault.id,
            "reference": fault.reference,
            "equipment_tag": fault.equipment.tag if fault.equipment_confirmed and fault.equipment else (
                fault.reported_equipment_text or "Asset not identified"
            ),
            "symptom": fault.symptom,
            "severity": fault.severity,
            "status": fault.status,
            "assigned_section": fault.assigned_section,
            "assigned_user_id": assignment.assigned_user_id if assignment else None,
            "assigned_user_name": assignment.assigned_user.display_name if assignment and assignment.assigned_user else "",
            "assignment_status": assignment.status if assignment else "",
            "response_due_at": due_at.isoformat() if due_at else None,
            "awaiting_assignment": awaiting_assignment,
            "untaken_minutes": untaken_minutes,
            "awaiting_review": awaiting_review,
            "handover_review": handover_review,
            "write_up_to_check": bool(to_check),
            "review_assignment_id": to_check.id if to_check else None,
            "escalated": escalated,
            "overdue": overdue,
            "created_at": fault.created_at.isoformat(),
        })
    active_section = [item for item in records if item["assigned_section"] == user.section and item["status"] not in ("RESTORED", "CLOSED")]
    return {
        "section": user.section,
        "region": user.region,
        "counts": {
            "awaiting_assignment": sum(bool(item["awaiting_assignment"]) for item in active_section),
            "active_section": len(active_section),
            "investigating": sum(item["assignment_status"] in ("ACKNOWLEDGED", "IN_PROGRESS") for item in active_section),
            "escalated": sum(bool(item["escalated"]) for item in records),
            "awaiting_review": sum(bool(item["awaiting_review"]) for item in records),
            "overdue": sum(bool(item["overdue"]) for item in active_section),
            "critical": sum(item["severity"].casefold() == "critical" and item["status"] not in ("RESTORED", "CLOSED") for item in records),
        },
        "faults": records,
        "technicians": section_technician_payloads(db, user.section, user_region(user)),
    }
