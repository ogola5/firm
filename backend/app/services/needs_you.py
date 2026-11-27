"""'Needs you now': one list per person, in priority order, each item with one button.

Built from the same rules as the rest of the app (my jobs, the chief's workspace, escalations,
procedure reviews, Operations confirmations). Safety first, then what is blocking someone else.
"""
from __future__ import annotations

from datetime import datetime, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models import Fault, FaultEvent, ProcedureUpdate, User, utc_datetime, utcnow
from app.services.access import INVESTIGATION_ROLES, role_key

# Lower is more urgent.
SAFETY, BLOCKING, YOURS, WRITE_UP, REVIEW, KNOWLEDGE = 0, 1, 2, 3, 4, 5
def other_section_after() -> timedelta:
    """A fault nobody has taken for this long is shown to other sections and to the Chief Technician
    (Rules in the admin console)."""
    return timedelta(minutes=settings.untaken_alert_minutes)


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
        now = utcnow()
        for job in jobs["available"]:
            # Open pickup. Your section's new faults; other sections' only once nobody has taken them for a while.
            waited = now - utc_datetime(datetime.fromisoformat(job["assigned_at"])) if job["assigned_at"] else timedelta(0)
            if job["own_section"]:
                add(YOURS, "fault", f"New fault: {_where(job)}", "Nobody has taken it yet. First to take it gets it.",
                    _fault_link(job["fault_id"]), "Open", job["safety_hazard"], job["reference"])
            elif waited >= other_section_after() or job["safety_hazard"]:
                add(WRITE_UP, "fault", f"Still not taken ({job['section']}): {_where(job)}",
                    f"Waiting {int(waited.total_seconds() // 60)} min. Take it if you are free.",
                    _fault_link(job["fault_id"]), "Open", job["safety_hazard"], job["reference"])
        for job in jobs["returned"]:
            add(YOURS, "work", f"Add to your write-up: {_where(job)}", job.get("review_comments") or "Your Chief Technician asked for more detail.",
                _fault_link(job["fault_id"]), "Add", False, job["reference"])
        for job in jobs["helping"]:
            add(YOURS, "work", f"Helping {job['helping'] or 'a colleague'}: {_where(job)}", "You were called in to help on this job.",
                _fault_link(job["fault_id"]), "Open", job["safety_hazard"], job["reference"])
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
            if record["handover_review"]:
                add(BLOCKING, "review", f"Hand-over waiting for you: {_where(record)}", "Approve it, or send it back with instructions.",
                    _fault_link(record["id"]), "Review", safety, record["reference"])
            elif record["write_up_to_check"]:
                add(REVIEW, "review", f"Check the write-up: {_where(record)}", "It is already working again. Approve it, or ask for more detail.",
                    _fault_link(record["id"]), "Check", False, record["reference"])
            elif record["awaiting_assignment"] and record["untaken_minutes"] >= other_section_after().total_seconds() // 60:
                add(BLOCKING, "work", f"Nobody has taken it: {_where(record)}", f"Waiting {record['untaken_minutes']} min. Give it to someone.",
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

    # One line per fault: the most urgent reason (e.g. "Escalated to you" rather than also "New fault").
    best: dict[str, dict] = {}
    for item in sorted(items, key=lambda item: item["priority"]):
        best.setdefault(item["reference"] or item["link"], item)
    return sorted(best.values(), key=lambda item: item["priority"])
