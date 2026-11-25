"""Knowledge library by equipment type, knowledge owners, withdrawal, write-up matches and personal impact."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import db_dep
from app.deps import current_user
from app.models import Fault, User
from app.services import knowledge_library as library
from app.services.access import TECHNICAL_ROLES, require_fault_scope, require_roles, role_definition, role_key

router = APIRouter()

READERS = ("systems_automation", *TECHNICAL_ROLES, "maintenance_manager", "general_manager_om", "supervisor", "system_administrator")


class OwnerRequest(BaseModel):
    user_id: str


class WithdrawRequest(BaseModel):
    reason: str = Field(min_length=5, max_length=1000)


@router.get("/api/v1/library/types")
def library_types(user: User = Depends(current_user), db: Session = Depends(db_dep)):
    """Every equipment type with how much is known about it. Knowledge is shared across sections and regions."""
    require_roles(user, *READERS)
    return {"types": library.type_list(db), "your_section": user.section or ""}


@router.get("/api/v1/library/search")
def library_search(q: str = "", user: User = Depends(current_user), db: Session = Depends(db_dep)):
    """Search what we have learnt: cases, procedures, expert notes, older instructions. Ranked, with snippets."""
    require_roles(user, *READERS)
    q = q.strip()[:120]
    return {"query": q, "results": library.search_results(db, q) if len(q) >= 2 else []}


@router.get("/api/v1/library/types/{code}")
def library_type(code: str, user: User = Depends(current_user), db: Session = Depends(db_dep)):
    require_roles(user, *READERS)
    return library.type_page(db, user, code)


@router.get("/api/v1/library/owner-candidates")
def owner_candidates(user: User = Depends(current_user), db: Session = Depends(db_dep)):
    """Chief Technicians and Senior Engineers who can own an equipment type's knowledge."""
    require_roles(user, *library.ASSIGNERS)
    query = select(User).where(User.active == 1, User.role.in_(library.OWNER_ROLES))
    if role_key(user) == "chief_engineer":
        query = query.where(User.section == user.section)
    return [{"id": item.id, "name": item.display_name, "role_label": role_definition(item)["label"], "section": item.section,
             "region": item.region or ""} for item in db.scalars(query.order_by(User.section, User.display_name))]


@router.put("/api/v1/library/types/{code}/owner")
def set_owner(code: str, req: OwnerRequest, user: User = Depends(current_user), db: Session = Depends(db_dep)):
    return library.assign_owner(db, user, code, req.user_id)


@router.post("/api/v1/procedure-updates/{update_id}/withdraw")
def withdraw_procedure(update_id: str, req: WithdrawRequest, user: User = Depends(current_user), db: Session = Depends(db_dep)):
    """No longer valid (equipment modified, better method found). Kept in the history, gone from current guidance."""
    return library.withdraw(db, user, update_id, req.reason)


@router.get("/api/v1/faults/{fault_id}/procedure-matches")
def procedure_matches(fault_id: str, user: User = Depends(current_user), db: Session = Depends(db_dep)):
    """At write-up: approved procedures this fix might add to, instead of starting a duplicate."""
    fault = db.get(Fault, fault_id)
    if not fault:
        raise HTTPException(status_code=404, detail="Fault not found")
    require_fault_scope(user, fault)
    return library.matches_for_fault(db, fault)


@router.get("/api/v1/me/knowledge-impact")
def knowledge_impact(user: User = Depends(current_user), db: Session = Depends(db_dep)):
    return library.my_impact(db, user)
