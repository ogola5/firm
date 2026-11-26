"""'Needs you now': one list per person, in priority order, each item with one button.

Built from the same rules as the rest of the app (my jobs, the chief's workspace, escalations,
procedure reviews, Operations confirmations). Safety first, then what is blocking someone else.
"""
from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Fault, FaultEvent, ProcedureUpdate, User
from app.services.access import INVESTIGATION_ROLES, role_key

# Lower is more urgent.
SAFETY, BLOCKING, YOURS, WRITE_UP, REVIEW, KNOWLEDGE = 0, 1, 2, 3, 4, 5


def _where(item: dict) -> str:
    return f"{item.get('equipment_tag', '')} · {item.get('symptom', '')}".strip(" ·")


def _fault_link(fault_id: str) -> str:
    return f"/faults?mode=history&fault={fault_id}"


def needs_you(db: Session, user: User) -> list[dict]:
    key = role_key(user)
    items: list[dict] = []

    def add(priority: int, kind: str, title: str, detail: str, link: str, action: str, safety: bool = False, ref: str = ""):
        items.append({"priority": SAFETY if safety else priority, "kind": kind, "title": title, "detail": detail, "link": link,
                      "action": action, "safety": safety, "reference": ref})

    if key in INVESTIGATION_ROLES:
        from app.services.jobs import my_jobs
        jobs = my_jobs(db, user)
        for job in jobs["available"]:
            add(YOURS, "fault", f"New fault: {_where(job)}", "Nobody has taken it yet.", _fault_link(job["fault_id"]), "Open",
                job["safety_hazard"], job["reference"])
        for job in jobs["assigned"]:
            add(YOURS, "work", f"Given to you: {_where(job)}", "Take it, print the job card and go.", f"/jobs/{job['fault_id']}/card",
                "Job card", job["safety_hazard"], job["reference"])
        for job in jobs["to_write_up"]:
            add(WRITE_UP, "work", f"Write up your visit: {_where(job)}", "While it is fresh: what you found and what you did.",
                f"/jobs/{job['fault_id']}/write-up", "Write up", job["safety_hazard"], job["reference"])
        for job in jobs["procedure_ready"][:3]:
            add(KNOWLEDGE, "knowledge", f"Turn your fix into a procedure: {_where(job)}", "So the next person finds it.",
                f"/jobs/{job['fault_id']}/procedure", "Write it", False, job["reference"])

    if key == "technician_ct":
        from app.routers.team import chief_workspace
        workspace = chief_workspace(user, db)
        for record in workspace["faults"]:
            safety = record["severity"].casefold() == "critical" and record["status"] not in ("RESTORED", "CLOSED")
            if record["awaiting_review"]:
                add(BLOCKING, "review", f"Waiting for your sign-off: {_where(record)}", "Check the write-up, then sign off or send back.",
                    _fault_link(record["id"]), "Review", safety, record["reference"])
            elif record["awaiting_assignment"]:
                add(BLOCKING, "work", f"Give it to a technician: {_where(record)}", "New work for your section.",
                    _fault_link(record["id"]), "Allocate", safety, record["reference"])
            elif record["overdue"]:
                add(YOURS, "work", f"Past its response time: {_where(record)}",
                    f"With {record['assigned_user_name'] or 'nobody yet'}.", _fault_link(record["id"]), "Check", safety, record["reference"])

    if key in ("senior_engineer", "chief_engineer"):
        from app.services import escalation
        guided = set(db.scalars(select(FaultEvent.fault_id).where(FaultEvent.event_type == "ESCALATION_GUIDANCE",
                                                                  FaultEvent.actor_id == user.id)))
        for fault in escalation.queue(db, user):
            if fault.id in guided:
                continue  # this person has already given guidance
            tag = fault.equipment.tag if fault.equipment_confirmed and fault.equipment else fault.reported_equipment_text
            add(BLOCKING, "escalation", f"Escalated to you: {tag} · {fault.symptom}", fault.escalation_reason,
                _fault_link(fault.id), "Guide", bool(fault.safety_hazard), fault.reference)

    if key in ("technician_ct", "chief_engineer", "supervisor"):
        status = "CHIEF_APPROVED" if key == "supervisor" else "SUBMITTED"
        query = select(ProcedureUpdate).where(ProcedureUpdate.status == status)
        if key != "supervisor":
            query = query.where(ProcedureUpdate.section == user.section)
        waiting = len(db.scalars(query).all())
        if waiting:
            add(REVIEW, "review", f"{waiting} procedure(s) to {'publish' if key == 'supervisor' else 'review'}",
                "A colleague's fix, waiting for you before others can use it.", "/approvals", "Review")

    if key == "operations":
        for fault in db.scalars(select(Fault).where(Fault.reporter_id == user.id, Fault.status == "RESTORED")
                                .order_by(Fault.restored_at)):
            tag = fault.equipment.tag if fault.equipment_confirmed and fault.equipment else fault.reported_equipment_text
            add(BLOCKING, "fault", f"Is it working? {tag} · {fault.symptom}", "Maintenance says it is fixed. Check and confirm.",
                _fault_link(fault.id), "Confirm", False, fault.reference)

    return sorted(items, key=lambda item: item["priority"])
