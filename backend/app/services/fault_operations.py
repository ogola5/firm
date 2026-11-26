"""Fault operations shared by the REST routes and offline-event synchronisation.

Functions here enforce every permission and workflow rule but never commit:
the caller owns the transaction. They raise HTTPException for rule
violations; the sync applier maps 409 to CONFLICT and other 4xx to REJECTED.
"""
from __future__ import annotations

import json
import uuid
from datetime import datetime, timedelta

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import (
    Diagnosis, DrawingDifference, Equipment, Fault, FaultAssignment, FaultEvent, Intervention, User, utc_datetime, utcnow,
)
from app.schemas import DiagnosisCreate, FaultCreate, InterventionCreate, VisitCreate
from app.services import escalation
from app.services.report_answers import clean_details
from app.services.catalogue import ACTION_TYPES, CAUSE_CATEGORIES, check_choice
from app.services.drawings import find_drawing_id
from app.services.access import (
    INVESTIGATION_ROLES, SECTIONS, current_assignment, is_helper, require_current_assignment,
    require_equipment_scope, require_fault_scope, require_roles, role_key,
)
from app.services.audit import add_event

REPORTING_ROLES = (
    "operations", "systems_automation", "technician_st", "technician_pt", "technician_ct",
    "assistant_engineer", "engineer", "senior_engineer", "chief_engineer", "maintenance_manager",
    "general_manager_om", "supervisor", "system_administrator",
)
SECTION_TECHNICAL_ROLES = (
    "technician_st", "technician_pt", "technician_ct", "assistant_engineer",
    "engineer", "senior_engineer", "chief_engineer",
)
FAULT_ACTION_ROLES = {
    "acknowledge": (*INVESTIGATION_ROLES, "maintenance_manager", "general_manager_om", "supervisor", "system_administrator"),
    "on_site": (*INVESTIGATION_ROLES, "maintenance_manager", "general_manager_om", "supervisor", "system_administrator"),
    "diagnose": (*INVESTIGATION_ROLES, "maintenance_manager", "general_manager_om", "supervisor", "system_administrator"),
    "restore": (*INVESTIGATION_ROLES, "maintenance_manager", "general_manager_om", "supervisor", "system_administrator"),
    "close": ("chief_engineer", "maintenance_manager", "general_manager_om", "supervisor", "system_administrator"),
}


def client_record_id(db: Session, model: type, value: str | None) -> str:
    """Accept a client-generated UUID for a record created offline, or make one."""
    if value is None:
        return str(uuid.uuid4())
    try:
        normalised = str(uuid.UUID(value))
    except (ValueError, AttributeError, TypeError) as exc:
        raise HTTPException(status_code=422, detail="Client record identifiers must be UUIDs") from exc
    if db.get(model, normalised):
        raise HTTPException(status_code=409, detail="A record with this client identifier already exists")
    return normalised


CLOCK_SKEW = timedelta(minutes=5)


def check_past_time(value: datetime, *, earliest: datetime, label: str) -> datetime:
    """A time a person entered from memory or notes: not in the future, not before `earliest`."""
    moment = utc_datetime(value)
    if moment > utcnow() + CLOCK_SKEW:
        raise HTTPException(status_code=422, detail=f"{label} is in the future")
    if moment < utc_datetime(earliest):
        raise HTTPException(status_code=422, detail=f"{label} is earlier than is possible for this job")
    return moment


def get_fault_in_scope(db: Session, user: User, fault_id: str) -> Fault:
    fault = db.get(Fault, fault_id)
    if not fault:
        raise HTTPException(status_code=404, detail="Fault not found")
    require_fault_scope(user, fault)
    return fault


def next_fault_reference(db: Session) -> str:
    references = db.scalars(select(Fault.reference).where(Fault.reference.like("KPC-DMO-%"))).all()
    numbers = [int(ref.rpartition("-")[2]) for ref in references if ref.rpartition("-")[2].isdigit()]
    return f"KPC-DMO-{max(numbers, default=0) + 1:05d}"


def report_fault(db: Session, user: User, req: FaultCreate, fault_id: str | None = None) -> dict:
    require_roles(user, *REPORTING_ROLES)
    if not req.symptom.strip():
        raise HTTPException(status_code=422, detail="Describe what was observed")
    if not req.operational_impact.strip():
        raise HTTPException(status_code=422, detail="Describe the immediate effect on operation")
    candidate = db.get(Equipment, req.equipment_id) if req.equipment_id else None
    if req.equipment_id and not candidate:
        raise HTTPException(status_code=404, detail="Equipment not found")
    if candidate and candidate.tag.startswith("UNCONFIRMED-"):
        raise HTTPException(status_code=422, detail="Select a real equipment candidate or report the asset as unconfirmed")
    if candidate:
        require_equipment_scope(user, candidate)
    confirmed_equipment = candidate if req.equipment_confirmed else None
    if not confirmed_equipment and not (
        req.reported_equipment_text.strip() or req.reported_location.strip() or candidate
    ):
        raise HTTPException(status_code=422, detail="Provide an equipment description or a known location")

    unconfirmed = confirmed_equipment is None
    # Straight to the section that should come: the one the reporter chose, else the equipment's own
    # section. Systems Automation only when nobody knows which equipment or section it is.
    send_to = req.send_to.strip()
    if send_to and send_to not in SECTIONS:
        raise HTTPException(status_code=422, detail="Choose who should come: " + ", ".join(SECTIONS))
    if confirmed_equipment:
        default_section = confirmed_equipment.section
    elif role_key(user) in SECTION_TECHNICAL_ROLES and user.section in SECTIONS:
        default_section = user.section
    else:
        default_section = "Systems Automation"
    assigned_section = send_to or default_section
    if send_to and send_to != default_section:
        routing = "REPORTER_CHOSE"
    elif not confirmed_equipment and assigned_section == "Systems Automation":
        routing = "SYSTEMS_AUTOMATION_FIRST"
    else:
        routing = "DIRECT_TO_SECTION"
    if confirmed_equipment:
        selected_equipment = confirmed_equipment
        equipment_id = confirmed_equipment.id
    else:
        equipment_id = f"EQ-UNCONFIRMED-{assigned_section.lower().replace(' ', '-')}"
        selected_equipment = db.get(Equipment, equipment_id)
        if not selected_equipment:
            raise HTTPException(status_code=500, detail="Unconfirmed-asset routing is not configured")
    observed_at = (
        check_past_time(req.observed_at, earliest=utcnow() - timedelta(days=7), label="The time you saw it")
        if req.observed_at else None
    )

    reported_equipment_text = req.reported_equipment_text.strip()
    if not reported_equipment_text and candidate and unconfirmed:
        reported_equipment_text = f"{candidate.tag} — {candidate.name}"
    previous_recent: list[Fault] = []
    if confirmed_equipment:
        previous_recent = list(db.scalars(
            select(Fault)
            .where(
                Fault.equipment_id == equipment_id,
                Fault.equipment_confirmed == 1,
                Fault.symptom == req.symptom,
                Fault.created_at >= utcnow() - timedelta(days=90),
            )
            .order_by(Fault.created_at.desc())
            .limit(10)
        ).all())
    repeat_count = len(previous_recent)
    fault = Fault(
        id=client_record_id(db, Fault, fault_id),
        reference=next_fault_reference(db),
        equipment_id=equipment_id,
        reporter_id=user.id,
        category=req.category,
        symptom=req.symptom,
        # A safety or environment hazard is always Critical, whatever the effect on operation.
        severity="Critical" if req.safety_hazard else req.severity,
        safety_hazard=int(req.safety_hazard),
        report_details=clean_details(req.report_details),
        callback=req.callback.strip(),
        description=req.description,
        operational_impact=req.operational_impact,
        equipment_confirmed=0 if unconfirmed else 1,
        reported_equipment_text=reported_equipment_text,
        reported_location=req.reported_location.strip(),
        raised_by_text=req.reported_on_behalf_of.strip(),
        operating_conditions=req.operating_conditions.strip(),
        suggested_equipment_id=candidate.id if candidate and unconfirmed else None,
        assigned_section=assigned_section,
        status="ASSIGNED",
        observed_at=observed_at,
        seen_via=req.seen_via,
    )
    db.add(fault)
    db.flush()
    initial_assignment = FaultAssignment(
        id=str(uuid.uuid4()),
        fault_id=fault.id,
        section=assigned_section,
        assigned_by_id=user.id,
        reason="Initial response to reported breakdown",
    )
    db.add(initial_assignment)
    add_event(db, fault.id, "FAULT_REPORTED", user.id, req.model_dump())
    if req.safety_hazard:
        add_event(db, fault.id, "SAFETY_HAZARD_REPORTED", user.id, {"note": "Reporter says someone or something is at risk."})
    db.flush()
    # Came back soon after a fix -> Chief Engineer; safety -> Senior Engineer (services/escalation.py).
    escalation.on_report(db, fault)
    add_event(db, fault.id, "FAULT_ASSIGNED", user.id, {
        "assignment_id": initial_assignment.id,
        "assigned_section": assigned_section,
        "suggested_section": selected_equipment.section if confirmed_equipment else assigned_section,
        "routing_strategy": routing,
        "reason": initial_assignment.reason,
    })
    if repeat_count:
        last_fixed = previous_recent[0].restored_at or previous_recent[0].created_at
        fixer_name = ""
        restoration = db.scalar(
            select(FaultEvent)
            .where(FaultEvent.fault_id == previous_recent[0].id, FaultEvent.event_type == "FAULT_RESTORE")
            .order_by(FaultEvent.created_at.desc())
            .limit(1)
        )
        if restoration:
            fixer = db.get(User, restoration.actor_id)
            fixer_name = fixer.display_name if fixer else ""
        add_event(db, fault.id, "REPEAT_FAULT_ROUTED", user.id, {
            "repeat_count": repeat_count,
            "window_days": 90,
            "assigned_section": assigned_section,
            "asset_owner_section": selected_equipment.section,
            "triage_skipped": False,
            "last_fixed_at": last_fixed.isoformat(),
            "fixed_by": fixer_name,
        })
    return {
        "id": fault.id,
        "reference": fault.reference,
        "status": fault.status,
        "repeat_fault": repeat_count > 0,
        "repeat_count": repeat_count,
        "assigned_section": fault.assigned_section,
        "triage_skipped": False,
        "seen_before_message": (
            f"SEEN BEFORE: Same fault {repeat_count} time(s) in 90 days."
            f" Sent to {assigned_section}; prior findings remain linked to this report."
            if repeat_count else ""
        ),
        "active_assignment_id": initial_assignment.id,
        "equipment_confirmed": not unconfirmed,
        "asset_confirmation_required": unconfirmed,
        "asset_confirmation_message": (
            "The equipment is not confirmed yet. Whoever takes the job confirms it first."
            if unconfirmed else ""
        ),
    }


def fault_action(db: Session, user: User, fault_id: str, action: str) -> dict:
    if action not in FAULT_ACTION_ROLES:
        raise HTTPException(status_code=400, detail="Unknown fault action")
    require_roles(user, *FAULT_ACTION_ROLES[action])
    fault = get_fault_in_scope(db, user, fault_id)
    if action == "close":
        raise HTTPException(status_code=409, detail="Operations must confirm restoration before the breakdown can close")
    if not fault.equipment_confirmed:
        raise HTTPException(status_code=409, detail="Confirm the physical equipment before starting technical work")
    assignment = current_assignment(fault)
    if assignment:
        require_current_assignment(user, fault)
    else:
        section = fault.assigned_section or (fault.equipment.section if fault.equipment else "")
        assignment = FaultAssignment(
            id=str(uuid.uuid4()),
            fault_id=fault.id,
            section=section,
            assigned_by_id=user.id,
            reason="Existing fault section assignment",
            created_at=fault.created_at,
        )
        db.add(assignment)
        fault.assigned_section = section
    if assignment.escalation_status == "PENDING":
        raise HTTPException(status_code=409, detail="This assignment is awaiting Chief Technician review")
    if action == "restore":
        if not assignment.assigned_user_id:
            raise HTTPException(status_code=409, detail="Take the job first")
        return _working_again(db, user, fault, assignment)
    if action == "acknowledge":
        if assignment.assigned_user_id and assignment.assigned_user_id != user.id:
            raise HTTPException(status_code=409, detail="Already taken")
        take_job(db, user, fault, assignment)
        return {"reference": fault.reference, "status": fault.status, "assigned_section": assignment.section}
    if not assignment.assigned_user_id:
        take_job(db, user, fault, assignment)  # on site, or found the cause, means they took it
    transitions = {"on_site": "ON_SITE", "diagnose": "DIAGNOSED"}
    fault.status = transitions[action]
    assignment.status = "IN_PROGRESS"
    add_event(db, fault.id, f"FAULT_{action.upper()}", user.id, {"assignment_id": assignment.id})
    return {"reference": fault.reference, "status": fault.status}


def take_job(db: Session, user: User, fault: Fault, assignment: FaultAssignment, *, at: datetime | None = None,
             implied: bool = False) -> None:
    """Open pickup: the first person free takes it, from any section. The job moves to their section,
    so their own Chief Technician checks the write-up."""
    if role_key(user) == "technician_ct":
        raise HTTPException(status_code=403, detail="Chief Technicians give jobs to people; use Allocate")
    moment = at or utcnow()
    if user.section in SECTIONS and assignment.section != user.section:
        add_event(db, fault.id, "TAKEN_FROM_OTHER_SECTION", user.id, {
            "assignment_id": assignment.id, "from_section": assignment.section, "to_section": user.section,
        }, created_at=moment)
        assignment.section = user.section
        fault.assigned_section = user.section
    assignment.assigned_user_id = user.id
    assignment.status = "ACKNOWLEDGED"
    assignment.acknowledged_at = moment
    fault.assigned_user_id = user.id
    fault.status = "ACKNOWLEDGED"
    if not db.scalar(select(FaultEvent.id).where(FaultEvent.fault_id == fault.id, FaultEvent.event_type == "FAULT_TRIAGED").limit(1)):
        add_event(db, fault.id, "FAULT_TRIAGED", user.id, {
            "assignment_id": assignment.id, "triage_method": "Taken straight from the workshop list",
        }, created_at=moment)
    payload = {"assignment_id": assignment.id, "section": assignment.section}
    if implied:
        payload.update(implied_by_visit=True, recorded_at=utcnow().isoformat())
    add_event(db, fault.id, "FAULT_ACKNOWLEDGE", user.id, payload, created_at=moment)


def _working_again(db: Session, user: User, fault: Fault, assignment: FaultAssignment) -> dict:
    """It works: the fault is restored now. Operations confirms it; the Chief Technician checks the
    write-up afterwards, without holding up the restoration."""
    db.flush()
    successful_intervention = db.scalar(
        select(Intervention.id).where(Intervention.assignment_id == assignment.id, Intervention.outcome == "SUCCESS").limit(1)
    )
    if not successful_intervention:
        raise HTTPException(status_code=409, detail="Record what worked before saying it is working again")
    now = utcnow()
    restored_at = utc_datetime(assignment.back_in_service_at) if assignment.back_in_service_at else now
    assignment.status = "RESTORED"
    assignment.completed_at = now
    assignment.completion_review_status = "PENDING"
    fault.status = "RESTORED"
    fault.restored_at = restored_at
    add_event(db, fault.id, "FAULT_RESTORE", user.id, {"assignment_id": assignment.id, "review": "after"}, created_at=restored_at)
    add_event(db, fault.id, "TECHNICAL_COMPLETION_SUBMITTED_FOR_REVIEW", user.id, {
        "assignment_id": assignment.id, "section": assignment.section,
    })
    return {"reference": fault.reference, "status": fault.status, "completion_review_status": "PENDING"}


def _active_investigation_assignment(db: Session, user: User, fault_id: str) -> tuple[Fault, FaultAssignment]:
    require_roles(user, *INVESTIGATION_ROLES)
    fault = get_fault_in_scope(db, user, fault_id)
    assignment = current_assignment(fault)
    if not assignment:
        raise HTTPException(status_code=409, detail="There is no active section assignment for this breakdown")
    require_current_assignment(user, fault)
    if assignment.escalation_status == "PENDING":
        raise HTTPException(status_code=409, detail="This assignment is awaiting Chief Technician review")
    return fault, assignment


def record_diagnosis(
    db: Session, user: User, fault_id: str, req: DiagnosisCreate, diagnosis_id: str | None = None,
) -> dict:
    fault, assignment = _active_investigation_assignment(db, user, fault_id)
    if not req.possible_cause.strip() or not req.diagnostic_method.strip():
        raise HTTPException(status_code=422, detail="A possible cause and diagnostic method are required")
    if req.confidence is not None and not 0 <= req.confidence <= 1:
        raise HTTPException(status_code=422, detail="Confidence must be between 0 and 1")
    if req.risk_level not in ("Normal", "Caution", "High"):
        raise HTTPException(status_code=422, detail="Risk level must be Normal, Caution or High")
    if req.risk_level == "High" and not req.fix_summary.strip():
        raise HTTPException(status_code=422, detail="A fix summary is required for a high-risk diagnosis")
    diagnosis = Diagnosis(
        id=client_record_id(db, Diagnosis, diagnosis_id),
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
        created_at=utcnow(),
    )
    db.add(diagnosis)
    fault.status = "DIAGNOSED"
    add_event(db, fault.id, "DIAGNOSIS_RECORDED", user.id, {**req.model_dump(), "diagnosis_id": diagnosis.id})
    return {"id": diagnosis.id, "status": diagnosis.verification_status, "created_at": diagnosis.created_at.isoformat()}


def record_intervention(
    db: Session, user: User, fault_id: str, req: InterventionCreate, intervention_id: str | None = None,
) -> dict:
    fault, assignment = _active_investigation_assignment(db, user, fault_id)
    if req.outcome not in ("SUCCESS", "FAILED", "IN_PROGRESS"):
        raise HTTPException(status_code=422, detail="Outcome must be SUCCESS, FAILED or IN_PROGRESS")
    if not req.corrective_action.strip():
        raise HTTPException(status_code=422, detail="A corrective action is required")
    if req.diagnosis_id:
        db.flush()
        diagnosis = db.get(Diagnosis, req.diagnosis_id)
        if not diagnosis or diagnosis.fault_id != fault.id:
            raise HTTPException(status_code=422, detail="Diagnosis must belong to this fault")
        if req.outcome == "SUCCESS":
            diagnosis.verification_status = "CONFIRMED"
    intervention = Intervention(
        id=client_record_id(db, Intervention, intervention_id),
        fault_id=fault.id,
        assignment_id=assignment.id,
        diagnosis_id=req.diagnosis_id,
        actor_id=user.id,
        corrective_action=req.corrective_action.strip(),
        tools_materials=req.tools_materials.strip(),
        outcome=req.outcome,
        notes=req.notes.strip(),
        created_at=utcnow(),
    )
    db.add(intervention)
    add_event(db, fault.id, f"INTERVENTION_{req.outcome}", user.id, {**req.model_dump(), "intervention_id": intervention.id})
    return {"id": intervention.id, "outcome": intervention.outcome, "created_at": intervention.created_at.isoformat()}


def add_operator_update(db: Session, user: User, fault_id: str, note: str) -> dict:
    require_roles(user, "operations")
    fault = get_fault_in_scope(db, user, fault_id)
    if fault.status == "CLOSED":
        raise HTTPException(status_code=409, detail="A closed breakdown cannot receive further operator updates")
    note = note.strip()
    if not note:
        raise HTTPException(status_code=422, detail="Enter an update for the responding team")
    add_event(db, fault.id, "OPERATOR_UPDATE", user.id, {"note": note})
    return {"fault_id": fault.id, "status": fault.status}


VISIT_OUTCOMES = {"worked": "SUCCESS", "failed": "FAILED", "partly": "IN_PROGRESS"}


def record_visit(db: Session, user: User, fault_id: str, req: VisitCreate) -> dict:
    """Record one site visit written up afterwards: arrival, cause, every attempt and
    its result, and when the equipment was back in service.

    Times are the ones the technician entered from their notes. Timeline entries
    carry those times, and `recorded_at` keeps when it was typed, so response and
    restoration measures reflect the work rather than the paperwork.
    """
    fault, assignment = _active_investigation_assignment(db, user, fault_id)
    if assignment.assigned_user_id and assignment.assigned_user_id != user.id and not is_helper(assignment, user.id):
        raise HTTPException(status_code=409, detail="This job is allocated to someone else")
    found = req.found.strip()
    attempts = [item for item in req.attempts if item.action.strip()]
    if not found:
        raise HTTPException(status_code=422, detail="Say what you found")
    if not attempts:
        raise HTTPException(status_code=422, detail="Say what you did")
    check_choice(req.cause_category, CAUSE_CATEGORIES, "the kind of cause")
    for attempt in attempts:
        check_choice(attempt.action_type, ACTION_TYPES, "what kind of action")
    difference = req.drawing_difference
    if difference and not difference.description.strip():
        raise HTTPException(status_code=422, detail="Say what differs from the drawing")
    if difference and not fault.equipment_confirmed:
        raise HTTPException(status_code=422, detail="Identify the equipment before recording a drawing difference")

    reported_at = utc_datetime(fault.created_at)
    earliest = utc_datetime(fault.observed_at) if fault.observed_at else reported_at
    on_site_at = check_past_time(req.on_site_at, earliest=earliest - CLOCK_SKEW, label="Arrival on site")
    back_at = None
    if req.back_in_service_at:
        back_at = check_past_time(req.back_in_service_at, earliest=on_site_at, label="Back in service")
    fixed = any(item.result == "worked" for item in attempts)
    if req.request_signoff and not (fixed and back_at):
        raise HTTPException(status_code=422, detail="Sign-off needs a step that worked and the back-in-service time")

    recorded_at = utcnow()
    if assignment.status == "OPEN":
        # Went straight out (the phone rang) without pressing "Take this job". Arriving on site is
        # the latest they can have taken it; record it as implied.
        take_job(db, user, fault, assignment, at=on_site_at, implied=True)
    already_on_site = db.scalar(
        select(FaultEvent.id).where(FaultEvent.fault_id == fault.id, FaultEvent.event_type == "FAULT_ON_SITE").limit(1)
    )
    if not already_on_site:
        add_event(db, fault.id, "FAULT_ON_SITE", user.id, {
            "assignment_id": assignment.id, "recorded_at": recorded_at.isoformat(),
        }, created_at=on_site_at)

    diagnosis = Diagnosis(
        id=str(uuid.uuid4()),
        fault_id=fault.id,
        assignment_id=assignment.id,
        author_id=user.id,
        possible_cause=found,
        diagnostic_method="Site visit",
        observations=req.notes.strip(),
        test_results="",
        verification_status="CONFIRMED" if fixed else "UNVERIFIED",
        workaround=int(req.workaround),
        cause_category=req.cause_category,
        created_at=on_site_at,
    )
    db.add(diagnosis)
    db.flush()
    add_event(db, fault.id, "DIAGNOSIS_RECORDED", user.id, {
        "diagnosis_id": diagnosis.id, "possible_cause": found, "recorded_at": recorded_at.isoformat(),
    }, created_at=on_site_at)

    intervention_ids = []
    for index, attempt in enumerate(attempts):
        # Keep the attempts in the order they were made.
        done_at = on_site_at + timedelta(seconds=index + 1)
        intervention = Intervention(
            id=str(uuid.uuid4()),
            fault_id=fault.id,
            assignment_id=assignment.id,
            diagnosis_id=diagnosis.id,
            actor_id=user.id,
            corrective_action=attempt.action.strip(),
            tools_materials=req.parts.strip() if attempt.result == "worked" else "",
            outcome=VISIT_OUTCOMES[attempt.result],
            notes="",
            action_type=attempt.action_type,
            created_at=done_at,
        )
        db.add(intervention)
        intervention_ids.append(intervention.id)
        add_event(db, fault.id, f"INTERVENTION_{intervention.outcome}", user.id, {
            "intervention_id": intervention.id, "corrective_action": intervention.corrective_action,
            "recorded_at": recorded_at.isoformat(),
        }, created_at=done_at)

    difference_id = None
    if difference:
        # Waits for the section chief to verify before it is shown as fact on job cards.
        difference_id = str(uuid.uuid4())
        db.add(DrawingDifference(
            id=difference_id, equipment_id=fault.equipment_id, drawing_id=find_drawing_id(db, difference.drawing_number),
            drawing_number_text=difference.drawing_number.strip(), description=difference.description.strip(),
            permanence=difference.permanence, fault_id=fault.id, reported_by_id=user.id, reported_at=on_site_at,
        ))
        add_event(db, fault.id, "DRAWING_DIFFERENCE_REPORTED", user.id, {
            "difference_id": difference_id, "description": difference.description.strip(),
            "recorded_at": recorded_at.isoformat(),
        }, created_at=on_site_at)

    fault.status = "DIAGNOSED"
    assignment.status = "IN_PROGRESS"
    if fixed and back_at:
        assignment.back_in_service_at = back_at
    add_event(db, fault.id, "VISIT_RECORDED", user.id, {
        "assignment_id": assignment.id,
        "on_site_at": on_site_at.isoformat(),
        "back_in_service_at": back_at.isoformat() if back_at else None,
        "found": found,
        "cause_category": req.cause_category,
        "attempts": [{"action": item.action.strip(), "result": item.result, "action_type": item.action_type} for item in attempts],
        "drawing_difference_id": difference_id,
        "parts": req.parts.strip(),
        "workaround": req.workaround,
        "recorded_at": recorded_at.isoformat(),
    }, created_at=recorded_at)
    db.flush()

    result = {
        "fault_id": fault.id,
        "reference": fault.reference,
        "diagnosis_id": diagnosis.id,
        "intervention_ids": intervention_ids,
        "fixed": fixed,
        "status": fault.status,
        "on_site_at": on_site_at.isoformat(),
        "back_in_service_at": back_at.isoformat() if back_at else None,
    }
    if req.request_signoff:
        result.update(fault_action(db, user, fault.id, "restore"))
    return result
