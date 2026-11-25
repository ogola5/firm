from __future__ import annotations

from fastapi import Depends
from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session
import uuid
from fastapi import APIRouter

from app.db import db_dep
from app.deps import current_user
from app.models import Equipment, Fault, FaultAssignment, Intervention, User, utc_datetime, utcnow
from app.schemas import AssignmentAllocationRequest, AssignmentReviewRequest, OperatorConfirmationCreate, OperatorUpdateCreate, SectionEscalationCreate, TriageRequest
from app.services.access import ASSIGNABLE_TECHNICIAN_ROLES, INVESTIGATION_ROLES, SECTIONS, current_assignment, require_current_assignment, require_equipment_scope, require_fault_scope, require_roles, role_key
from app.services.audit import add_event
from app.services import fault_operations

router = APIRouter()


@router.post("/api/v1/faults/{fault_id}/operator-updates")
def add_operator_update(
    fault_id: str,
    req: OperatorUpdateCreate,
    user: User = Depends(current_user),
    db: Session = Depends(db_dep),
):
    result = fault_operations.add_operator_update(db, user, fault_id, req.note)
    db.commit()
    return result


@router.post("/api/v1/faults/{fault_id}/triage")
def triage_fault(fault_id: str, req: TriageRequest, user: User = Depends(current_user), db: Session = Depends(db_dep)):
    require_roles(user, "systems_automation", "technician_ct", "chief_engineer", "maintenance_manager", "general_manager_om", "supervisor", "system_administrator")
    f = db.get(Fault, fault_id)
    if not f:
        raise HTTPException(status_code=404, detail="Fault not found")
    require_fault_scope(user, f)
    if role_key(user) in ("technician_ct", "chief_engineer") and req.assigned_section != user.section and not (
        not f.equipment_confirmed
        and not req.confirmed_equipment_id
        and req.assigned_section == "Systems Automation"
    ):
        raise HTTPException(status_code=403, detail="Section leads may only assign work within their section")
    active_assignment = current_assignment(f)
    if active_assignment:
        require_current_assignment(user, f)
        if req.assigned_section != active_assignment.section:
            raise HTTPException(status_code=422, detail="Use the section handoff action to transfer this assignment")
    if req.assigned_section not in SECTIONS:
        raise HTTPException(status_code=422, detail="Unknown maintenance section")
    confirmed_equipment = None
    if req.confirmed_equipment_id:
        if f.equipment_confirmed:
            raise HTTPException(status_code=409, detail="Equipment is already confirmed")
        confirmed_equipment = db.get(Equipment, req.confirmed_equipment_id)
        if not confirmed_equipment or confirmed_equipment.tag.startswith("UNCONFIRMED-"):
            raise HTTPException(status_code=404, detail="Confirmed equipment not found")
        require_equipment_scope(user, confirmed_equipment)
        if not active_assignment and req.assigned_section != confirmed_equipment.section:
            raise HTTPException(status_code=422, detail="Route the breakdown to the confirmed equipment section")
    elif not f.equipment_confirmed and req.assigned_section != "Systems Automation":
        raise HTTPException(status_code=422, detail="Confirm the asset before routing to an equipment section")
    if confirmed_equipment:
        f.equipment_id = confirmed_equipment.id
        f.equipment_confirmed = 1
    repeat_count = db.query(Fault).filter(
        Fault.equipment_id == f.equipment_id,
        Fault.equipment_confirmed == 1,
        Fault.id != f.id,
    ).count()
    add_event(db, fault_id, "FAULT_TRIAGED", user.id, {
        "triage_comment": req.triage_comment,
        "confirmed_equipment_id": confirmed_equipment.id if confirmed_equipment else None,
    })
    f.assigned_section = active_assignment.section if active_assignment else req.assigned_section
    if not active_assignment:
        db.add(FaultAssignment(
            id=str(uuid.uuid4()),
            fault_id=f.id,
            section=req.assigned_section,
            assigned_by_id=user.id,
            reason="Initial triage assignment",
        ))
    f.status = "ASSIGNED"
    add_event(db, fault_id, "FAULT_ASSIGNED", user.id, {
        **req.model_dump(),
        "suggested_section": f.equipment.section if f.equipment else "",
        "repeat_count": repeat_count,
        "repeat_routed_to_owner": bool(
            not active_assignment and repeat_count and f.equipment and req.assigned_section == f.equipment.section
        ),
    })
    db.commit()
    return {"reference": f.reference, "status": f.status, "assigned_section": f.assigned_section}


@router.post("/api/v1/faults/{fault_id}/assignments/{assignment_id}/allocate")
def allocate_section_assignment(
    fault_id: str,
    assignment_id: str,
    req: AssignmentAllocationRequest,
    user: User = Depends(current_user),
    db: Session = Depends(db_dep),
):
    require_roles(user, "technician_ct")
    fault = db.get(Fault, fault_id)
    assignment = db.get(FaultAssignment, assignment_id)
    if not fault or not assignment or assignment.fault_id != fault_id:
        raise HTTPException(status_code=404, detail="Section assignment not found")
    require_fault_scope(user, fault)
    if assignment.section != user.section or current_assignment(fault) != assignment:
        raise HTTPException(status_code=404, detail="Active assignment not found in your section")
    if assignment.escalation_status == "PENDING" or assignment.completion_review_status == "PENDING":
        raise HTTPException(status_code=409, detail="Resolve the pending technical review before changing this assignment")
    if req.severity not in ("Low", "Medium", "High", "Critical"):
        raise HTTPException(status_code=422, detail="Priority must be Low, Medium, High or Critical")
    if req.response_due_at and utc_datetime(req.response_due_at) <= utcnow():
        raise HTTPException(status_code=422, detail="Expected response time must be in the future")
    assignee = None
    if req.assigned_user_id:
        assignee = db.get(User, req.assigned_user_id)
        if (
            not assignee
            or not assignee.active
            or assignee.section != user.section
            or role_key(assignee) not in ASSIGNABLE_TECHNICIAN_ROLES
        ):
            raise HTTPException(status_code=422, detail="Choose an active Senior or Principal Technician in your section")
        if assignee.availability_status != "AVAILABLE":
            raise HTTPException(status_code=409, detail="This technician is marked unavailable")
    previous_assignee_id = assignment.assigned_user_id
    assignment.assigned_user_id = assignee.id if assignee else None
    assignment.instructions = req.instructions.strip()
    assignment.response_due_at = utc_datetime(req.response_due_at) if req.response_due_at else None
    fault.severity = req.severity
    fault.assigned_section = assignment.section
    fault.assigned_user_id = assignment.assigned_user_id
    if previous_assignee_id != assignment.assigned_user_id:
        assignment.status = "OPEN"
        assignment.acknowledged_at = None
        fault.status = "ASSIGNED"
    add_event(db, fault.id, "SECTION_WORK_ALLOCATED", user.id, {
        "assignment_id": assignment.id,
        "section": assignment.section,
        "previous_assigned_user_id": previous_assignee_id,
        "assigned_user_id": assignment.assigned_user_id,
        "priority": fault.severity,
        "response_due_at": assignment.response_due_at.isoformat() if assignment.response_due_at else None,
        "instructions": assignment.instructions,
    })
    db.commit()
    return {
        "assignment_id": assignment.id,
        "assigned_user_id": assignment.assigned_user_id,
        "priority": fault.severity,
        "response_due_at": assignment.response_due_at.isoformat() if assignment.response_due_at else None,
        "instructions": assignment.instructions,
    }


@router.post("/api/v1/faults/{fault_id}/assignments/{assignment_id}/review")
def review_section_assignment(
    fault_id: str,
    assignment_id: str,
    req: AssignmentReviewRequest,
    user: User = Depends(current_user),
    db: Session = Depends(db_dep),
):
    require_roles(user, "technician_ct")
    fault = db.get(Fault, fault_id)
    assignment = db.get(FaultAssignment, assignment_id)
    if not fault or not assignment or assignment.fault_id != fault_id:
        raise HTTPException(status_code=404, detail="Section assignment not found")
    require_fault_scope(user, fault)
    if assignment.section != user.section or current_assignment(fault) != assignment:
        raise HTTPException(status_code=404, detail="Active assignment not found in your section")
    if req.decision not in (
        "APPROVE_ESCALATION", "RETURN_ESCALATION",
        "APPROVE_COMPLETION", "RETURN_COMPLETION",
    ):
        raise HTTPException(status_code=422, detail="Choose an escalation or technical completion review decision")
    comments = req.comments.strip()
    if req.decision.startswith("RETURN_") and not comments:
        raise HTTPException(status_code=422, detail="A return decision requires instructions for further work")

    now = utcnow()
    if req.decision in ("APPROVE_ESCALATION", "RETURN_ESCALATION"):
        if assignment.escalation_status != "PENDING" or not assignment.requested_next_section:
            raise HTTPException(status_code=409, detail="This assignment has no escalation awaiting review")
        if req.decision == "RETURN_ESCALATION":
            assignment.escalation_status = "RETURNED"
            assignment.escalation_review_comments = comments
            fault.status = assignment.review_previous_fault_status or "DIAGNOSED"
            add_event(db, fault.id, "SECTION_ESCALATION_RETURNED", user.id, {
                "assignment_id": assignment.id,
                "comments": comments,
            })
            result_assignment_id = assignment.id
        else:
            next_section = assignment.requested_next_section
            if next_section not in SECTIONS or next_section == assignment.section:
                raise HTTPException(status_code=409, detail="The requested receiving section is no longer valid")
            assignment.status = "ESCALATED"
            assignment.completed_at = now
            assignment.escalation_status = "APPROVED"
            assignment.escalation_review_comments = comments
            next_assignment = FaultAssignment(
                id=str(uuid.uuid4()),
                fault_id=fault.id,
                section=next_section,
                assigned_by_id=user.id,
                previous_assignment_id=assignment.id,
                reason=assignment.recommendation,
            )
            db.add(next_assignment)
            fault.assigned_section = next_section
            fault.assigned_user_id = None
            fault.status = "ASSIGNED"
            add_event(db, fault.id, "SECTION_ASSIGNMENT_ESCALATED", user.id, {
                "previous_assignment_id": assignment.id,
                "next_assignment_id": next_assignment.id,
                "from_section": assignment.section,
                "to_section": next_assignment.section,
                "findings": assignment.findings,
                "recommendation": assignment.recommendation,
                "review_comments": comments,
            })
            add_event(db, fault.id, "FAULT_ASSIGNED", user.id, {
                "assignment_id": next_assignment.id,
                "previous_assignment_id": assignment.id,
                "assigned_section": next_assignment.section,
                "handoff": True,
            })
            result_assignment_id = next_assignment.id
    else:
        if assignment.completion_review_status != "PENDING":
            raise HTTPException(status_code=409, detail="This assignment has no technical completion awaiting review")
        if req.decision == "RETURN_COMPLETION":
            assignment.completion_review_status = "RETURNED"
            assignment.completion_review_comments = comments
            fault.status = assignment.review_previous_fault_status or "DIAGNOSED"
            add_event(db, fault.id, "TECHNICAL_COMPLETION_RETURNED", user.id, {
                "assignment_id": assignment.id,
                "comments": comments,
            })
        else:
            successful_intervention = db.scalar(
                select(Intervention.id).where(
                    Intervention.assignment_id == assignment.id,
                    Intervention.outcome == "SUCCESS",
                ).limit(1)
            )
            if not successful_intervention:
                raise HTTPException(status_code=409, detail="Record a successful corrective intervention before approving technical completion")
            assignment.completion_review_status = "APPROVED"
            assignment.completion_review_comments = comments
            assignment.status = "RESTORED"
            assignment.completed_at = now
            fault.status = "RESTORED"
            # Restoration is when the equipment worked again (technician's notes), not when it was signed off.
            restored_at = utc_datetime(assignment.back_in_service_at) if assignment.back_in_service_at else now
            fault.restored_at = restored_at
            add_event(db, fault.id, "FAULT_RESTORE", assignment.assigned_user_id or user.id, {
                "assignment_id": assignment.id,
                "technical_reviewed_by": user.id,
                "signed_off_at": now.isoformat(),
            }, created_at=restored_at)
            add_event(db, fault.id, "TECHNICAL_COMPLETION_APPROVED", user.id, {
                "assignment_id": assignment.id,
                "comments": comments,
            })
    db.commit()
    return {
        "fault_id": fault.id,
        "assignment_id": result_assignment_id if req.decision == "APPROVE_ESCALATION" else assignment.id,
        "assigned_section": fault.assigned_section,
        "status": fault.status,
        "decision": req.decision,
    }


@router.post("/api/v1/faults/{fault_id}/assignments/escalate")
def escalate_assignment(
    fault_id: str,
    req: SectionEscalationCreate,
    user: User = Depends(current_user),
    db: Session = Depends(db_dep),
):
    require_roles(user, "systems_automation", *INVESTIGATION_ROLES, "maintenance_manager", "supervisor", "system_administrator")
    fault = db.get(Fault, fault_id)
    if not fault:
        raise HTTPException(status_code=404, detail="Fault not found")
    require_fault_scope(user, fault)
    assignment = current_assignment(fault)
    if not assignment:
        raise HTTPException(status_code=409, detail="This breakdown has no active section assignment")
    require_current_assignment(user, fault)
    if not fault.equipment_confirmed:
        raise HTTPException(status_code=409, detail="Confirm the physical equipment before handing off technical work")
    if assignment.escalation_status == "PENDING" or assignment.completion_review_status == "PENDING":
        raise HTTPException(status_code=409, detail="This assignment already has a technical review pending")
    if req.next_section not in SECTIONS or req.next_section == assignment.section:
        raise HTTPException(status_code=422, detail="Choose a different, valid maintenance section")
    if not req.findings.strip() or not req.recommendation.strip():
        raise HTTPException(status_code=422, detail="Record findings and a recommended next action before handoff")

    assignment.findings = req.findings.strip()
    assignment.recommendation = req.recommendation.strip()
    assignment.escalation_status = "PENDING"
    assignment.requested_next_section = req.next_section
    assignment.review_previous_fault_status = fault.status
    fault.status = "AWAITING_CHIEF_REVIEW"
    add_event(db, fault.id, "SECTION_ESCALATION_SUBMITTED_FOR_REVIEW", user.id, {
        "assignment_id": assignment.id,
        "from_section": assignment.section,
        "to_section": req.next_section,
        "findings": assignment.findings,
        "recommendation": assignment.recommendation,
    })
    db.commit()
    return {
        "fault_id": fault.id,
        "assignment_id": assignment.id,
        "requested_section": assignment.requested_next_section,
        "escalation_status": assignment.escalation_status,
        "status": fault.status,
    }


@router.post("/api/v1/faults/{fault_id}/operator-confirmation")
def confirm_operator_restoration(
    fault_id: str,
    req: OperatorConfirmationCreate,
    user: User = Depends(current_user),
    db: Session = Depends(db_dep),
):
    require_roles(user, "operations")
    fault = db.get(Fault, fault_id)
    if not fault:
        raise HTTPException(status_code=404, detail="Fault not found")
    require_fault_scope(user, fault)
    if fault.status != "RESTORED":
        raise HTTPException(status_code=409, detail="Operator confirmation is available after a section reports restoration")
    comments = req.comments.strip()
    if not req.confirmed and not comments:
        raise HTTPException(status_code=422, detail="Describe what remains wrong so the section can continue")
    assignment = max(fault.assignments, key=lambda item: item.created_at) if fault.assignments else None
    if req.confirmed:
        fault.status = "CLOSED"
        fault.closure_remarks = comments
        add_event(db, fault.id, "FAULT_OPERATOR_CONFIRMED", user.id, {"comments": comments})
        add_event(db, fault.id, "FAULT_CLOSE", user.id, {"comments": comments})
    else:
        section = assignment.section if assignment else fault.assigned_section or "Systems Automation"
        reopened = FaultAssignment(
            id=str(uuid.uuid4()),
            fault_id=fault.id,
            section=section,
            assigned_by_id=user.id,
            previous_assignment_id=assignment.id if assignment else None,
            reason="Operator did not confirm restoration",
        )
        db.add(reopened)
        fault.assigned_section = section
        fault.assigned_user_id = None
        fault.restored_at = None
        fault.status = "ASSIGNED"
        add_event(db, fault.id, "FAULT_OPERATOR_REJECTED_RESTORATION", user.id, {
            "comments": comments,
            "reopened_assignment_id": reopened.id,
            "assigned_section": section,
        })
    db.commit()
    return {"fault_id": fault.id, "status": fault.status, "confirmed": req.confirmed}
