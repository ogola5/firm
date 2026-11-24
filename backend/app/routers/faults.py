from __future__ import annotations

from datetime import timedelta
from fastapi import Depends
from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session
import json
import uuid
from fastapi import APIRouter

from app.db import db_dep
from app.deps import current_user
from app.models import Diagnosis, Equipment, Fault, FaultAssignment, FaultEvent, Intervention, KnowledgeEntry, KnowledgeReuse, KnowledgeReuseOutcome, ProcedureReview, ProcedureUpdate, User, utc_datetime, utcnow
from app.schemas import FaultCreate
from app.services.access import ACTIVE_ASSIGNMENT_STATUSES, INVESTIGATION_ROLES, current_assignment, require_current_assignment, require_equipment_scope, require_fault_scope, require_roles, role_key
from app.services.audit import add_event
from app.services.procedures import procedure_update_payload

router = APIRouter()

@router.post("/api/v1/faults")
def report_fault(req: FaultCreate, user: User = Depends(current_user), db: Session = Depends(db_dep)):
    require_roles(user, "operations", "systems_automation", "technician_st", "technician_pt", "technician_ct", "assistant_engineer", "engineer", "senior_engineer", "chief_engineer", "maintenance_manager", "general_manager_om", "supervisor", "system_administrator")
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
    if confirmed_equipment:
        selected_equipment = confirmed_equipment
        equipment_id = confirmed_equipment.id
    else:
        technical_roles = (
            "technician_st", "technician_pt", "technician_ct", "assistant_engineer",
            "engineer", "senior_engineer", "chief_engineer",
        )
        placeholder_section = user.section if role_key(user) in technical_roles else "Systems Automation"
        section_slug = placeholder_section.lower().replace(" ", "-")
        equipment_id = f"EQ-UNCONFIRMED-{section_slug}"
        selected_equipment = db.get(Equipment, equipment_id)
        if not selected_equipment:
            raise HTTPException(status_code=500, detail="Unconfirmed-asset routing is not configured")
    assigned_section = "Systems Automation"

    reported_equipment_text = req.reported_equipment_text.strip()
    if not reported_equipment_text and candidate and unconfirmed:
        reported_equipment_text = f"{candidate.tag} — {candidate.name}"
    references = db.scalars(
        select(Fault.reference).where(Fault.reference.like("KPC-DMO-%"))
    ).all()
    sequence_numbers = []
    for reference in references:
        suffix = reference.rpartition("-")[2]
        if suffix.isdigit():
            sequence_numbers.append(int(suffix))
    next_reference_number = max(sequence_numbers, default=0) + 1
    previous_recent = []
    if confirmed_equipment:
        previous_recent = db.scalars(
            select(Fault)
            .where(
                Fault.equipment_id == equipment_id,
                Fault.equipment_confirmed == 1,
                Fault.symptom == req.symptom,
                Fault.created_at >= utcnow() - timedelta(days=90),
            )
            .order_by(Fault.created_at.desc())
            .limit(10)
        ).all()
    repeat_count = len(previous_recent)
    fault = Fault(
        id=str(uuid.uuid4()),
        reference=f"KPC-DMO-{next_reference_number:05d}",
        equipment_id=equipment_id,
        reporter_id=user.id,
        category=req.category,
        symptom=req.symptom,
        severity=req.severity,
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
    add_event(db, fault.id, "FAULT_ASSIGNED", user.id, {
        "assignment_id": initial_assignment.id,
        "assigned_section": assigned_section,
        "suggested_section": selected_equipment.section if confirmed_equipment else "Systems Automation",
        "routing_strategy": "SYSTEMS_AUTOMATION_FIRST",
        "reason": initial_assignment.reason,
    })
    if repeat_count:
        last_fixed = previous_recent[0].restored_at or previous_recent[0].created_at
        fixer_name = ""
        if previous_recent:
            restoration_events = db.scalars(
                select(FaultEvent)
                .where(FaultEvent.fault_id == previous_recent[0].id, FaultEvent.event_type == "FAULT_RESTORE")
                .order_by(FaultEvent.created_at.desc())
                .limit(1)
            ).all()
            if restoration_events:
                fixer = db.get(User, restoration_events[0].actor_id)
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
    db.commit()
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
            f" Sent to Systems Automation first; prior findings remain linked to this report."
            if repeat_count else ""
        ),
        "active_assignment_id": initial_assignment.id,
        "equipment_confirmed": not unconfirmed,
        "asset_confirmation_required": unconfirmed,
        "asset_confirmation_message": (
            "Asset identification is unconfirmed. Systems Automation must confirm the equipment before normal routing."
            if unconfirmed else ""
        ),
    }


@router.get("/api/v1/faults")
def fault_list(
    status_filter: str = "",
    queue: str = "",
    history_scope: str = "",
    search: str = "",
    user: User = Depends(current_user),
    db: Session = Depends(db_dep),
):
    require_roles(user, "operations", "systems_automation", "technician_st", "technician_pt", "technician_ct", "assistant_engineer", "engineer", "senior_engineer", "chief_engineer", "maintenance_manager", "general_manager_om", "supervisor", "system_administrator")
    query = select(Fault).join(Equipment, Fault.equipment_id == Equipment.id).order_by(Fault.created_at.desc())
    if status_filter:
        query = query.where(Fault.status == status_filter)
    if role_key(user) in ("technician_st", "technician_pt", "technician_ct", "assistant_engineer", "engineer", "senior_engineer", "chief_engineer"):
        query = query.where(
            (Fault.assigned_section == user.section)
            | (Equipment.section == user.section)
            | Fault.id.in_(select(FaultAssignment.fault_id).where(FaultAssignment.section == user.section))
        )
    if queue in ("mine", "section_open"):
        query = query.where(Fault.status.notin_(("RESTORED", "CLOSED")))
        if queue == "mine":
            query = query.where(
                (Fault.assigned_user_id == user.id)
                | Fault.id.in_(select(FaultAssignment.fault_id).where(
                    FaultAssignment.assigned_user_id == user.id,
                    FaultAssignment.status.in_(ACTIVE_ASSIGNMENT_STATUSES),
                ))
            )
        elif role_key(user) in ("technician_st", "technician_pt", "technician_ct", "assistant_engineer", "engineer", "senior_engineer", "chief_engineer"):
            query = query.where(
                Fault.id.in_(select(FaultAssignment.fault_id).where(
                    FaultAssignment.section == user.section,
                    FaultAssignment.status.in_(ACTIVE_ASSIGNMENT_STATUSES),
                ))
                | (
                    Fault.id.notin_(select(FaultAssignment.fault_id))
                    & ((Fault.assigned_section == user.section) | (Equipment.section == user.section))
                )
            )
        elif role_key(user) == "systems_automation":
            query = query.where(
                Fault.id.in_(select(FaultAssignment.fault_id).where(
                    FaultAssignment.section == "Systems Automation",
                    FaultAssignment.status.in_(ACTIVE_ASSIGNMENT_STATUSES),
                ))
                | (
                    Fault.id.notin_(select(FaultAssignment.fault_id))
                    & ((Fault.assigned_section == "Systems Automation") | (Equipment.section == "Systems Automation"))
                )
            )
    if history_scope == "reported_by_me":
        query = query.where(Fault.reporter_id == user.id)
    elif history_scope == "worked_by_me":
        query = query.where(
            (Fault.assigned_user_id == user.id)
            | Fault.id.in_(select(FaultAssignment.fault_id).where(FaultAssignment.assigned_user_id == user.id))
            | Fault.id.in_(select(FaultEvent.fault_id).where(FaultEvent.actor_id == user.id))
        )
    if search.strip():
        needle = f"%{search.strip()}%"
        query = query.where(
            Fault.reference.ilike(needle)
            | Fault.symptom.ilike(needle)
            | Fault.description.ilike(needle)
            | Fault.reported_equipment_text.ilike(needle)
            | Fault.reported_location.ilike(needle)
            | Equipment.tag.ilike(needle)
            | Equipment.name.ilike(needle)
            | Equipment.location.ilike(needle)
        )
    faults = db.scalars(query.limit(200)).all()
    result = []
    for f in faults:
        suggested = db.get(Equipment, f.suggested_equipment_id) if f.suggested_equipment_id else None
        assignment = current_assignment(f)
        result.append({
            "id": f.id, "reference": f.reference, "equipment_id": f.equipment_id,
            "equipment_tag": f.equipment.tag if f.equipment_confirmed and f.equipment else (
                f.reported_equipment_text or "Asset not identified"
            ),
            "category": f.category, "symptom": f.symptom, "severity": f.severity,
            "status": f.status, "assigned_section": f.assigned_section,
            "equipment_confirmed": bool(f.equipment_confirmed),
            "reported_equipment_text": f.reported_equipment_text,
            "reported_location": f.reported_location,
            "suggested_equipment_tag": suggested.tag if suggested else "",
            "reporter_name": f.reporter.display_name if f.reporter else "",
            "assigned_user_id": f.assigned_user_id,
            "assigned_user_name": f.assigned_user.display_name if f.assigned_user else "",
            "active_assignment_id": assignment.id if assignment else None,
            "active_assignment_section": assignment.section if assignment else "",
            "active_assignment_status": assignment.status if assignment else "",
            "active_assignment_elapsed_minutes": (
                max(0, int((utc_datetime(assignment.completed_at or utcnow()) - utc_datetime(assignment.created_at)).total_seconds() / 60))
                if assignment else None
            ),
            "created_at": f.created_at.isoformat(),
        })
    return result


@router.get("/api/v1/faults/{fault_id}")
def fault_detail(fault_id: str, user: User = Depends(current_user), db: Session = Depends(db_dep)):
    f = db.get(Fault, fault_id)
    if not f:
        raise HTTPException(status_code=404, detail="Fault not found")
    require_fault_scope(user, f)
    return {
        "id": f.id, "reference": f.reference, "equipment_id": f.equipment_id,
        "equipment_tag": f.equipment.tag if f.equipment_confirmed and f.equipment else (
            f.reported_equipment_text or "Asset not identified"
        ),
        "equipment_confirmed": bool(f.equipment_confirmed),
        "reported_equipment_text": f.reported_equipment_text,
        "reported_location": f.reported_location,
        "suggested_equipment_id": f.suggested_equipment_id,
        "category": f.category, "symptom": f.symptom, "severity": f.severity,
        "description": f.description, "operational_impact": f.operational_impact,
        "reported_on_behalf_of": f.raised_by_text, "status": f.status,
        "assigned_section": f.assigned_section, "assigned_user_id": f.assigned_user_id,
        "operating_conditions": f.operating_conditions,
        "closure_remarks": f.closure_remarks,
        "active_assignment_id": current_assignment(f).id if current_assignment(f) else None,
        "created_at": f.created_at.isoformat(),
    }


@router.get("/api/v1/faults/{fault_id}/timeline")
def fault_timeline(fault_id: str, user: User = Depends(current_user), db: Session = Depends(db_dep)):
    fault = db.get(Fault, fault_id)
    if not fault:
        raise HTTPException(status_code=404, detail="Fault not found")
    require_fault_scope(user, fault)
    events = db.scalars(select(FaultEvent).where(FaultEvent.fault_id == fault_id).order_by(FaultEvent.created_at)).all()
    return [{"id": e.id, "event_type": e.event_type, "actor_id": e.actor_id, "payload": e.payload, "created_at": e.created_at.isoformat()} for e in events]


@router.get("/api/v1/faults/{fault_id}/context")
def fault_context(fault_id: str, user: User = Depends(current_user), db: Session = Depends(db_dep)):
    fault = db.get(Fault, fault_id)
    if not fault:
        raise HTTPException(status_code=404, detail="Fault not found")
    require_fault_scope(user, fault)
    equipment = fault.equipment
    timeline = db.scalars(
        select(FaultEvent).where(FaultEvent.fault_id == fault_id).order_by(FaultEvent.created_at)
    ).all()
    actor_ids = {event.actor_id for event in timeline}
    actors = {item.id: item.display_name for item in db.scalars(select(User).where(User.id.in_(actor_ids))).all()} if actor_ids else {}
    diagnoses = db.scalars(
        select(Diagnosis).where(Diagnosis.fault_id == fault_id).order_by(Diagnosis.created_at)
    ).all()
    interventions = db.scalars(
        select(Intervention).where(Intervention.fault_id == fault_id).order_by(Intervention.created_at)
    ).all()
    assignments = fault.assignments
    attachments = fault.attachments
    operator_updates = [
        {
            "id": event.id,
            "event_type": event.event_type,
            "actor_name": actors.get(event.actor_id, event.actor_id),
            "payload": json.loads(event.payload or "{}"),
            "created_at": event.created_at.isoformat(),
        }
        for event in timeline
        if event.event_type in ("OPERATOR_UPDATE", "FAULT_OPERATOR_CONFIRMED", "FAULT_OPERATOR_REJECTED_RESTORATION")
    ]
    current_updates = db.scalars(
        select(ProcedureUpdate).where(ProcedureUpdate.fault_id == fault_id).order_by(ProcedureUpdate.version)
    ).all()
    reuse_records = db.scalars(
        select(KnowledgeReuse).where(KnowledgeReuse.fault_id == fault_id).order_by(KnowledgeReuse.used_at)
    ).all()

    previous_faults = []
    if fault.equipment_confirmed:
        previous_faults = db.scalars(
            select(Fault)
            .where(
                Fault.equipment_id == fault.equipment_id,
                Fault.equipment_confirmed == 1,
                Fault.id != fault_id,
            )
            .order_by(Fault.created_at.desc())
            .limit(10)
        ).all()
    history = []
    for previous in previous_faults:
        prior_diagnoses = db.scalars(
            select(Diagnosis).where(Diagnosis.fault_id == previous.id).order_by(Diagnosis.created_at)
        ).all()
        prior_interventions = db.scalars(
            select(Intervention).where(Intervention.fault_id == previous.id).order_by(Intervention.created_at)
        ).all()
        history.append({
            "id": previous.id,
            "reference": previous.reference,
            "symptom": previous.symptom,
            "description": previous.description,
            "status": previous.status,
            "created_at": previous.created_at.isoformat(),
            "diagnoses": [{"possible_cause": item.possible_cause, "verification_status": item.verification_status} for item in prior_diagnoses],
            "interventions": [{"corrective_action": item.corrective_action, "outcome": item.outcome, "notes": item.notes} for item in prior_interventions],
        })

    applicable_updates = db.scalars(
        select(ProcedureUpdate)
        .join(Fault, ProcedureUpdate.fault_id == Fault.id)
        .where(
            ProcedureUpdate.status == "APPROVED",
            (Fault.equipment_id == fault.equipment_id) | (ProcedureUpdate.observed_symptom.ilike(f"%{fault.symptom}%")),
        )
        .order_by(ProcedureUpdate.version.desc())
        .limit(50)
    ).all()
    latest_approved: dict[str, ProcedureUpdate] = {}
    for item in applicable_updates:
        current = latest_approved.get(item.lineage_id)
        if current is None or item.version > current.version:
            latest_approved[item.lineage_id] = item
    approved_procedures = []
    for item in latest_approved.values():
        author = db.get(User, item.author_id)
        reviews = db.scalars(
            select(ProcedureReview).where(ProcedureReview.procedure_update_id == item.id).order_by(ProcedureReview.created_at)
        ).all()
        approved_procedures.append(procedure_update_payload(item, author, reviews))
    legacy_knowledge = db.scalars(
        select(KnowledgeEntry)
        .where(
            KnowledgeEntry.status == "APPROVED",
            (KnowledgeEntry.equipment_id == fault.equipment_id) | (KnowledgeEntry.symptom.ilike(f"%{fault.symptom}%")),
        )
        .order_by(KnowledgeEntry.updated_at.desc())
        .limit(30)
    ).all()
    ranked_causes: dict[str, dict] = {}
    for prior_fault in previous_faults:
        prior_diagnoses = db.scalars(select(Diagnosis).where(Diagnosis.fault_id == prior_fault.id)).all()
        prior_interventions = db.scalars(select(Intervention).where(Intervention.fault_id == prior_fault.id)).all()
        for prior_diagnosis in prior_diagnoses:
            linked = [
                item for item in prior_interventions
                if item.diagnosis_id == prior_diagnosis.id
            ]
            successful = sum(item.outcome == "SUCCESS" for item in linked)
            failed = sum(item.outcome == "FAILED" for item in linked)
            row = ranked_causes.setdefault(prior_diagnosis.possible_cause, {
                "possible_cause": prior_diagnosis.possible_cause,
                "quick_check": prior_diagnosis.quick_check,
                "fix": prior_diagnosis.fix_summary,
                "confirmed_count": 0,
                "failed_count": 0,
                "workaround_count": 0,
                "recurrence_count": 0,
                "risk_level": prior_diagnosis.risk_level,
                "supervisor_required": prior_diagnosis.risk_level in ("Caution", "High"),
            })
            row["confirmed_count"] += successful
            row["failed_count"] += failed
            row["workaround_count"] += int(bool(prior_diagnosis.workaround))
            row["recurrence_count"] += 1
    ranked_cause_list = sorted(
        ranked_causes.values(),
        key=lambda row: (-row["confirmed_count"], row["failed_count"], row["possible_cause"]),
    )
    for ranked in ranked_cause_list:
        ranked["recurrence_warning"] = (
            ranked["workaround_count"] > 0
            and ranked["recurrence_count"] > ranked["confirmed_count"]
        )

    updates = []
    for item in current_updates:
        author = db.get(User, item.author_id)
        reviews = db.scalars(
            select(ProcedureReview).where(ProcedureReview.procedure_update_id == item.id).order_by(ProcedureReview.created_at)
        ).all()
        updates.append(procedure_update_payload(item, author, reviews))
    return {
        "fault": {
            "id": fault.id,
            "reference": fault.reference,
            "equipment_id": fault.equipment_id,
            "equipment_tag": equipment.tag if fault.equipment_confirmed and equipment else (
                fault.reported_equipment_text or "Asset not identified"
            ),
            "equipment_name": equipment.name if fault.equipment_confirmed and equipment else "Asset not yet identified",
            "equipment_confirmed": bool(fault.equipment_confirmed),
            "reported_equipment_text": fault.reported_equipment_text,
            "reported_location": fault.reported_location,
            "suggested_equipment_tag": (
                db.get(Equipment, fault.suggested_equipment_id).tag
                if fault.suggested_equipment_id and db.get(Equipment, fault.suggested_equipment_id) else ""
            ),
            "symptom": fault.symptom,
            "description": fault.description,
            "operational_impact": fault.operational_impact,
            "operating_conditions": fault.operating_conditions,
            "status": fault.status,
            "assigned_section": fault.assigned_section,
            "assigned_user_id": fault.assigned_user_id,
            "active_assignment_id": current_assignment(fault).id if current_assignment(fault) else None,
            "reporter_name": fault.reporter.display_name if fault.reporter else "",
            "reported_on_behalf_of": fault.raised_by_text,
            "closure_remarks": fault.closure_remarks,
            "suggested_section": equipment.section if fault.equipment_confirmed and equipment else "Systems Automation",
            "created_at": fault.created_at.isoformat(),
        },
        "assignments": [{
            "id": item.id,
            "section": item.section,
            "assigned_by_name": item.assigned_by.display_name if item.assigned_by else "",
            "assigned_user_id": item.assigned_user_id,
            "assigned_user_name": item.assigned_user.display_name if item.assigned_user else "",
            "previous_assignment_id": item.previous_assignment_id,
            "reason": item.reason,
            "findings": item.findings,
            "recommendation": item.recommendation,
            "instructions": item.instructions,
            "response_due_at": item.response_due_at.isoformat() if item.response_due_at else None,
            "escalation_status": item.escalation_status,
            "requested_next_section": item.requested_next_section,
            "escalation_review_comments": item.escalation_review_comments,
            "completion_review_status": item.completion_review_status,
            "completion_review_comments": item.completion_review_comments,
            "status": item.status,
            "is_active": item.status in ACTIVE_ASSIGNMENT_STATUSES,
            "created_at": item.created_at.isoformat(),
            "acknowledged_at": item.acknowledged_at.isoformat() if item.acknowledged_at else None,
            "completed_at": item.completed_at.isoformat() if item.completed_at else None,
            "elapsed_minutes": max(0, int((
                utc_datetime(item.completed_at or utcnow()) - utc_datetime(item.created_at)
            ).total_seconds() / 60)),
        } for item in assignments],
        "attachments": [{
            "id": item.id,
            "assignment_id": item.assignment_id,
            "filename": item.original_filename,
            "content_type": item.content_type,
            "size_bytes": item.size_bytes,
            "uploaded_by": item.uploader.display_name if item.uploader else "",
            "created_at": item.created_at.isoformat(),
            "download_url": f"/api/v1/faults/{fault.id}/attachments/{item.id}",
        } for item in attachments],
        "operator_updates": operator_updates,
        "timeline": [{
            "id": event.id,
            "event_type": event.event_type,
            "actor_id": event.actor_id,
            "actor_name": actors.get(event.actor_id, event.actor_id),
            "payload": event.payload,
            "created_at": event.created_at.isoformat(),
        } for event in timeline],
        "diagnoses": [{
            "id": item.id,
            "assignment_id": item.assignment_id,
            "assignment_section": db.get(FaultAssignment, item.assignment_id).section if item.assignment_id and db.get(FaultAssignment, item.assignment_id) else "",
            "author_id": item.author_id,
            "author_name": db.get(User, item.author_id).display_name if db.get(User, item.author_id) else item.author_id,
            "possible_cause": item.possible_cause,
            "diagnostic_method": item.diagnostic_method,
            "observations": item.observations,
            "test_results": item.test_results,
            "confidence": item.confidence,
            "verification_status": item.verification_status,
            "quick_check": item.quick_check,
            "fix_summary": item.fix_summary,
            "workaround": bool(item.workaround),
            "risk_level": item.risk_level,
            "created_at": item.created_at.isoformat(),
        } for item in diagnoses],
        "interventions": [{
            "id": item.id,
            "assignment_id": item.assignment_id,
            "assignment_section": db.get(FaultAssignment, item.assignment_id).section if item.assignment_id and db.get(FaultAssignment, item.assignment_id) else "",
            "diagnosis_id": item.diagnosis_id,
            "actor_id": item.actor_id,
            "actor_name": db.get(User, item.actor_id).display_name if db.get(User, item.actor_id) else item.actor_id,
            "corrective_action": item.corrective_action,
            "tools_materials": item.tools_materials,
            "outcome": item.outcome,
            "notes": item.notes,
            "created_at": item.created_at.isoformat(),
        } for item in interventions],
        "previous_faults": history,
        "ranked_causes": ranked_cause_list,
        "repeat_routing": {
            "seen_before": bool(fault.equipment_confirmed and history),
            "repeat_count": len(history),
            "triage_action": "SA_FIRST_WITH_REPEAT_CONTEXT" if fault.equipment_confirmed and history else "SA_FIRST",
            "suggested_section": equipment.section if fault.equipment_confirmed and equipment else fault.assigned_section,
        },
        "approved_procedures": approved_procedures,
        "legacy_knowledge": [{
            "id": item.id,
            "reference": item.reference,
            "title": item.title,
            "symptom": item.symptom,
            "confirmed_cause": item.confirmed_cause,
            "diagnostic_procedure": item.diagnostic_procedure,
            "corrective_action": item.corrective_action,
            "version": item.version,
            "source_type": item.source_type,
            "instruction_type": item.instruction_type,
            "usage_scope": item.usage_scope,
            "legacy_reference": item.legacy_reference,
            "step_by_step": item.step_by_step,
            "review_status": item.review_status,
        } for item in legacy_knowledge],
        "procedure_updates": updates,
        "reuse_records": [{
            "id": item.id,
            "procedure_update_id": item.procedure_update_id,
            "procedure_reference": db.get(ProcedureUpdate, item.procedure_update_id).reference,
            "procedure_title": db.get(ProcedureUpdate, item.procedure_update_id).title,
            "actor_id": item.actor_id,
            "actor_name": db.get(User, item.actor_id).display_name if db.get(User, item.actor_id) else item.actor_id,
            "outcome": db.get(KnowledgeReuseOutcome, item.id).outcome if db.get(KnowledgeReuseOutcome, item.id) else None,
            "used_at": item.used_at.isoformat(),
        } for item in reuse_records],
    }


@router.post("/api/v1/faults/{fault_id}/action")
def fault_action(fault_id: str, action: str, user: User = Depends(current_user), db: Session = Depends(db_dep)):
    action_roles = {
        "acknowledge": (*INVESTIGATION_ROLES, "maintenance_manager", "general_manager_om", "supervisor", "system_administrator"),
        "on_site": (*INVESTIGATION_ROLES, "maintenance_manager", "general_manager_om", "supervisor", "system_administrator"),
        "diagnose": (*INVESTIGATION_ROLES, "maintenance_manager", "general_manager_om", "supervisor", "system_administrator"),
        "restore": ("systems_automation", "technician_st", "technician_pt", "senior_engineer", "chief_engineer", "maintenance_manager", "general_manager_om", "supervisor", "system_administrator"),
        "close": ("chief_engineer", "maintenance_manager", "general_manager_om", "supervisor", "system_administrator"),
    }
    if action not in action_roles:
        raise HTTPException(status_code=400, detail="Unknown fault action")
    require_roles(user, *action_roles[action])
    f = db.get(Fault, fault_id)
    if not f:
        raise HTTPException(status_code=404, detail="Fault not found")
    require_fault_scope(user, f)
    if action == "close":
        raise HTTPException(status_code=409, detail="Operations must confirm restoration before the breakdown can close")
    if not f.equipment_confirmed:
        raise HTTPException(status_code=409, detail="Confirm the physical equipment before starting technical work")
    assignment = current_assignment(f)
    if assignment:
        require_current_assignment(user, f)
    else:
        section = f.assigned_section or (f.equipment.section if f.equipment else "")
        assignment = FaultAssignment(
            id=str(uuid.uuid4()),
            fault_id=f.id,
            section=section,
            assigned_by_id=user.id,
            reason="Existing fault section assignment",
            created_at=f.created_at,
        )
        db.add(assignment)
        f.assigned_section = section
    if assignment.escalation_status == "PENDING" or assignment.completion_review_status == "PENDING":
        raise HTTPException(status_code=409, detail="This assignment is awaiting Chief Technician review")
    if action == "restore":
        successful_intervention = db.scalar(
            select(Intervention.id).where(
                Intervention.assignment_id == assignment.id,
                Intervention.outcome == "SUCCESS",
            ).limit(1)
        )
        if not successful_intervention:
            raise HTTPException(status_code=409, detail="Record a successful corrective intervention before requesting technical completion")
        assignment.completion_review_status = "PENDING"
        assignment.review_previous_fault_status = f.status
        f.status = "AWAITING_CHIEF_REVIEW"
        add_event(db, f.id, "TECHNICAL_COMPLETION_SUBMITTED_FOR_REVIEW", user.id, {
            "assignment_id": assignment.id,
            "section": assignment.section,
        })
        db.commit()
        return {
            "reference": f.reference,
            "status": f.status,
            "completion_review_status": assignment.completion_review_status,
        }
    if action == "acknowledge":
        if assignment.assigned_user_id and assignment.assigned_user_id != user.id:
            raise HTTPException(status_code=409, detail="This breakdown is already assigned to another employee")
        assignment.assigned_user_id = user.id
        assignment.status = "ACKNOWLEDGED"
        assignment.acknowledged_at = utcnow()
        f.assigned_user_id = user.id
        if assignment.section == "Systems Automation" and not db.scalar(
            select(FaultEvent.id).where(FaultEvent.fault_id == f.id, FaultEvent.event_type == "FAULT_TRIAGED").limit(1)
        ):
            add_event(db, f.id, "FAULT_TRIAGED", user.id, {
                "assignment_id": assignment.id,
                "triage_method": "Systems Automation accepted the initial response",
            })
    transitions = {"acknowledge": "ACKNOWLEDGED", "on_site": "ON_SITE", "diagnose": "DIAGNOSED"}
    f.status = transitions[action]
    if action in ("on_site", "diagnose"):
        assignment.status = "IN_PROGRESS"
    add_event(db, fault_id, f"FAULT_{action.upper()}", user.id, {"assignment_id": assignment.id})
    db.commit()
    return {"reference": f.reference, "status": f.status}
