"""Expert knowledge: at risk, expert sessions, Ask the expert, retirement dates and shadowing."""
from __future__ import annotations

import uuid
from datetime import date

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import db_dep
from app.deps import current_user
from app.models import ExpertAnswer, ExpertQuestion, ExpertSession, Fault, FaultAssignment, User, utcnow
from app.services.access import SECTIONS, TECHNICAL_ROLES, require_fault_scope, require_roles, role_definition, role_key
from app.services.audit import add_event, audit_user_change
from app.services.catalogue import type_name
from app.services.expertise import equipment_types, knowledge_at_risk
from app.services.workspace import ANALYTICS_ORG_WIDE

router = APIRouter()

REVIEWERS = ("technician_ct", "chief_engineer")
SECTION_SCOPED = ("technician_st", "technician_pt", "technician_ct", "assistant_engineer", "engineer", "senior_engineer", "chief_engineer")


class SessionCreate(BaseModel):
    expert_id: str
    equipment_type: str = Field(min_length=1, max_length=20)
    section: str
    title: str = Field(min_length=3, max_length=200)
    how_it_fails: str = Field(default="", max_length=4000)
    first_checks: str = Field(default="", max_length=4000)
    what_fools_people: str = Field(default="", max_length=4000)
    tricks: str = Field(default="", max_length=4000)
    parts: str = Field(default="", max_length=2000)
    safety: str = Field(default="", max_length=2000)


class Decision(BaseModel):
    decision: str  # APPROVE or RETURN
    note: str = Field(default="", max_length=2000)


class QuestionCreate(BaseModel):
    equipment_type: str = Field(min_length=1, max_length=20)
    section: str
    text: str = Field(min_length=10, max_length=2000)


class AnswerCreate(BaseModel):
    text: str = Field(min_length=5, max_length=4000)


class RetirementUpdate(BaseModel):
    retirement_date: date | None = None


class AdviserUpdate(BaseModel):
    adviser_id: str | None = None


def scope_section(user: User, requested: str = "") -> str | None:
    """Section-based roles see their own section; others may filter."""
    if role_key(user) in SECTION_SCOPED:
        return user.section
    if requested and requested not in SECTIONS:
        raise HTTPException(status_code=422, detail="Unknown section")
    return requested or None


def name_of(db: Session, user_id: str | None) -> str:
    person = db.get(User, user_id) if user_id else None
    return person.display_name if person else ""


def session_payload(db: Session, item: ExpertSession) -> dict:
    expert = db.get(User, item.expert_id)
    return {
        "id": item.id, "title": item.title, "equipment_type": item.equipment_type, "equipment_type_name": type_name(item.equipment_type),
        "section": item.section, "expert_id": item.expert_id, "expert": expert.display_name if expert else "",
        "expert_retirement_date": expert.retirement_date.isoformat() if expert and expert.retirement_date else None,
        "scribe": name_of(db, item.scribe_id), "how_it_fails": item.how_it_fails, "first_checks": item.first_checks,
        "what_fools_people": item.what_fools_people, "tricks": item.tricks, "parts": item.parts, "safety": item.safety,
        "status": item.status, "reviewer": name_of(db, item.reviewer_id), "review_note": item.review_note,
        "created_at": item.created_at.isoformat(), "credit": f"Expert knowledge: {expert.display_name if expert else ''}, {item.created_at:%Y}",
    }


@router.get("/api/v1/expertise/at-risk")
def at_risk(section: str = "", user: User = Depends(current_user), db: Session = Depends(db_dep)):
    require_roles(user, *TECHNICAL_ROLES, *ANALYTICS_ORG_WIDE, "general_manager_om", "hr_officer")
    scope = scope_section(user, section)
    return {"rows": knowledge_at_risk(db, scope), "scope": f"{scope} section" if scope else "All sections",
            "rule": "People retiring within 3 years (dates set by HR). HIGH: half or more of the successful fixes are theirs and "
                    "at most one other person has fixed it, or nothing is written down."}


@router.get("/api/v1/expertise/types")
def types(section: str = "", user: User = Depends(current_user), db: Session = Depends(db_dep)):
    require_roles(user, *TECHNICAL_ROLES, *ANALYTICS_ORG_WIDE, "general_manager_om")
    return equipment_types(db, section or None)


@router.get("/api/v1/expertise/people")
def people(section: str = "", user: User = Depends(current_user), db: Session = Depends(db_dep)):
    """Technical staff who can be named as the expert (or an adviser)."""
    require_roles(user, *TECHNICAL_ROLES, *ANALYTICS_ORG_WIDE, "general_manager_om", "hr_officer")
    query = select(User).where(User.active == 1, User.role.in_(TECHNICAL_ROLES)).order_by(User.section, User.display_name)
    if section:
        query = query.where(User.section == section)
    return [{"id": item.id, "name": item.display_name, "role_label": role_definition(item)["label"], "section": item.section,
             "retirement_date": item.retirement_date.isoformat() if item.retirement_date else None} for item in db.scalars(query)]


@router.get("/api/v1/expertise/sessions")
def sessions(equipment_type: str = "", status: str = "APPROVED", user: User = Depends(current_user), db: Session = Depends(db_dep)):
    """Approved sessions are shared with every technical person; pending ones with the people involved and the chief."""
    key = role_key(user)
    require_roles(user, *TECHNICAL_ROLES, *ANALYTICS_ORG_WIDE, "general_manager_om")
    query = select(ExpertSession).order_by(ExpertSession.created_at.desc())
    if equipment_type:
        query = query.where(ExpertSession.equipment_type == equipment_type)
    if status != "ALL":
        query = query.where(ExpertSession.status == status)
    rows = []
    for item in db.scalars(query):
        if item.status != "APPROVED":
            involved = user.id in (item.expert_id, item.scribe_id)
            reviewer = key in REVIEWERS and item.section == user.section
            if not (involved or reviewer or key in ANALYTICS_ORG_WIDE):
                continue
        rows.append(session_payload(db, item))
    return rows


@router.post("/api/v1/expertise/sessions", status_code=201)
def create_session(req: SessionCreate, user: User = Depends(current_user), db: Session = Depends(db_dep)):
    require_roles(user, *TECHNICAL_ROLES)
    if req.section not in SECTIONS:
        raise HTTPException(status_code=422, detail="Choose the section")
    expert = db.get(User, req.expert_id)
    if not expert or not expert.active or role_key(expert) not in TECHNICAL_ROLES:
        raise HTTPException(status_code=422, detail="Choose the expert from the list")
    if not req.how_it_fails.strip() or not req.first_checks.strip():
        raise HTTPException(status_code=422, detail="Write at least how it usually fails and the first checks")
    item = ExpertSession(id=str(uuid.uuid4()), expert_id=expert.id, scribe_id=user.id, equipment_type=req.equipment_type.upper(),
                         section=req.section, title=req.title.strip(), how_it_fails=req.how_it_fails.strip(),
                         first_checks=req.first_checks.strip(), what_fools_people=req.what_fools_people.strip(),
                         tricks=req.tricks.strip(), parts=req.parts.strip(), safety=req.safety.strip(), created_at=utcnow())
    db.add(item)
    db.commit()
    return session_payload(db, item)


@router.post("/api/v1/expertise/sessions/{session_id}/review")
def review_session(session_id: str, req: Decision, user: User = Depends(current_user), db: Session = Depends(db_dep)):
    require_roles(user, *REVIEWERS)
    item = db.get(ExpertSession, session_id)
    if not item or item.section != user.section:
        raise HTTPException(status_code=404, detail="Session not found")
    if user.id in (item.expert_id, item.scribe_id):
        raise HTTPException(status_code=409, detail="Someone not in the session must approve it")
    if item.status != "SUBMITTED":
        raise HTTPException(status_code=409, detail="This session has already been decided")
    if req.decision not in ("APPROVE", "RETURN"):
        raise HTTPException(status_code=422, detail="Decision must be APPROVE or RETURN")
    if req.decision == "RETURN" and len(req.note.strip()) < 5:
        raise HTTPException(status_code=422, detail="Say what to add or correct")
    item.status = "APPROVED" if req.decision == "APPROVE" else "RETURNED"
    item.reviewer_id, item.review_note, item.decided_at = user.id, req.note.strip(), utcnow()
    db.commit()
    return session_payload(db, item)


def question_payload(db: Session, item: ExpertQuestion, user: User) -> dict:
    answers = db.scalars(select(ExpertAnswer).where(ExpertAnswer.question_id == item.id).order_by(ExpertAnswer.accepted.desc(), ExpertAnswer.created_at)).all()
    can_accept = user.id == item.asked_by_id or (role_key(user) in REVIEWERS and user.section == item.section)
    return {
        "id": item.id, "equipment_type": item.equipment_type, "equipment_type_name": type_name(item.equipment_type),
        "section": item.section, "asked_by": name_of(db, item.asked_by_id), "text": item.text, "status": item.status,
        "created_at": item.created_at.isoformat(),
        "answers": [{"id": answer.id, "author": name_of(db, answer.author_id), "text": answer.text, "accepted": bool(answer.accepted),
                     "can_accept": can_accept and not answer.accepted and item.status == "OPEN" and answer.author_id != item.asked_by_id,
                     "created_at": answer.created_at.isoformat()} for answer in answers],
    }


@router.get("/api/v1/expertise/questions")
def questions(equipment_type: str = "", user: User = Depends(current_user), db: Session = Depends(db_dep)):
    require_roles(user, *TECHNICAL_ROLES, *ANALYTICS_ORG_WIDE, "general_manager_om")
    query = select(ExpertQuestion).order_by(ExpertQuestion.status.desc(), ExpertQuestion.created_at.desc())
    if equipment_type:
        query = query.where(ExpertQuestion.equipment_type == equipment_type)
    return [question_payload(db, item, user) for item in db.scalars(query.limit(100))]


@router.post("/api/v1/expertise/questions", status_code=201)
def ask(req: QuestionCreate, user: User = Depends(current_user), db: Session = Depends(db_dep)):
    require_roles(user, *TECHNICAL_ROLES)
    if req.section not in SECTIONS:
        raise HTTPException(status_code=422, detail="Choose the section")
    item = ExpertQuestion(id=str(uuid.uuid4()), equipment_type=req.equipment_type.upper(), section=req.section,
                          asked_by_id=user.id, text=req.text.strip(), created_at=utcnow())
    db.add(item)
    db.commit()
    return question_payload(db, item, user)


@router.post("/api/v1/expertise/questions/{question_id}/answers", status_code=201)
def answer(question_id: str, req: AnswerCreate, user: User = Depends(current_user), db: Session = Depends(db_dep)):
    require_roles(user, *TECHNICAL_ROLES)
    item = db.get(ExpertQuestion, question_id)
    if not item:
        raise HTTPException(status_code=404, detail="Question not found")
    db.add(ExpertAnswer(id=str(uuid.uuid4()), question_id=item.id, author_id=user.id, text=req.text.strip(), created_at=utcnow()))
    db.commit()
    return question_payload(db, item, user)


@router.post("/api/v1/expertise/answers/{answer_id}/accept")
def accept(answer_id: str, user: User = Depends(current_user), db: Session = Depends(db_dep)):
    """The person who asked (or the section chief) marks the answer that solved it."""
    chosen = db.get(ExpertAnswer, answer_id)
    question = db.get(ExpertQuestion, chosen.question_id) if chosen else None
    if not chosen or not question:
        raise HTTPException(status_code=404, detail="Answer not found")
    if not (user.id == question.asked_by_id or (role_key(user) in REVIEWERS and user.section == question.section)):
        raise HTTPException(status_code=403, detail="Only the person who asked, or the section chief, can accept an answer")
    if chosen.author_id == user.id:
        raise HTTPException(status_code=409, detail="You cannot accept your own answer")
    if question.status != "OPEN":
        raise HTTPException(status_code=409, detail="An answer has already been accepted")
    chosen.accepted, chosen.accepted_by_id, chosen.accepted_at = 1, user.id, utcnow()
    question.status = "ANSWERED"
    db.commit()
    return question_payload(db, question, user)


@router.patch("/api/v1/users/{user_id}/retirement")
def set_retirement(user_id: str, req: RetirementUpdate, user: User = Depends(current_user), db: Session = Depends(db_dep)):
    """HR records when someone retires, so their knowledge can be captured in time."""
    require_roles(user, "hr_officer", "system_administrator")
    target = db.get(User, user_id)
    if not target:
        raise HTTPException(status_code=404, detail="Person not found")
    target.retirement_date = req.retirement_date
    audit_user_change(db, user.id, "RETIREMENT_DATE_SET", target, {"retirement_date": req.retirement_date.isoformat() if req.retirement_date else None})
    db.commit()
    return {"id": target.id, "retirement_date": target.retirement_date.isoformat() if target.retirement_date else None}


@router.patch("/api/v1/faults/{fault_id}/assignments/{assignment_id}/adviser")
def set_adviser(fault_id: str, assignment_id: str, req: AdviserUpdate, user: User = Depends(current_user), db: Session = Depends(db_dep)):
    """Chief Technician pairs an experienced colleague with the person doing the job (both are credited)."""
    require_roles(user, "technician_ct")
    fault = db.get(Fault, fault_id)
    assignment = db.get(FaultAssignment, assignment_id)
    if not fault or not assignment or assignment.fault_id != fault.id:
        raise HTTPException(status_code=404, detail="Assignment not found")
    require_fault_scope(user, fault)
    if assignment.section != user.section:
        raise HTTPException(status_code=403, detail="Only the chief of this section can pair an adviser")
    if req.adviser_id:
        adviser = db.get(User, req.adviser_id)
        if not adviser or not adviser.active or role_key(adviser) not in TECHNICAL_ROLES:
            raise HTTPException(status_code=422, detail="Choose the adviser from the list")
        if adviser.id == assignment.assigned_user_id:
            raise HTTPException(status_code=422, detail="The adviser must be someone other than the person doing the job")
    assignment.adviser_id = req.adviser_id or None
    add_event(db, fault.id, "ADVISER_SET", user.id, {"assignment_id": assignment.id, "adviser_id": assignment.adviser_id,
                                                     "adviser_name": name_of(db, assignment.adviser_id)})
    db.commit()
    return {"assignment_id": assignment.id, "adviser_id": assignment.adviser_id, "adviser_name": name_of(db, assignment.adviser_id)}
