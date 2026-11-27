from __future__ import annotations

from datetime import datetime
from datetime import timedelta
from datetime import timezone
from fastapi import Depends
from fastapi import HTTPException
from jose import jwt
from sqlalchemy import select
from sqlalchemy.orm import Session
from fastapi import APIRouter

from app.core.config import settings
from app.db import db_dep
from app.deps import current_user
from app.models import User, utcnow
from app.schemas import LoginRequest
from app.services import accounts
from app.services.access import role_definition, role_key, user_payload
from app.services.audit import audit_user_change
from app.services.workspace import LEVELS, access_version

router = APIRouter()

INVALID = "Wrong email or password."


def issue_token(user: User, extra: dict | None = None, hours: float | None = None) -> str:
    """Signed claims about this account. The server re-checks `av` and `pv` on every request:
    a change of role, section or status (av) or of password (pv) ends the session.
    `view_as` in `extra` marks a read-only session the developer opened as someone else."""
    claims = {
        "sub": user.id,
        "email": user.email,
        "role": role_key(user),
        "level": LEVELS.get(role_key(user), ""),
        "section": user.section,
        "av": access_version(user),
        "pv": accounts.password_version(user),
        "exp": datetime.now(timezone.utc) + timedelta(hours=hours or settings.jwt_lifetime_hours),
        **(extra or {}),
    }
    return jwt.encode(claims, settings.jwt_secret, algorithm="HS256")


@router.post("/api/v1/auth/login")
def login(req: LoginRequest, db: Session = Depends(db_dep)):
    """Sign in with a company email. The same message for an unknown email or a wrong password."""
    email = accounts.normalize_email(req.email)
    user = accounts.find_by_email(db, email)
    if not user:
        raise HTTPException(status_code=401, detail=INVALID)
    if accounts.is_locked(user):
        raise HTTPException(status_code=429, detail=f"Too many wrong passwords. Try again in {settings.login_lock_minutes} minutes, or reset your password.")
    if not accounts.password_matches(user, req.password):
        accounts.record_failed_login(user)
        if accounts.is_locked(user):
            audit_user_change(db, user.id, "ACCOUNT_LOCKED", user, {"after_wrong_passwords": settings.login_attempts_before_lock})
        db.commit()
        raise HTTPException(status_code=401, detail=INVALID)
    user.failed_logins = 0
    # Only someone who knows the password learns the account's status.
    blocked = accounts.status_message(user)
    if blocked:
        db.commit()
        raise HTTPException(status_code=403, detail={"message": blocked, "account_status": user.account_status})
    user.last_login_at = utcnow()
    audit_user_change(db, user.id, "SIGNED_IN", user, {})
    db.commit()
    return {"access_token": issue_token(user), "token_type": "Bearer", "user": user_payload(user)}


@router.get("/api/v1/auth/demo-accounts")
def demo_accounts(db: Session = Depends(db_dep)):
    """Seeded demonstration accounts only (never people who enrolled)."""
    users = db.scalars(select(User).where(User.id.like("USER-%")).order_by(User.role, User.section, User.username)).all()
    return [
        {"email": user.email, "username": user.username, "role_label": role_definition(user)["label"], "section": user.section}
        for user in users if user.active and user.account_status == accounts.ACTIVE
    ]


@router.get("/api/v1/auth/me")
def me(user: User = Depends(current_user)):
    return user_payload(user)
