from __future__ import annotations

from fastapi import Depends
from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session
import uuid
from fastapi import APIRouter

from app.db import db_dep
from app.deps import current_user
from app.models import Diagnosis, Fault, Intervention, KnowledgeReuse, KnowledgeReuseOutcome, ProcedureReview, ProcedureUpdate, User, utcnow
from app.schemas import KnowledgeReuseCreate, KnowledgeReuseOutcomeCreate, ProcedureReviewRequest, ProcedureUpdateCreate
from app.services.access import INVESTIGATION_ROLES, PROCEDURE_AUTHOR_ROLES, TECHNICAL_ROLES, require_fault_scope, require_roles, role_key
from app.services.audit import add_event
from app.services.procedures import procedure_update_payload

router = APIRouter()

@router.post("/api/v1/faults/{fault_id}/procedure-updates")
def submit_procedure_update(fault_id: str, req: ProcedureUpdateCreate, user: User = Depends(current_user), db: Session = Depends(db_dep)):
    require_roles(user, *PROCEDURE_AUTHOR_ROLES)
    fault = db.get(Fault, fault_id)
    if not fault:
        raise HTTPException(status_code=404, detail="Fault not found")
    require_fault_scope(user, fault)
    if fault.status not in ("RESTORED", "CLOSED"):
        raise HTTPException(status_code=409, detail="A work-procedure update can be submitted after restoration")
    successful_intervention = db.scalar(
        select(Intervention.id).where(Intervention.fault_id == fault.id, Intervention.outcome == "SUCCESS").limit(1)
    )
    if not successful_intervention:
        raise HTTPException(status_code=409, detail="Record a successful intervention before submitting a work-procedure update")
    fields = [req.title, req.observed_symptom, req.confirmed_cause, req.diagnostic_procedure, req.corrective_action]
    if any(not value.strip() for value in fields):
        raise HTTPException(status_code=422, detail="Title, symptom, cause, diagnostic procedure and corrective action are required")
    update_id = str(uuid.uuid4())
    count = db.query(ProcedureUpdate).count() + 1
    update = ProcedureUpdate(
        id=update_id,
        reference=f"PU-DMO-{count:05d}",
        fault_id=fault.id,
        author_id=user.id,
        section=fault.equipment.section,
        title=req.title.strip(),
        observed_symptom=req.observed_symptom.strip(),
        confirmed_cause=req.confirmed_cause.strip(),
        diagnostic_procedure=req.diagnostic_procedure.strip(),
        corrective_action=req.corrective_action.strip(),
        safety=req.safety.strip(),
        version=1,
        lineage_id=update_id,
        status="SUBMITTED",
    )
    db.add(update)
    add_event(db, fault.id, "PROCEDURE_UPDATE_SUBMITTED", user.id, {"procedure_update_id": update.id, "reference": update.reference})
    db.commit()
    return procedure_update_payload(update, user)


@router.post("/api/v1/procedure-updates/{update_id}/revisions")
def revise_procedure_update(update_id: str, req: ProcedureUpdateCreate, user: User = Depends(current_user), db: Session = Depends(db_dep)):
    previous = db.get(ProcedureUpdate, update_id)
    if not previous:
        raise HTTPException(status_code=404, detail="Procedure update not found")
    fault = db.get(Fault, previous.fault_id)
    require_fault_scope(user, fault)
    if previous.author_id != user.id:
        raise HTTPException(status_code=403, detail="Only the contributing employee can submit this revision")
    if previous.status not in ("CLARIFICATION_REQUESTED", "APPROVED"):
        raise HTTPException(status_code=409, detail="Only a clarification request or published procedure can be revised")
    if fault.status not in ("RESTORED", "CLOSED"):
        raise HTTPException(status_code=409, detail="The source fault must remain restored before revising its procedure")
    fields = [req.title, req.observed_symptom, req.confirmed_cause, req.diagnostic_procedure, req.corrective_action]
    if any(not value.strip() for value in fields):
        raise HTTPException(status_code=422, detail="Title, symptom, cause, diagnostic procedure and corrective action are required")
    versions = db.scalars(select(ProcedureUpdate.version).where(ProcedureUpdate.lineage_id == previous.lineage_id)).all()
    version = max(versions, default=previous.version) + 1
    revision_id = str(uuid.uuid4())
    count = db.query(ProcedureUpdate).count() + 1
    revision = ProcedureUpdate(
        id=revision_id,
        reference=f"PU-DMO-{count:05d}",
        fault_id=previous.fault_id,
        author_id=user.id,
        section=previous.section,
        title=req.title.strip(),
        observed_symptom=req.observed_symptom.strip(),
        confirmed_cause=req.confirmed_cause.strip(),
        diagnostic_procedure=req.diagnostic_procedure.strip(),
        corrective_action=req.corrective_action.strip(),
        safety=req.safety.strip(),
        version=version,
        lineage_id=previous.lineage_id,
        previous_update_id=previous.id,
        status="SUBMITTED",
    )
    db.add(revision)
    add_event(db, fault.id, "PROCEDURE_REVISION_SUBMITTED", user.id, {
        "procedure_update_id": revision.id,
        "previous_update_id": previous.id,
        "version": version,
    })
    db.commit()
    return procedure_update_payload(revision, user)


@router.get("/api/v1/procedure-updates/review-queue")
def procedure_review_queue(user: User = Depends(current_user), db: Session = Depends(db_dep)):
    role = role_key(user)
    if role in ("technician_ct", "chief_engineer"):
        query = select(ProcedureUpdate).where(
            ProcedureUpdate.section == user.section,
            ProcedureUpdate.status == "SUBMITTED",
        )
    elif role == "supervisor":
        query = select(ProcedureUpdate).where(ProcedureUpdate.status == "CHIEF_APPROVED")
    else:
        raise HTTPException(status_code=403, detail="Only section chiefs and supervisors can review work-procedure updates")
    updates = db.scalars(query.order_by(ProcedureUpdate.created_at)).all()
    result = []
    for item in updates:
        reviews = db.scalars(
            select(ProcedureReview).where(ProcedureReview.procedure_update_id == item.id).order_by(ProcedureReview.created_at)
        ).all()
        payload = procedure_update_payload(item, db.get(User, item.author_id), reviews)
        fault = db.get(Fault, item.fault_id)
        payload["source_evidence"] = {
            "fault_reference": fault.reference,
            "symptom": fault.symptom,
            "description": fault.description,
            "status": fault.status,
            "diagnoses": [{
                "possible_cause": diagnosis.possible_cause,
                "diagnostic_method": diagnosis.diagnostic_method,
                "observations": diagnosis.observations,
                "test_results": diagnosis.test_results,
                "verification_status": diagnosis.verification_status,
            } for diagnosis in db.scalars(select(Diagnosis).where(Diagnosis.fault_id == fault.id)).all()],
            "interventions": [{
                "corrective_action": intervention.corrective_action,
                "outcome": intervention.outcome,
                "notes": intervention.notes,
            } for intervention in db.scalars(select(Intervention).where(Intervention.fault_id == fault.id)).all()],
        }
        result.append(payload)
    return result


@router.post("/api/v1/procedure-updates/{update_id}/review")
def review_procedure_update(update_id: str, req: ProcedureReviewRequest, user: User = Depends(current_user), db: Session = Depends(db_dep)):
    update = db.get(ProcedureUpdate, update_id)
    if not update:
        raise HTTPException(status_code=404, detail="Procedure update not found")
    if req.decision not in ("APPROVE", "REQUEST_CLARIFICATION", "REJECT"):
        raise HTTPException(status_code=422, detail="Decision must be APPROVE, REQUEST_CLARIFICATION or REJECT")
    if req.decision in ("REQUEST_CLARIFICATION", "REJECT") and not req.comments.strip():
        raise HTTPException(status_code=422, detail="A comment is required for clarification or rejection")
    if update.author_id == user.id:
        raise HTTPException(status_code=403, detail="Contributors cannot review or publish their own procedure updates")
    role = role_key(user)
    if role in ("technician_ct", "chief_engineer"):
        if update.section != user.section:
            raise HTTPException(status_code=404, detail="Procedure update not found")
        if update.status != "SUBMITTED":
            raise HTTPException(status_code=409, detail="Technical review is only available for submitted updates")
        if req.decision == "APPROVE":
            update.status = "CHIEF_APPROVED"
            review_decision = "TECHNICAL_APPROVED"
        elif req.decision == "REQUEST_CLARIFICATION":
            update.status = "CLARIFICATION_REQUESTED"
            review_decision = "CLARIFICATION_REQUESTED"
        else:
            update.status = "REJECTED"
            review_decision = "REJECTED"
    elif role == "supervisor":
        if req.decision == "APPROVE":
            if update.status != "CHIEF_APPROVED":
                raise HTTPException(status_code=409, detail="A section chief must complete technical review before publication")
            update.status = "APPROVED"
            review_decision = "SUPERVISOR_APPROVED"
        else:
            if update.status not in ("SUBMITTED", "CHIEF_APPROVED"):
                raise HTTPException(status_code=409, detail="This procedure update is not awaiting review")
            update.status = "CLARIFICATION_REQUESTED" if req.decision == "REQUEST_CLARIFICATION" else "REJECTED"
            review_decision = update.status
    else:
        raise HTTPException(status_code=403, detail="Only section chiefs and supervisors can review work-procedure updates")
    review = ProcedureReview(
        id=str(uuid.uuid4()),
        procedure_update_id=update.id,
        reviewer_id=user.id,
        decision=review_decision,
        comments=req.comments.strip(),
    )
    db.add(review)
    update.updated_at = utcnow()
    fault = db.get(Fault, update.fault_id)
    add_event(db, fault.id, "PROCEDURE_REVIEWED", user.id, {
        "procedure_update_id": update.id,
        "decision": review_decision,
        "status": update.status,
    })
    db.commit()
    return procedure_update_payload(update, db.get(User, update.author_id), [review])


@router.get("/api/v1/procedure-updates/library")
def procedure_library(user: User = Depends(current_user), db: Session = Depends(db_dep)):
    require_roles(user, "systems_automation", *TECHNICAL_ROLES, "maintenance_manager", "general_manager_om", "supervisor", "system_administrator")
    query = select(ProcedureUpdate).where(ProcedureUpdate.status == "APPROVED")
    if role_key(user) in TECHNICAL_ROLES:
        query = query.where(ProcedureUpdate.section == user.section)
    updates = db.scalars(query.order_by(ProcedureUpdate.updated_at.desc())).all()
    latest: dict[str, ProcedureUpdate] = {}
    for item in updates:
        current = latest.get(item.lineage_id)
        if current is None or item.version > current.version:
            latest[item.lineage_id] = item
    return [
        procedure_update_payload(
            item,
            db.get(User, item.author_id),
            db.scalars(select(ProcedureReview).where(ProcedureReview.procedure_update_id == item.id).order_by(ProcedureReview.created_at)).all(),
        )
        for item in latest.values()
    ]


@router.post("/api/v1/faults/{fault_id}/procedure-reuse")
def reuse_procedure(fault_id: str, req: KnowledgeReuseCreate, user: User = Depends(current_user), db: Session = Depends(db_dep)):
    require_roles(user, *INVESTIGATION_ROLES)
    fault = db.get(Fault, fault_id)
    update = db.get(ProcedureUpdate, req.procedure_update_id)
    if not fault:
        raise HTTPException(status_code=404, detail="Fault not found")
    require_fault_scope(user, fault)
    if not update or update.status != "APPROVED":
        raise HTTPException(status_code=404, detail="Approved procedure not found")
    reuse = KnowledgeReuse(
        id=str(uuid.uuid4()),
        procedure_update_id=update.id,
        fault_id=fault.id,
        actor_id=user.id,
    )
    db.add(reuse)
    add_event(db, fault.id, "KNOWLEDGE_REUSED", user.id, {
        "reuse_id": reuse.id,
        "procedure_update_id": update.id,
        "procedure_reference": update.reference,
    })
    db.commit()
    return {"id": reuse.id, "procedure_reference": update.reference, "used_at": reuse.used_at.isoformat()}


@router.post("/api/v1/procedure-reuse/{reuse_id}/outcome")
def confirm_procedure_reuse(reuse_id: str, req: KnowledgeReuseOutcomeCreate, user: User = Depends(current_user), db: Session = Depends(db_dep)):
    require_roles(user, *INVESTIGATION_ROLES)
    reuse = db.get(KnowledgeReuse, reuse_id)
    if not reuse:
        raise HTTPException(status_code=404, detail="Procedure reuse record not found")
    if reuse.actor_id != user.id:
        raise HTTPException(status_code=403, detail="Only the employee who recorded reuse can confirm its outcome")
    fault = db.get(Fault, reuse.fault_id)
    require_fault_scope(user, fault)
    if fault.status not in ("RESTORED", "CLOSED"):
        raise HTTPException(status_code=409, detail="Confirm reuse after the fault is restored")
    if req.outcome not in ("SUCCESS", "FAILED"):
        raise HTTPException(status_code=422, detail="Outcome must be SUCCESS or FAILED")
    if db.get(KnowledgeReuseOutcome, reuse.id):
        raise HTTPException(status_code=409, detail="This reuse outcome has already been confirmed")
    outcome = KnowledgeReuseOutcome(
        reuse_id=reuse.id,
        actor_id=user.id,
        outcome=req.outcome,
        comments=req.comments.strip(),
    )
    db.add(outcome)
    add_event(db, fault.id, "KNOWLEDGE_REUSE_CONFIRMED", user.id, {
        "reuse_id": reuse.id,
        "outcome": req.outcome,
    })
    db.commit()
    return {"reuse_id": reuse.id, "outcome": outcome.outcome, "confirmed_at": outcome.confirmed_at.isoformat()}
