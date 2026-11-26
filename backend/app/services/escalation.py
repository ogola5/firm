"""Escalation: Chief Technician -> regional Senior Engineer -> section Chief Engineer.

A routine fix stays with the CT (level 0). It goes to the Senior Engineer of the
fault's section and region (level 1) when the CT asks, when it is a safety
report, or when it is not back in service after a set time. It reaches the
section's Chief Engineer (level 2) only if it persists: the same equipment
failed again within 30 days of a fix, or the SE says it needs something extra
(spares, a design change, a contractor).
"""
from __future__ import annotations

from datetime import datetime, timedelta

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models import Fault, FaultAssignment, User, utc_datetime, utcnow
from app.services import accounts, notifications
from app.services.access import current_assignment, role_key, user_region
from app.services.audit import add_event

LEVELS = {0: "Chief Technician", 1: "Senior Engineer", 2: "Chief Engineer"}
CE_REASONS = [
    "Needs spares or a purchase",
    "Needs a design change",
    "Needs a contractor or specialist",
    "Keeps coming back after fixes",
    "Other",
]
SYSTEM_ACTOR = "SYSTEM-ESCALATION"
OPEN = ("RESTORED", "CLOSED")


def responsible_section(fault: Fault) -> str:
    """The section that owns the equipment (it answers for it), else the one working on it now."""
    if fault.equipment_confirmed and fault.equipment:
        return fault.equipment.section
    assignment = current_assignment(fault)
    if assignment:
        return assignment.section
    return fault.assigned_section or "Systems Automation"


def sections(fault: Fault) -> set[str]:
    """Sections that may act on the escalation: the owner, and the section working on it now."""
    assignment = current_assignment(fault)
    return {responsible_section(fault)} | ({assignment.section} if assignment else set())


def fault_region(fault: Fault) -> str:
    return fault.equipment.region if fault.equipment_confirmed and fault.equipment else ""


def recipients(db: Session, fault: Fault, level: int, section: str | None = None) -> list[User]:
    section = section or responsible_section(fault)
    region = fault_region(fault)
    role = "senior_engineer" if level == 1 else "chief_engineer"
    people = db.scalars(select(User).where(User.role == role, User.section == section, User.active == 1)).all()
    if level == 1 and region:
        people = [person for person in people if person.region == region] or people
    return list(people)


def place(fault: Fault) -> str:
    equipment = f"{fault.equipment.tag} · {fault.equipment.name}" if fault.equipment_confirmed and fault.equipment else (fault.reported_equipment_text or "equipment to be identified")
    region = fault_region(fault)
    return f"{fault.reference} — {equipment}{f' ({region} region)' if region else ''}"


def escalate(db: Session, fault: Fault, level: int, reason: str, actor_id: str = SYSTEM_ACTOR,
             now: datetime | None = None, section: str | None = None) -> bool:
    """Raise the fault to `level` (never lowers it). Recorded on the timeline and emailed."""
    if fault.escalation_level >= level or fault.status in OPEN:
        return False
    now = now or utcnow()
    fault.escalation_level, fault.escalated_at, fault.escalation_reason = level, now, reason
    to = LEVELS[level]
    people = recipients(db, fault, level, section)
    add_event(db, fault.id, "FAULT_ESCALATED", actor_id, {
        "level": level, "to": to, "reason": reason, "automatic": actor_id == SYSTEM_ACTOR,
        "notified": [person.display_name for person in people],
    }, created_at=now)
    notifications.notify(db, people, "escalation", f"Escalated to you ({to}): {fault.reference}",
                         f"{place(fault)}. Reason: {reason}", f"/faults?mode=history&fault={fault.id}", exclude=actor_id)
    for person in people:
        accounts.send_mail(db, person.email, f"Escalated to you ({to}): {fault.reference}",
                           f"Hello {person.display_name},\n\n{place(fault)}\nProblem: {fault.symptom}\nReason: {reason}\n\n"
                           f"Open it to see the full history and add guidance for the Chief Technician and technician.\n"
                           f"{settings.app_url.rstrip('/')}/faults?mode=history&fault={fault.id}")
    return True


def came_back_after_fix(db: Session, fault: Fault) -> Fault | None:
    """An earlier fault on the same equipment restored within the repeat window before this one was reported."""
    if not fault.equipment_confirmed:
        return None
    reported = utc_datetime(fault.created_at)
    earlier = db.scalars(select(Fault).where(
        Fault.equipment_id == fault.equipment_id, Fault.equipment_confirmed == 1, Fault.id != fault.id,
        Fault.restored_at.is_not(None), Fault.created_at < fault.created_at,
    ).order_by(Fault.restored_at.desc())).first()
    if earlier and timedelta(0) <= reported - utc_datetime(earlier.restored_at) <= timedelta(days=settings.ce_repeat_days):
        return earlier
    return None


def on_report(db: Session, fault: Fault) -> None:
    """Escalations decided when the fault is reported."""
    earlier = came_back_after_fix(db, fault)
    if earlier:
        escalate(db, fault, 2, f"Came back within {settings.ce_repeat_days} days of a fix ({earlier.reference})")
    elif fault.safety_hazard:
        escalate(db, fault, 1, "Safety or environment hazard reported")


def run(db: Session, now: datetime | None = None) -> int:
    """Time-based rules for open faults. Safe to run as often as you like."""
    now = now or utcnow()
    changed = 0
    limit = now - timedelta(hours=settings.se_after_hours)
    for fault in db.scalars(select(Fault).where(Fault.status.notin_(OPEN), Fault.escalation_level < 2)):
        earlier = came_back_after_fix(db, fault)
        if earlier:
            changed += escalate(db, fault, 2, f"Came back within {settings.ce_repeat_days} days of a fix ({earlier.reference})", now=now)
        elif fault.escalation_level == 0 and utc_datetime(fault.created_at) <= limit:
            changed += escalate(db, fault, 1, f"Not back in service after {settings.se_after_hours} hours", now=now)
    if changed:
        db.commit()
    return changed


# --- who may do what -------------------------------------------------------------------------------

def _same_place(user: User, fault: Fault) -> bool:
    if user.section not in sections(fault):
        return False
    region = user_region(user)
    return region is None or not fault_region(fault) or fault_region(fault) == region


def allowed_actions(user: User, fault: Fault) -> list[str]:
    """What this person can do with the escalation on this fault (shown on the fault page)."""
    if fault.status in OPEN:
        return []
    key = role_key(user)
    actions = []
    if key == "technician_ct" and fault.escalation_level == 0 and _same_place(user, fault):
        actions.append("to_se")
    if key == "senior_engineer" and fault.escalation_level < 2 and _same_place(user, fault):
        actions.append("to_ce")
    if (key == "senior_engineer" and fault.escalation_level >= 1 and _same_place(user, fault)) or \
            (key == "chief_engineer" and fault.escalation_level == 2 and user.section in sections(fault)):
        actions.append("guide")
    return actions


def request_escalation(db: Session, user: User, fault: Fault, to: str, reason: str) -> None:
    reason = reason.strip()
    if len(reason) < 5:
        raise HTTPException(status_code=422, detail="Say why it needs the next level")
    wanted = {"SE": "to_se", "CE": "to_ce"}.get(to)
    if not wanted or wanted not in allowed_actions(user, fault):
        raise HTTPException(status_code=403, detail="You cannot escalate this fault to that level")
    # Goes up the asker's own line: their section's SE (in their region) or Chief Engineer.
    escalate(db, fault, 1 if to == "SE" else 2, reason, actor_id=user.id, section=user.section)


def add_guidance(db: Session, user: User, fault: Fault, note: str) -> None:
    note = note.strip()
    if len(note) < 5:
        raise HTTPException(status_code=422, detail="Write the guidance")
    if "guide" not in allowed_actions(user, fault):
        raise HTTPException(status_code=403, detail="Only the Senior or Chief Engineer it is escalated to can add guidance")
    fault.escalation_guidance = note
    add_event(db, fault.id, "ESCALATION_GUIDANCE", user.id, {"note": note, "by": user.display_name})
    region = fault_region(fault)
    chiefs = db.scalars(select(User).where(User.role == "technician_ct", User.section.in_(sections(fault)), User.active == 1)).all()
    people = [person for person in chiefs if not region or person.region == region] or list(chiefs)
    assignment: FaultAssignment | None = current_assignment(fault)
    if assignment and assignment.assigned_user:
        people.append(assignment.assigned_user)
    notifications.notify(db, people, "escalation", f"Guidance from the {LEVELS[fault.escalation_level]}: {fault.reference}",
                         f"{user.display_name}: {note}", f"/faults?mode=history&fault={fault.id}", exclude=user.id)
    for person in people:
        accounts.send_mail(db, person.email, f"Guidance from the {LEVELS[fault.escalation_level]}: {fault.reference}",
                           f"Hello {person.display_name},\n\n{place(fault)}\n{user.display_name}: {note}")


def queue(db: Session, user: User) -> list[Fault]:
    """Open faults escalated to this person: SE (their section and region), CE (level 2 in their section), managers (all)."""
    key = role_key(user)
    faults = db.scalars(select(Fault).where(Fault.status.notin_(OPEN), Fault.escalation_level >= 1)
                        .order_by(Fault.escalation_level.desc(), Fault.escalated_at.desc())).all()
    if key == "senior_engineer":
        return [fault for fault in faults if _same_place(user, fault)]
    if key == "chief_engineer":
        return [fault for fault in faults if fault.escalation_level == 2 and user.section in sections(fault)]
    if key in ("maintenance_manager", "general_manager_om", "supervisor", "system_administrator"):
        return list(faults)
    raise HTTPException(status_code=403, detail="Escalations are for Senior Engineers, Chief Engineers and managers")
