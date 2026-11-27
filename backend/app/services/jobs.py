"""A technician's work, grouped the way they think about it at their desk."""
from __future__ import annotations

import json
from datetime import timedelta

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import Fault, FaultAssignment, FaultEvent, FaultHelper, Intervention, ProcedureUpdate, User, utc_datetime, utcnow
from app.services.access import ACTIVE_ASSIGNMENT_STATUSES, INVESTIGATION_ROLES, region_allows, require_roles

PROCEDURE_WINDOW = timedelta(days=60)


def _seen_before(db: Session, fault: Fault) -> int:
    if not fault.equipment_confirmed:
        return 0
    since = utc_datetime(fault.created_at) - timedelta(days=90)
    return db.scalar(
        select(func.count()).select_from(Fault).where(
            Fault.equipment_id == fault.equipment_id, Fault.id != fault.id,
            Fault.created_at >= since, Fault.created_at <= fault.created_at,
        )
    ) or 0


def _iso(value):
    return utc_datetime(value).isoformat() if value else None


def _job(db: Session, fault: Fault, assignment: FaultAssignment | None, **extra) -> dict:
    equipment = fault.equipment
    confirmed = bool(fault.equipment_confirmed and equipment)
    return {
        "fault_id": fault.id,
        "reference": fault.reference,
        "equipment_tag": equipment.tag if confirmed else (fault.reported_equipment_text or "Asset not identified"),
        "equipment_name": equipment.name if confirmed else "Asset to be identified",
        "location": f"{equipment.location} · {equipment.station}" if confirmed else fault.reported_location,
        "symptom": fault.symptom,
        "operational_impact": fault.operational_impact,
        "severity": fault.severity,
        "safety_hazard": bool(fault.safety_hazard),
        "escalation_level": fault.escalation_level or 0,
        "escalation_guidance": fault.escalation_guidance or "",
        "description": fault.description,
        "status": fault.status,
        "reported_at": _iso(fault.created_at),
        "observed_at": _iso(fault.observed_at),
        "seen_via": fault.seen_via,
        "seen_before": _seen_before(db, fault),
        "assignment_id": assignment.id if assignment else None,
        "section": assignment.section if assignment else fault.assigned_section,
        "assigned_at": _iso(assignment.created_at) if assignment else None,
        "acknowledged_at": _iso(assignment.acknowledged_at) if assignment else None,
        "response_due_at": _iso(assignment.response_due_at) if assignment else None,
        "instructions": assignment.instructions if assignment else "",
        "latest_note": _latest_note(db, fault.id),
        **extra,
    }


def _latest_note(db: Session, fault_id: str) -> dict | None:
    """The newest note on the job (Chief Technician's comment, a question, a request for help)."""
    event = db.scalar(select(FaultEvent).where(FaultEvent.fault_id == fault_id, FaultEvent.event_type == "JOB_NOTE")
                      .order_by(FaultEvent.created_at.desc()).limit(1))
    if not event:
        return None
    author = db.get(User, event.actor_id)
    return {"by": author.display_name if author else "", "note": json.loads(event.payload or "{}").get("note", ""),
            "at": _iso(event.created_at)}


def my_jobs(db: Session, user: User) -> dict:
    require_roles(user, *INVESTIGATION_ROLES)
    to_write_up, assigned, waiting, available, procedure_ready, helping, returned = [], [], [], [], [], [], []

    mine = db.scalars(
        select(FaultAssignment).where(FaultAssignment.assigned_user_id == user.id).order_by(FaultAssignment.created_at)
    ).all()
    for assignment in mine:
        fault = assignment.fault
        if assignment.completion_review_status == "RETURNED":
            # The Chief Technician asked for more in the write-up (the equipment is already working).
            returned.append(_job(db, fault, assignment, review_comments=assignment.completion_review_comments))
        if assignment.status in ACTIVE_ASSIGNMENT_STATUSES:
            if assignment.escalation_status == "PENDING":
                waiting.append(_job(db, fault, assignment, waiting_for="Chief Technician to approve the handover"))
            elif assignment.status == "OPEN":
                assigned.append(_job(db, fault, assignment))
            else:
                to_write_up.append(_job(db, fault, assignment))
        elif assignment.status == "RESTORED" and fault.status == "RESTORED":
            waiting.append(_job(db, fault, assignment, waiting_for="Operations to confirm it is back in service"))

    # Called in to help on someone else's job.
    for helper in db.scalars(select(FaultHelper).where(FaultHelper.user_id == user.id).order_by(FaultHelper.created_at)).all():
        assignment = helper.assignment
        if assignment and assignment.status in ACTIVE_ASSIGNMENT_STATUSES:
            lead = assignment.assigned_user.display_name if assignment.assigned_user else ""
            helping.append(_job(db, assignment.fault, assignment, helping=lead))

    # Open pickup: anything nobody has taken yet, own section first. The first person free takes it.
    untaken = db.scalars(
        select(FaultAssignment).where(
            FaultAssignment.status == "OPEN", FaultAssignment.assigned_user_id.is_(None),
        ).order_by(FaultAssignment.created_at)
    ).all()
    for item in untaken:
        fault = item.fault
        if fault.status not in ("REPORTED", "TRIAGED", "ASSIGNED"):
            continue  # older records where work had started before jobs were tracked per person
        if not region_allows(user, fault.equipment.region if fault.equipment else ""):
            continue
        available.append(_job(db, fault, item, own_section=item.section == user.section))
    available.sort(key=lambda job: (not job["safety_hazard"], not job["own_section"], job["assigned_at"] or ""))

    # Fixed and confirmed recently, but not yet turned into a procedure by this person.
    since = utcnow() - PROCEDURE_WINDOW
    fixed_fault_ids = db.scalars(
        select(Intervention.fault_id).where(Intervention.actor_id == user.id, Intervention.outcome == "SUCCESS").distinct()
    ).all()
    for fault in db.scalars(select(Fault).where(Fault.id.in_(fixed_fault_ids), Fault.status.in_(("RESTORED", "CLOSED")))).all():
        if fault.restored_at and utc_datetime(fault.restored_at) < since:
            continue
        authored = db.scalar(select(ProcedureUpdate.id).where(
            ProcedureUpdate.fault_id == fault.id, ProcedureUpdate.author_id == user.id,
        ).limit(1))
        if not authored:
            procedure_ready.append(_job(db, fault, None))

    def by_due(item: dict) -> tuple:
        # Safety hazards first, then the earliest response time.
        return (not item["safety_hazard"], item["response_due_at"] or "9999", item["assigned_at"] or "")

    def safety_first(items: list[dict]) -> list[dict]:
        return sorted(items, key=lambda item: not item["safety_hazard"])

    return {
        "to_write_up": safety_first(to_write_up),
        "assigned": sorted(assigned, key=by_due),
        "available": available,
        "helping": helping,
        "returned": returned,
        "waiting": waiting,
        "procedure_ready": procedure_ready,
    }
