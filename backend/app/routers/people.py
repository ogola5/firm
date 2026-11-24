from __future__ import annotations

from datetime import date
from fastapi import Depends
from fastapi import HTTPException
from fastapi import status
from sqlalchemy import select
from sqlalchemy.orm import Session
import bcrypt
import uuid
from fastapi import APIRouter

from app.db import db_dep
from app.deps import current_user
from app.models import User, UserAudit
from app.schemas import UserCreate, UserStatusUpdate
from app.services.access import ROLE_DEFINITIONS, SECTIONS, require_roles, role_definition, role_key, user_payload
from app.services.audit import audit_user_change
from app.services.people import contribution_rows

router = APIRouter()

@router.get("/api/v1/access/roles")
def access_roles(user: User = Depends(current_user)):
    require_roles(user, "system_administrator")
    return [
        {"code": code, "label": definition["label"], "scope": definition["scope"], "section_required": definition.get("section_required", False), "permissions": definition["permissions"]}
        for code, definition in ROLE_DEFINITIONS.items()
    ]


@router.get("/api/v1/users")
def list_users(user: User = Depends(current_user), db: Session = Depends(db_dep)):
    require_roles(user, "hr_officer", "system_administrator")
    users = db.scalars(select(User).order_by(User.section, User.role, User.display_name)).all()
    return [
        {"id": item.id, "username": item.username, "display_name": item.display_name, "role": role_key(item), "role_label": role_definition(item)["label"], "section": item.section, "active": bool(item.active)}
        for item in users
    ]


@router.get("/api/v1/users/summary")
def users_summary(user: User = Depends(current_user), db: Session = Depends(db_dep)):
    require_roles(user, "hr_officer", "maintenance_manager", "general_manager_om", "system_administrator")
    users = db.scalars(select(User)).all()
    by_section: dict[str, int] = {}
    by_role: dict[str, int] = {}
    active_count = 0
    for item in users:
        section = item.section or "Management / cross-section"
        by_section[section] = by_section.get(section, 0) + 1
        role = role_definition(item)["label"]
        by_role[role] = by_role.get(role, 0) + 1
        active_count += int(bool(item.active))
    return {
        "total_accounts": len(users),
        "active_accounts": active_count,
        "inactive_accounts": len(users) - active_count,
        "by_section": by_section,
        "by_role": by_role,
        "personal_details_included": False,
        "data_type": "Synthetic demonstration workforce counts",
    }


@router.get("/api/v1/hr/appraisal")
def hr_appraisal(
    start_date: date | None = None,
    end_date: date | None = None,
    user: User = Depends(current_user),
    db: Session = Depends(db_dep),
):
    require_roles(user, "hr_officer")
    if start_date and end_date and start_date > end_date:
        raise HTTPException(status_code=422, detail="Start date must not be after end date")
    return {
        "period": {"from": start_date.isoformat() if start_date else None, "to": end_date.isoformat() if end_date else None},
        "data_type": "Illustrative synthetic contribution evidence; not an approved appraisal score",
        "point_definition": "10 per approved procedure, 2 additional per approved revision, and 5 per colleague-confirmed successful reuse",
        "rows": contribution_rows(db, start_date, end_date),
    }


@router.get("/api/v1/recognition/leaderboard")
def recognition_leaderboard(user: User = Depends(current_user), db: Session = Depends(db_dep)):
    require_roles(user, "maintenance_manager", "general_manager_om", "hr_officer", "supervisor", "system_administrator")
    rows = contribution_rows(db, None, None)
    leaderboard = [
        {
            "rank": index,
            "employee_name": row["employee_name"],
            "role": row["role"],
            "section": row["section"],
            "points": row["illustrative_recognition_points"],
            "verified_reuses": row["colleague_reuses"],
            "approved_procedures": row["procedure_updates_approved"],
            "approved_revisions": row["approved_revisions"],
        }
        for index, row in enumerate(
            sorted(rows, key=lambda item: (
                -item["illustrative_recognition_points"],
                -item["colleague_reuses"],
                item["employee_name"],
            )),
            start=1,
        )
        if row["illustrative_recognition_points"] > 0
    ]
    return {
        "platform": "SOCA-compatible recognition model",
        "integration_status": "Illustrative local model; external SOCA connection not configured",
        "recognition_rule": "Verified reuse and approved revision drive recognition; report volume is excluded",
        "leaderboard": leaderboard,
    }


@router.post("/api/v1/users", status_code=status.HTTP_201_CREATED)
def create_user(req: UserCreate, user: User = Depends(current_user), db: Session = Depends(db_dep)):
    require_roles(user, "system_administrator")
    if req.role not in ROLE_DEFINITIONS:
        raise HTTPException(status_code=422, detail="Unknown role")
    if not req.username.strip() or not req.display_name.strip() or len(req.password) < 8:
        raise HTTPException(status_code=422, detail="Username and display name are required; password must be at least 8 characters")
    section_required = ROLE_DEFINITIONS[req.role].get("section_required", False)
    if section_required and req.section not in SECTIONS:
        raise HTTPException(status_code=422, detail="A valid maintenance section is required for this role")
    if not section_required and req.section and req.section not in SECTIONS:
        raise HTTPException(status_code=422, detail="Unknown maintenance section")
    if db.scalar(select(User).where(User.username == req.username.strip())):
        raise HTTPException(status_code=409, detail="Username already exists")
    created = User(
        id=str(uuid.uuid4()),
        username=req.username.strip(),
        display_name=req.display_name.strip(),
        role=req.role,
        section=req.section,
        password_hash=bcrypt.hashpw(req.password.encode(), bcrypt.gensalt()).decode(),
    )
    db.add(created)
    audit_user_change(db, user.id, "USER_CREATED", created, {"username": created.username, "role": created.role, "section": created.section})
    db.commit()
    return user_payload(created)


@router.patch("/api/v1/users/{user_id}/status")
def update_user_status(user_id: str, req: UserStatusUpdate, user: User = Depends(current_user), db: Session = Depends(db_dep)):
    require_roles(user, "system_administrator")
    target = db.get(User, user_id)
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    if target.id == user.id and not req.active:
        raise HTTPException(status_code=409, detail="You cannot deactivate your own account")
    target.active = int(req.active)
    audit_user_change(db, user.id, "USER_STATUS_CHANGED", target, {"active": bool(target.active)})
    db.commit()
    return {"id": target.id, "active": bool(target.active)}


@router.get("/api/v1/users/audit")
def user_audit(user: User = Depends(current_user), db: Session = Depends(db_dep)):
    require_roles(user, "system_administrator")
    entries = db.scalars(select(UserAudit).order_by(UserAudit.created_at.desc()).limit(200)).all()
    return [{"id": item.id, "actor_id": item.actor_id, "action": item.action, "target_user_id": item.target_user_id, "details": item.details, "created_at": item.created_at.isoformat()} for item in entries]
