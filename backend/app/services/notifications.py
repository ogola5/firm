"""In-app notifications: the bell. Who hears about what (proposal module 11).

Most notices come from the fault timeline: add_event() queues the event, and the rules below
run just before the save commits (so new records are visible) and decide who is told. A few
notices that are not timeline events (escalations, knowledge owners, "your fix helped") call
notify() directly. Nobody is notified of their own action. Seeding runs in quiet() mode so
demo history does not flood anyone's bell.
"""
from __future__ import annotations

import logging
import uuid
from collections.abc import Iterable, Iterator
from contextlib import contextmanager
from contextvars import ContextVar

from sqlalchemy import event, select
from sqlalchemy.orm import Session

from app.models import Fault, FaultAssignment, Notification, ProcedureReview, ProcedureUpdate, User, utcnow
from app.services.access import current_assignment, role_key

logger = logging.getLogger("kpc")
_enabled: ContextVar[bool] = ContextVar("notifications_enabled", default=True)
PENDING = "kpc_pending_notification_events"


@contextmanager
def quiet() -> Iterator[None]:
    """No notifications inside this block (seeding demo history)."""
    token = _enabled.set(False)
    try:
        yield
    finally:
        _enabled.reset(token)


def notify(db: Session, people: Iterable[User | None], kind: str, title: str, body: str = "", link: str = "",
           exclude: str | None = None) -> int:
    if not _enabled.get():
        return 0
    seen: set[str] = set()
    count = 0
    for person in people:
        if not person or not person.active or person.id == exclude or person.id in seen:
            continue
        seen.add(person.id)
        db.add(Notification(id=str(uuid.uuid4()), user_id=person.id, kind=kind, title=title[:200], body=body[:600],
                            link=link, created_at=utcnow()))
        count += 1
    return count


def queue_event(db: Session, fault_id: str, event_type: str, actor_id: str, payload: dict) -> None:
    """Called by add_event(); the rules run just before commit."""
    if _enabled.get() and event_type in RULES:
        db.info.setdefault(PENDING, []).append((fault_id, event_type, actor_id, payload))


@event.listens_for(Session, "before_commit")
def _deliver(session: Session) -> None:
    pending = session.info.pop(PENDING, None)
    for fault_id, event_type, actor_id, payload in pending or []:
        try:
            fault = session.get(Fault, fault_id)
            if fault:
                RULES[event_type](session, fault, actor_id, payload)
        except Exception:  # a notice must never stop the work being saved
            logger.exception("Notification rule %s failed for %s", event_type, fault_id)


# --- who ---------------------------------------------------------------------------------------------

def _people(db: Session, role: str, section: str | None = None, region: str | None = None) -> list[User]:
    query = select(User).where(User.role == role, User.active == 1)
    if section:
        query = query.where(User.section == section)
    people = list(db.scalars(query))
    if region:
        people = [person for person in people if person.region == region] or people
    return people


def _region(fault: Fault) -> str:
    return fault.equipment.region if fault.equipment_confirmed and fault.equipment else ""


def _owner_section(fault: Fault) -> str:
    if fault.equipment_confirmed and fault.equipment:
        return fault.equipment.section
    return fault.assigned_section or "Systems Automation"


def chiefs(db: Session, fault: Fault, section: str | None = None) -> list[User]:
    return _people(db, "technician_ct", section or _owner_section(fault), _region(fault))


def _where(fault: Fault) -> str:
    if fault.equipment_confirmed and fault.equipment:
        return f"{fault.equipment.tag} · {fault.equipment.name}"
    return fault.reported_equipment_text or "equipment to be identified"


def _link(fault: Fault) -> str:
    return f"/faults?mode=history&fault={fault.id}"


def _assigned(db: Session, fault: Fault, payload: dict) -> User | None:
    assignment = db.get(FaultAssignment, payload["assignment_id"]) if payload.get("assignment_id") else current_assignment(fault)
    return assignment.assigned_user if assignment and assignment.assigned_user_id else None


# --- rules: event -> who is told -----------------------------------------------------------------------

def responders(db: Session, fault: Fault) -> list[User]:
    """Who hears about a new fault: the section it was sent to (technicians and its Chief Technician,
    in the fault's region), and the Systems Automation desk when it was sent there."""
    section = fault.assigned_section or "Systems Automation"
    region = _region(fault)
    people = [person for role in ("technician_st", "technician_pt") for person in _people(db, role, section, region)]
    people += chiefs(db, fault, section)
    if section == "Systems Automation":
        people += _people(db, "systems_automation")
    return people


def _reported(db, fault, actor, payload):
    if fault.safety_hazard:
        return  # the safety rule tells more people, more urgently
    notify(db, responders(db, fault), "fault", f"New fault: {fault.reference} · {_where(fault)}",
           f"{fault.symptom}. {fault.operational_impact}. Anyone free can take it.".strip(), _link(fault), actor)


def _safety(db, fault, actor, payload):
    notify(db, [*responders(db, fault), *_people(db, "systems_automation"), *chiefs(db, fault)], "safety",
           f"SAFETY: {fault.reference} · {_where(fault)}",
           f"{fault.symptom}. The reporter says someone or something is at risk.", _link(fault), actor)


def _allocated(db, fault, actor, payload):
    person = db.get(User, payload.get("assigned_user_id")) if payload.get("assigned_user_id") else None
    if person and payload.get("assigned_user_id") != payload.get("previous_assigned_user_id"):
        notify(db, [person], "work", f"Job given to you: {fault.reference} · {_where(fault)}",
               f"Priority {payload.get('priority', fault.severity)}. {payload.get('instructions') or ''}".strip(),
               f"/jobs/{fault.id}/card", actor)
    elif person and payload.get("instructions") and payload.get("instructions") != payload.get("previous_instructions"):
        # The Chief Technician changed the instructions on a job someone already has.
        notify(db, [person], "work", f"New instructions on your job: {fault.reference}", payload["instructions"], _link(fault), actor)


def on_the_job(fault: Fault) -> list[User]:
    """The person who took the job and the colleagues they called in."""
    assignment = current_assignment(fault)
    if not assignment:
        return []
    return [person for person in (assignment.assigned_user, *(helper.user for helper in assignment.helpers)) if person]


def _job_note(db, fault, actor, payload):
    """A note on the job reaches everyone on it; "ask the Chief Technician" also reaches the section's CT."""
    author = db.get(User, actor)
    name = author.display_name if author else "Someone"
    note = payload.get("note") or ""
    notify(db, on_the_job(fault), "work", f"Note on your job from {name}: {fault.reference}", note, _link(fault), actor)
    if payload.get("ask_chief"):
        notify(db, chiefs(db, fault, payload.get("section") or None), "work", f"Help asked by {name}: {fault.reference}",
               f"{_where(fault)}: {note}", _link(fault), actor)


def _handed_over(db, fault, actor, payload):
    if payload.get("handoff"):
        section = payload.get("assigned_section") or fault.assigned_section
        notify(db, chiefs(db, fault, section), "work", f"New work for {section}: {fault.reference} · {_where(fault)}",
               "Handed over from another section. Allocate it to a technician.", _link(fault), actor)


def _acknowledged(db, fault, actor, payload):
    """The Chief Technician is told who took it; nobody waits for them."""
    person = db.get(User, actor)
    section = payload.get("section") or (current_assignment(fault).section if current_assignment(fault) else None)
    if person and role_key(person) != "technician_ct" and section:
        notify(db, chiefs(db, fault, section), "work", f"{person.display_name} took {fault.reference}",
               _where(fault), _link(fault), actor)


def _taken_across(db, fault, actor, payload):
    person = db.get(User, actor)
    name = person.display_name if person else "Someone"
    notify(db, chiefs(db, fault, payload.get("from_section")), "work",
           f"{name} ({payload.get('to_section')}) took {fault.reference}",
           f"{_where(fault)}: sent to {payload.get('from_section')}, taken by someone free in another section.", _link(fault), actor)


def _waiting_signoff(db, fault, actor, payload):
    """Working again: Operations is asked to confirm now; the Chief Technician checks the write-up when they can."""
    assignment = db.get(FaultAssignment, payload["assignment_id"]) if payload.get("assignment_id") else None
    section = assignment.section if assignment else _owner_section(fault)
    notify(db, [fault.reporter], "fault", f"Back in service: please confirm {fault.reference}",
           f"{_where(fault)}. Check it is working and confirm, or say it is not fixed.", _link(fault), actor)
    notify(db, chiefs(db, fault, section), "review", f"Write-up to check: {fault.reference}",
           f"{_where(fault)} is working again. Check the write-up when you can.", _link(fault), actor)


def _helper_added(db, fault, actor, payload):
    lead = db.get(User, actor)
    notify(db, [db.get(User, payload.get("helper_id"))], "work",
           f"{lead.display_name if lead else 'A colleague'} asked you to help: {fault.reference}",
           payload.get("note") or _where(fault), _link(fault), actor)


def _write_up_added(db, fault, actor, payload):
    notify(db, chiefs(db, fault, payload.get("section")), "review", f"Write-up updated: {fault.reference}",
           payload.get("note") or _where(fault), _link(fault), actor)


def _waiting_handover(db, fault, actor, payload):
    assignment = current_assignment(fault)
    section = assignment.section if assignment else _owner_section(fault)
    notify(db, chiefs(db, fault, section), "review", f"Hand-over to another section waiting for you: {fault.reference}",
           _where(fault), _link(fault), actor)


def _returned(db, fault, actor, payload):
    notify(db, [_assigned(db, fault, payload)], "work", f"Returned to you: {fault.reference}",
           payload.get("comments") or "Your Chief Technician has asked for more work.", _link(fault), actor)


def _write_up_returned(db, fault, actor, payload):
    notify(db, [_assigned(db, fault, payload)], "work", f"Add to your write-up: {fault.reference}",
           payload.get("comments") or "Your Chief Technician asked for more detail.", _link(fault), actor)


def _signed_off(db, fault, actor, payload):
    notify(db, [_assigned(db, fault, payload)], "work", f"Write-up approved: {fault.reference}",
           "Your Chief Technician checked your write-up. Consider turning it into a procedure.", f"/jobs/{fault.id}/procedure", actor)


def _not_fixed(db, fault, actor, payload):
    assignment = db.scalars(select(FaultAssignment).where(FaultAssignment.fault_id == fault.id)
                            .order_by(FaultAssignment.created_at.desc())).first()
    people = [*chiefs(db, fault, assignment.section if assignment else None),
              assignment.assigned_user if assignment and assignment.assigned_user_id else None]
    notify(db, people, "fault", f"Operations says {fault.reference} is not fixed", payload.get("comments") or _where(fault),
           _link(fault), actor)


def _seen_again(db, fault, actor, payload):
    notify(db, chiefs(db, fault), "fault", f"Seen again: {_where(fault)}",
           f"{fault.reference}: this equipment has failed before. Check the history before repeating work.", _link(fault), actor)


def _procedure_submitted(db, fault, actor, payload):
    update = db.get(ProcedureUpdate, payload.get("procedure_update_id")) if payload.get("procedure_update_id") else None
    if not update:
        return
    reviewers = [*_people(db, "technician_ct", update.section), *_people(db, "chief_engineer", update.section)]
    what = "Improvement" if update.version > 1 else "Procedure"
    notify(db, reviewers, "review", f"{what} to review: {update.title}",
           update.change_reason or f"{update.reference} v{update.version} from {fault.reference}.", "/approvals", actor)


def _procedure_reviewed(db, fault, actor, payload):
    update = db.get(ProcedureUpdate, payload.get("procedure_update_id")) if payload.get("procedure_update_id") else None
    if not update:
        return
    author = db.get(User, update.author_id)
    review = db.scalars(select(ProcedureReview).where(ProcedureReview.procedure_update_id == update.id)
                        .order_by(ProcedureReview.created_at.desc())).first()
    comments = review.comments if review else ""
    status = payload.get("status", update.status)
    if status == "CHIEF_APPROVED":
        notify(db, _people(db, "supervisor"), "review", f"Ready to publish: {update.title}",
               f"{update.reference} v{update.version}, technically approved.", "/approvals", actor)
    elif status == "APPROVED":
        notify(db, [author], "knowledge", f"Published: {update.title}",
               "Your procedure is now in the library, with your name on it.", "/library", actor)
    elif status == "CLARIFICATION_REQUESTED":
        notify(db, [author], "review", f"A question about your procedure: {update.title}", comments, _link(fault), actor)
    elif status == "REJECTED":
        notify(db, [author], "review", f"Not accepted: {update.title}", comments, _link(fault), actor)


RULES = {
    "FAULT_REPORTED": _reported,
    "SAFETY_HAZARD_REPORTED": _safety,
    "SECTION_WORK_ALLOCATED": _allocated,
    "FAULT_ASSIGNED": _handed_over,
    "FAULT_ACKNOWLEDGE": _acknowledged,
    "TECHNICAL_COMPLETION_SUBMITTED_FOR_REVIEW": _waiting_signoff,
    "SECTION_ESCALATION_SUBMITTED_FOR_REVIEW": _waiting_handover,
    "TECHNICAL_COMPLETION_RETURNED": _write_up_returned,
    "TAKEN_FROM_OTHER_SECTION": _taken_across,
    "HELPER_ADDED": _helper_added,
    "JOB_NOTE": _job_note,
    "WRITE_UP_ADDED": _write_up_added,
    "SECTION_ESCALATION_RETURNED": _returned,
    "TECHNICAL_COMPLETION_APPROVED": _signed_off,
    "FAULT_OPERATOR_REJECTED_RESTORATION": _not_fixed,
    "REPEAT_FAULT_ROUTED": _seen_again,
    "PROCEDURE_UPDATE_SUBMITTED": _procedure_submitted,
    "PROCEDURE_REVISION_SUBMITTED": _procedure_submitted,
    "PROCEDURE_REVIEWED": _procedure_reviewed,
}


# --- reading -----------------------------------------------------------------------------------------

def payload(item: Notification) -> dict:
    return {"id": item.id, "kind": item.kind, "title": item.title, "body": item.body, "link": item.link,
            "created_at": item.created_at.isoformat(), "read": item.read_at is not None}


def listing(db: Session, user: User, limit: int = 50) -> dict:
    rows = db.scalars(select(Notification).where(Notification.user_id == user.id)
                      .order_by(Notification.created_at.desc()).limit(limit)).all()
    unread = db.query(Notification).filter(Notification.user_id == user.id, Notification.read_at.is_(None)).count()
    return {"unread": unread, "items": [payload(item) for item in rows]}
