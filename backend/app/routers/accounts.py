"""Enrolment with a company email, administrator approval, password reset and "My account".

Flow (demonstration default, no mail service yet): register (details + password) -> waiting for approval
-> System Administrator approves with a role and section (or rejects with a reason). Switches in the admin
console: an emailed code first (start -> verify), or accounts that work at once without approval.
A person only ever *requests* a role; the administrator grants it.
"""
from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.db import db_dep
from app.deps import current_user
from app.models import MailOutbox, User, utcnow
from app.routers.auth import issue_token
from app.schemas import (
    EmailOnly, EnrolmentDecision, EnrolmentRegister, EnrolmentStart, EnrolmentVerify, PasswordChange, PasswordResetComplete,
)
from app.services import accounts, system_settings
from app.services.access import REGIONAL_ROLES, REGIONS, ROLE_DEFINITIONS, SECTIONS, check_region, permission_descriptions, require_roles, role_definition, user_payload
from app.services.audit import audit_user_change

router = APIRouter()

# Granted only by an administrator, never requested at enrolment.
NOT_REQUESTABLE = {"system_administrator"}
SENT = "If this address can be used, we have emailed a 6-digit code to it. The code works for {minutes} minutes."


def iso(value) -> str | None:
    return value.isoformat() if value else None


def check_role_and_section(role: str, section: str) -> str:
    if role not in ROLE_DEFINITIONS:
        raise HTTPException(status_code=422, detail="Choose a job role from the list")
    if ROLE_DEFINITIONS[role].get("section_required"):
        if section not in SECTIONS:
            raise HTTPException(status_code=422, detail="Choose your maintenance section")
        return section
    if section and section not in SECTIONS:
        raise HTTPException(status_code=422, detail="Unknown maintenance section")
    return section


def check_staff_number(value: str) -> str:
    staff_number = value.strip().upper()
    if not (3 <= len(staff_number) <= 20) or not staff_number.replace("-", "").replace("/", "").isalnum():
        raise HTTPException(status_code=422, detail="Enter your staff number (letters and numbers only)")
    return staff_number


def admins(db: Session) -> list[User]:
    return list(db.scalars(select(User).where(
        User.role == "system_administrator", User.active == 1, User.account_status == accounts.ACTIVE,
    )))


# --- enrolment --------------------------------------------------------------------------------

@router.get("/api/v1/enrolment/options")
def enrolment_options(db: Session = Depends(db_dep)):
    """Roles a person may request, the sections, and the address and password rules."""
    system_settings.apply_saved(db)
    return {
        "email_code": settings.enrolment_email_code,
        "auto_approve": settings.enrolment_auto_approve,
        "domains": settings.allowed_email_domains,
        "password_min_length": settings.password_min_length,
        "sections": list(SECTIONS),
        "regions": list(REGIONS),
        "roles": [
            {"code": code, "label": item["label"], "section_required": bool(item.get("section_required")),
             "region_required": code in REGIONAL_ROLES}
            for code, item in ROLE_DEFINITIONS.items() if code not in NOT_REQUESTABLE
        ],
        "demo_mailbox": settings.demo_mailbox,
    }


def _details(req: EnrolmentStart) -> tuple[str, str, str, str, str]:
    email = accounts.normalize_email(req.email)
    name = " ".join(req.display_name.split())
    if not (3 <= len(name) <= 100):
        raise HTTPException(status_code=422, detail="Enter your full name")
    staff_number = check_staff_number(req.staff_number)
    if req.requested_role in NOT_REQUESTABLE:
        raise HTTPException(status_code=422, detail="This role is assigned by the System Administrator, not requested")
    section = check_role_and_section(req.requested_role, req.requested_section)
    region = check_region(req.requested_role, section, req.requested_region)
    return email, name, staff_number, section, region


def _submitted(db: Session, user: User) -> dict:
    """The person has a password: wait for the administrator, or (demonstration switch) start at once."""
    requested = ROLE_DEFINITIONS[user.requested_role]["label"]
    where = f"{' — ' + user.requested_section if user.requested_section else ''}{', ' + user.requested_region + ' region' if user.requested_region else ''}"
    if settings.enrolment_auto_approve:
        user.role, user.section, user.region = user.requested_role, user.requested_section, user.requested_region or ""
        user.account_status, user.active = accounts.ACTIVE, 1
        user.decided_at, user.decision_note = utcnow(), "Approved automatically (demonstration setting)"
        audit_user_change(db, user.id, "ENROLMENT_AUTO_APPROVED", user, {"email": user.email, "role": user.role,
                                                                      "section": user.section, "region": user.region})
        return {"account_status": user.account_status,
                "message": f"Your account is ready as {requested}{where}. Sign in with {user.email} and your password."}
    user.account_status = accounts.PENDING_APPROVAL
    for admin in admins(db):
        accounts.send_mail(db, admin.email, f"Account request: {user.display_name}",
                           f"{user.display_name} ({user.email}, staff number {user.staff_number}) asks for access as "
                           f"{requested}{where}.\nReview it under User management → Account requests.")
    audit_user_change(db, user.id, "ENROLMENT_SUBMITTED", user, {"email": user.email, "requested_role": user.requested_role,
                                                                "requested_section": user.requested_section})
    return {"account_status": user.account_status,
            "message": "Your password is set. The System Administrator will now check your request; you can sign in once it is approved."}


@router.post("/api/v1/enrolment/register", status_code=status.HTTP_201_CREATED)
def enrolment_register(req: EnrolmentRegister, db: Session = Depends(db_dep)):
    """Create an account in one step: details and a password, no emailed code (demonstration; no mail service yet)."""
    system_settings.apply_saved(db)
    if settings.enrolment_email_code:
        raise HTTPException(status_code=409, detail="Accounts are confirmed by an emailed code. Use “Email me a code”.")
    email, name, staff_number, section, region = _details(req)
    existing = accounts.find_by_email(db, email)
    if existing and existing.account_status != accounts.UNVERIFIED:
        raise HTTPException(status_code=409, detail="There is already an account with this email. Sign in, or ask the System Administrator.")
    accounts.check_password(req.password, email, name)
    user = existing or User(id=str(uuid.uuid4()), email=email, username=email, role="", section="", password_hash="",
                            active=0, account_status=accounts.UNVERIFIED, created_at=utcnow())
    user.display_name, user.staff_number, user.job_title = name, staff_number, req.job_title.strip()[:80]
    user.requested_role, user.requested_section, user.requested_region = req.requested_role, section, region
    if not existing:
        db.add(user)
    accounts.set_password(user, req.password)
    result = _submitted(db, user)
    if user.account_status == accounts.ACTIVE:
        # Ready at once (demonstration switch): sign the person in straight away.
        user.last_login_at = utcnow()
        audit_user_change(db, user.id, "SIGNED_IN", user, {"after_sign_up": True})
    db.commit()
    if user.account_status == accounts.ACTIVE:
        result.update(access_token=issue_token(user), token_type="Bearer", user=user_payload(user))
    return result


@router.post("/api/v1/enrolment/start", status_code=status.HTTP_202_ACCEPTED)
def enrolment_start(req: EnrolmentStart, db: Session = Depends(db_dep)):
    """With an emailed code (when a mail service is connected): details first, then the code and a password."""
    email, name, staff_number, section, region = _details(req)

    existing = accounts.find_by_email(db, email)
    if existing and existing.account_status != accounts.UNVERIFIED:
        # Same answer as for a new address, so nobody can probe which emails have accounts.
        accounts.send_mail(db, email, "You already have a KPC Maintenance account",
                           "Someone tried to create an account with this address, which already has one.\n"
                           "Sign in, or use \"Forgot password\" if you cannot. If this was not you, ignore this email.")
        db.commit()
        return {"message": SENT.format(minutes=settings.email_code_minutes)}

    user = existing or User(
        id=str(uuid.uuid4()), email=email, username=email, role="", section="", password_hash="",
        active=0, account_status=accounts.UNVERIFIED, created_at=utcnow(),
    )
    user.display_name = name
    user.staff_number = staff_number
    user.job_title = req.job_title.strip()[:80]
    user.requested_role = req.requested_role
    user.requested_section = section
    user.requested_region = region
    if not existing:
        db.add(user)
    code = accounts.issue_code(db, email, accounts.VERIFY_EMAIL)
    if code is None:
        raise HTTPException(status_code=429, detail="Too many codes were requested for this address. Wait an hour and try again.")
    accounts.send_mail(db, email, f"Your KPC Maintenance code: {code}",
                       f"Hello {name},\n\nYour code to finish creating your account is {code}.\n"
                       f"It works for {settings.email_code_minutes} minutes. If you did not ask for it, ignore this email.")
    db.commit()
    return {"message": SENT.format(minutes=settings.email_code_minutes)}


@router.post("/api/v1/enrolment/verify")
def enrolment_verify(req: EnrolmentVerify, db: Session = Depends(db_dep)):
    email = accounts.normalize_email(req.email)
    user = accounts.find_by_email(db, email)
    if not user or user.account_status != accounts.UNVERIFIED:
        raise HTTPException(status_code=400, detail="That code is not right or has expired. Check the latest email, or ask for a new code.")
    accounts.check_password(req.password, email, user.display_name)
    accounts.use_code(db, email, accounts.VERIFY_EMAIL, req.code)
    accounts.set_password(user, req.password)
    user.email_verified_at = utcnow()
    result = _submitted(db, user)
    db.commit()
    return result


@router.get("/api/v1/enrolment/requests")
def enrolment_requests(user: User = Depends(current_user), db: Session = Depends(db_dep)):
    require_roles(user, "system_administrator")
    rows = db.scalars(select(User).where(User.account_status.in_((accounts.PENDING_APPROVAL, accounts.REJECTED)))
                      .order_by(User.created_at.desc())).all()
    staff_numbers: dict[str, list[str]] = {}
    for other in db.scalars(select(User).where(User.staff_number != "")):
        staff_numbers.setdefault(other.staff_number, []).append(other.email)
    deciders = {item.id: item.display_name for item in db.scalars(select(User).where(User.id.in_([row.decided_by_id for row in rows if row.decided_by_id])))}
    return [
        {
            "id": row.id, "email": row.email, "display_name": row.display_name, "staff_number": row.staff_number,
            "job_title": row.job_title, "requested_role": row.requested_role,
            "requested_role_label": ROLE_DEFINITIONS.get(row.requested_role, {}).get("label", row.requested_role),
            "requested_section": row.requested_section, "requested_region": row.requested_region or "",
            "account_status": row.account_status,
            "submitted_at": iso(row.email_verified_at or row.created_at), "decided_at": iso(row.decided_at),
            "decided_by": deciders.get(row.decided_by_id or ""), "decision_note": row.decision_note,
            "warnings": [f"Staff number also used by {other}" for other in staff_numbers.get(row.staff_number, []) if other != row.email],
        }
        for row in rows
    ]


def pending(db: Session, user_id: str) -> User:
    target = db.get(User, user_id)
    if not target or target.account_status != accounts.PENDING_APPROVAL:
        raise HTTPException(status_code=409, detail="This request is no longer waiting for a decision")
    return target


@router.post("/api/v1/enrolment/requests/{user_id}/approve")
def enrolment_approve(user_id: str, req: EnrolmentDecision, user: User = Depends(current_user), db: Session = Depends(db_dep)):
    require_roles(user, "system_administrator")
    target = pending(db, user_id)
    role = req.role or target.requested_role
    section = check_role_and_section(role, req.section if req.role else (req.section or target.requested_section))
    region = check_region(role, section, req.region or target.requested_region or "")
    target.role, target.section, target.region = role, section, region
    target.account_status, target.active = accounts.ACTIVE, 1
    target.decided_by_id, target.decided_at, target.decision_note = user.id, utcnow(), req.reason.strip()
    changed = role != target.requested_role or section != target.requested_section or region != (target.requested_region or "")
    label = ROLE_DEFINITIONS[role]["label"]
    accounts.send_mail(db, target.email, "Your KPC Maintenance account is ready",
                       f"Hello {target.display_name},\n\nYour account has been approved as {label}"
                       f"{' — ' + section if section else ''}{', ' + region + ' region' if region else ''}."
                       f"{' This differs from what you asked for.' if changed else ''}\nYou can now sign in with {target.email}.")
    audit_user_change(db, user.id, "ENROLMENT_APPROVED", target, {"role": role, "section": section, "region": region,
                                                                  "requested_role": target.requested_role,
                                                                  "requested_section": target.requested_section})
    db.commit()
    return user_payload(target)


@router.post("/api/v1/enrolment/requests/{user_id}/reject")
def enrolment_reject(user_id: str, req: EnrolmentDecision, user: User = Depends(current_user), db: Session = Depends(db_dep)):
    require_roles(user, "system_administrator")
    reason = req.reason.strip()
    if len(reason) < 5:
        raise HTTPException(status_code=422, detail="Give the reason; the person will see it")
    target = pending(db, user_id)
    target.account_status, target.active = accounts.REJECTED, 0
    target.decided_by_id, target.decided_at, target.decision_note = user.id, utcnow(), reason
    accounts.send_mail(db, target.email, "Your KPC Maintenance account request",
                       f"Hello {target.display_name},\n\nYour account request was not approved.\nReason: {reason}\n"
                       "Contact the System Administrator if you think this is wrong.")
    audit_user_change(db, user.id, "ENROLMENT_REJECTED", target, {"reason": reason})
    db.commit()
    return {"id": target.id, "account_status": target.account_status}


# --- passwords --------------------------------------------------------------------------------

@router.post("/api/v1/auth/password-reset/start", status_code=status.HTTP_202_ACCEPTED)
def password_reset_start(req: EmailOnly, db: Session = Depends(db_dep)):
    email = accounts.normalize_email(req.email)
    user = accounts.find_by_email(db, email)
    if user and user.account_status in (accounts.ACTIVE, accounts.PENDING_APPROVAL):
        code = accounts.issue_code(db, email, accounts.RESET_PASSWORD)
        if code:
            accounts.send_mail(db, email, f"Reset your KPC Maintenance password: {code}",
                               f"Your code to set a new password is {code}. It works for {settings.email_code_minutes} minutes.\n"
                               "If you did not ask for this, ignore this email; your password has not changed.")
            db.commit()
    # Always the same answer: no hint whether the address has an account.
    return {"message": SENT.format(minutes=settings.email_code_minutes)}


@router.post("/api/v1/auth/password-reset/complete")
def password_reset_complete(req: PasswordResetComplete, db: Session = Depends(db_dep)):
    email = accounts.normalize_email(req.email)
    user = accounts.find_by_email(db, email)
    if not user or user.account_status not in (accounts.ACTIVE, accounts.PENDING_APPROVAL):
        raise HTTPException(status_code=400, detail="That code is not right or has expired. Check the latest email, or ask for a new code.")
    accounts.check_password(req.password, email, user.display_name)
    accounts.use_code(db, email, accounts.RESET_PASSWORD, req.code)
    accounts.set_password(user, req.password)
    accounts.send_mail(db, email, "Your KPC Maintenance password was changed",
                       "Your password was just reset. If this was not you, contact the System Administrator now.")
    audit_user_change(db, user.id, "PASSWORD_RESET", user, {})
    db.commit()
    return {"message": "Password changed. Sign in with your new password."}


@router.post("/api/v1/account/password")
def change_password(req: PasswordChange, user: User = Depends(current_user), db: Session = Depends(db_dep)):
    if not accounts.password_matches(user, req.current_password):
        raise HTTPException(status_code=400, detail="Your current password is not right")
    if req.current_password == req.new_password:
        raise HTTPException(status_code=422, detail="Choose a password different from the current one")
    accounts.check_password(req.new_password, user.email, user.display_name)
    accounts.set_password(user, req.new_password)
    accounts.send_mail(db, user.email, "Your KPC Maintenance password was changed",
                       "Your password was changed from My account. If this was not you, contact the System Administrator now.")
    audit_user_change(db, user.id, "PASSWORD_CHANGED", user, {})
    db.commit()
    return {"message": "Password changed. Other devices are signed out.", "access_token": issue_token(user)}


# --- my account -------------------------------------------------------------------------------

@router.get("/api/v1/account")
def my_account(user: User = Depends(current_user), db: Session = Depends(db_dep)):
    decider = db.get(User, user.decided_by_id) if user.decided_by_id else None
    definition = role_definition(user)
    return {
        **user_payload(user),
        "staff_number": user.staff_number,
        "job_title": user.job_title,
        "approved_at": iso(user.decided_at),
        "approved_by": decider.display_name if decider else None,
        "last_login_at": iso(user.last_login_at),
        "password_changed_at": iso(user.password_changed_at),
        "can_do": permission_descriptions(definition["permissions"]),
        "can_see": definition["scope"],
    }


# --- demo mailbox -----------------------------------------------------------------------------

@router.get("/api/v1/demo/mailbox")
def demo_mailbox(email: str, db: Session = Depends(db_dep)):
    """Messages the system would have emailed. Demonstration only: disabled with DEMO_MAILBOX=false."""
    if not settings.demo_mailbox:
        raise HTTPException(status_code=404, detail="Not available")
    address = accounts.normalize_email(email)
    messages = db.scalars(select(MailOutbox).where(MailOutbox.recipient == address)
                          .order_by(MailOutbox.created_at.desc()).limit(20)).all()
    return [{"id": item.id, "subject": item.subject, "body": item.body, "sent_at": iso(item.created_at)} for item in messages]
