"""A technician's work, grouped the way they think about it at their desk."""
from __future__ import annotations

from datetime import timedelta

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import Fault, FaultAssignment, Intervention, ProcedureUpdate, User, utc_datetime, utcnow
from app.services.access import ACTIVE_ASSIGNMENT_STATUSES, INVESTIGATION_ROLES, require_roles, role_key

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
        **extra,
    }


def my_jobs(db: Session, user: User) -> dict:
    require_roles(user, *INVESTIGATION_ROLES)
    to_write_up, assigned, waiting, available, procedure_ready = [], [], [], [], []

    mine = db.scalars(
        select(FaultAssignment).where(FaultAssignment.assigned_user_id == user.id).order_by(FaultAssignment.created_at)
    ).all()
    for assignment in mine:
        fault = assignment.fault
        if assignment.status in ACTIVE_ASSIGNMENT_STATUSES:
            if "PENDING" in (assignment.completion_review_status, assignment.escalation_status):
                waiting.append(_job(db, fault, assignment, waiting_for="Chief Technician sign-off"))
            elif assignment.status == "OPEN":
                assigned.append(_job(db, fault, assignment))
            else:
                to_write_up.append(_job(db, fault, assignment))
        elif assignment.status == "RESTORED" and fault.status == "RESTORED":
            waiting.append(_job(db, fault, assignment, waiting_for="Operations to confirm it is back in service"))

    # Systems Automation responds first: new breakdowns nobody has taken yet.
    if role_key(user) == "systems_automation":
        open_first_response = db.scalars(
            select(FaultAssignment).where(
                FaultAssignment.section == "Systems Automation",
                FaultAssignment.status == "OPEN",
                FaultAssignment.assigned_user_id.is_(None),
            ).order_by(FaultAssignment.created_at)
        ).all()
        available = [_job(db, item.fault, item) for item in open_first_response if item.fault.equipment_confirmed]

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
        return (item["response_due_at"] or "9999", item["assigned_at"] or "")

    return {
        "to_write_up": to_write_up,
        "assigned": sorted(assigned, key=by_due),
        "available": available,
        "waiting": waiting,
        "procedure_ready": procedure_ready,
    }
