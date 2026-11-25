from __future__ import annotations

from datetime import date
from fastapi import Depends
from fastapi import HTTPException
from fastapi import status
from sqlalchemy import select
from sqlalchemy.orm import Session
import uuid
from fastapi import APIRouter

from app.db import db_dep
from app.deps import current_user
from app.models import User, UserAudit, utcnow
from app.services import accounts
from app.schemas import UserAccessUpdate, UserCreate, UserStatusUpdate
from app.services.access import ROLE_DEFINITIONS, SECTIONS, check_region, require_roles, role_definition, role_key, user_payload
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
    # Approved accounts only; requests in progress are under /enrolment/requests.
    users = db.scalars(select(User).where(User.account_status.in_((accounts.ACTIVE, accounts.DISABLED)))
                       .order_by(User.section, User.role, User.display_name)).all()
    return [
        {"id": item.id, "username": item.username, "email": item.email, "display_name": item.display_name,
         "role": role_key(item), "role_label": role_definition(item)["label"], "section": item.section,
         "region": item.region or "", "active": bool(item.active), "last_login_at": item.last_login_at.isoformat() if item.last_login_at else None}
        for item in users
    ]


@router.get("/api/v1/users/summary")
def users_summary(user: User = Depends(current_user), db: Session = Depends(db_dep)):
    require_roles(user, "hr_officer", "maintenance_manager", "general_manager_om", "system_administrator")
    users = db.scalars(select(User).where(User.account_status.in_((accounts.ACTIVE, accounts.DISABLED)))).all()
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
    """Create an account directly (for someone who cannot enrol themselves). Same email and password rules."""
    require_roles(user, "system_administrator")
    email = accounts.normalize_email(req.email)
    if req.role not in ROLE_DEFINITIONS:
        raise HTTPException(status_code=422, detail="Unknown role")
    if not req.display_name.strip():
        raise HTTPException(status_code=422, detail="Enter the person's full name")
    section_required = ROLE_DEFINITIONS[req.role].get("section_required", False)
    if section_required and req.section not in SECTIONS:
        raise HTTPException(status_code=422, detail="A valid maintenance section is required for this role")
    if not section_required and req.section and req.section not in SECTIONS:
        raise HTTPException(status_code=422, detail="Unknown maintenance section")
    region = check_region(req.role, req.section, req.region)
    accounts.check_password(req.password, email, req.display_name)
    if accounts.find_by_email(db, email):
        raise HTTPException(status_code=409, detail="An account with this email already exists")
    now = utcnow()
    created = User(
        id=str(uuid.uuid4()), email=email, username=email, display_name=" ".join(req.display_name.split()),
        staff_number=req.staff_number.strip().upper(), job_title=req.job_title.strip(),
        role=req.role, section=req.section, region=region, active=1, account_status=accounts.ACTIVE,
        decided_by_id=user.id, decided_at=now, created_at=now, email_verified_at=None,
    )
    accounts.set_password(created, req.password)
    db.add(created)
    accounts.send_mail(db, email, "A KPC Maintenance account was created for you",
                       f"Hello {created.display_name},\n\nThe System Administrator created an account for you as "
                       f"{ROLE_DEFINITIONS[req.role]['label']}{' — ' + req.section if req.section else ''}.\n"
                       "You will receive a temporary password separately. Change it from My account after you sign in.")
    audit_user_change(db, user.id, "USER_CREATED", created, {"email": email, "role": created.role, "section": created.section, "region": region})
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
    if target.account_status not in (accounts.ACTIVE, accounts.DISABLED):
        raise HTTPException(status_code=409, detail="Decide this account request under Account requests first")
    target.active = int(req.active)
    target.account_status = accounts.ACTIVE if req.active else accounts.DISABLED
    audit_user_change(db, user.id, "USER_STATUS_CHANGED", target, {"active": bool(target.active)})
    db.commit()
    return {"id": target.id, "active": bool(target.active)}


@router.patch("/api/v1/users/{user_id}/access")
def update_user_access(user_id: str, req: UserAccessUpdate, user: User = Depends(current_user), db: Session = Depends(db_dep)):
    """Change a person's level and section (e.g. promotion ST -> PT). Their current session ends at once,
    so they sign in again and get the view for the new level."""
    require_roles(user, "system_administrator")
    target = db.get(User, user_id)
    if not target or target.account_status not in (accounts.ACTIVE, accounts.DISABLED):
        raise HTTPException(status_code=404, detail="Account not found")
    if target.id == user.id:
        raise HTTPException(status_code=409, detail="Another administrator must change your own access")
    if req.role not in ROLE_DEFINITIONS:
        raise HTTPException(status_code=422, detail="Unknown role")
    section_required = ROLE_DEFINITIONS[req.role].get("section_required", False)
    if section_required and req.section not in SECTIONS:
        raise HTTPException(status_code=422, detail="A valid maintenance section is required for this role")
    section = req.section if section_required or req.section in SECTIONS else ""
    region = check_region(req.role, section, req.region or target.region or "")
    before = {"role": role_key(target), "section": target.section, "region": target.region or ""}
    after = {"role": req.role, "section": section, "region": region}
    if before == after:
        return user_payload(target)
    target.role, target.section, target.region = req.role, section, region
    accounts.send_mail(db, target.email, "Your KPC Maintenance access has changed",
                       f"Hello {target.display_name},\n\nYour access is now {ROLE_DEFINITIONS[req.role]['label']}"
                       f"{' — ' + section if section else ''}{', ' + region + ' region' if region else ''}. Sign in again to see your updated view.")
    audit_user_change(db, user.id, "USER_ACCESS_CHANGED", target, {"before": before, "after": after})
    db.commit()
    return user_payload(target)


@router.get("/api/v1/users/audit")
def user_audit(user: User = Depends(current_user), db: Session = Depends(db_dep)):
    require_roles(user, "system_administrator")
    entries = db.scalars(select(UserAudit).order_by(UserAudit.created_at.desc()).limit(200)).all()
    return [{"id": item.id, "actor_id": item.actor_id, "action": item.action, "target_user_id": item.target_user_id, "details": item.details, "created_at": item.created_at.isoformat()} for item in entries]
