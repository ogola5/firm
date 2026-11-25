"""Company-email accounts: address rules, passwords, one-time codes and outgoing mail.

The rules live here so enrolment, sign-in, password reset and administrator
account creation all apply exactly the same checks.
"""
from __future__ import annotations

import hashlib
import hmac
import re
import secrets
import uuid
from datetime import datetime, timedelta

import bcrypt
from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models import EmailCode, MailOutbox, User, utc_datetime, utcnow

VERIFY_EMAIL = "VERIFY_EMAIL"
RESET_PASSWORD = "RESET_PASSWORD"

ACTIVE = "ACTIVE"
UNVERIFIED = "UNVERIFIED"
PENDING_APPROVAL = "PENDING_APPROVAL"
REJECTED = "REJECTED"
DISABLED = "DISABLED"

# Local part: letters, digits and . _ - (no leading/trailing/double dots). Plus-addressing is not
# allowed: one person, one address.
LOCAL_PART = re.compile(r"^[a-z0-9](?:[a-z0-9_-]|\.(?!\.))*(?<!\.)$")


def domain_hint() -> str:
    return " or ".join(f"@{domain}" for domain in settings.allowed_email_domains)


def normalize_email(raw: str) -> str:
    """Lower-cased company address, or 422. The domain must match exactly (no sub-domains)."""
    email = (raw or "").strip().lower()
    if email.count("@") != 1:
        raise HTTPException(status_code=422, detail=f"Enter your KPC email address (ending {domain_hint()}).")
    local, domain = email.split("@")
    if domain not in settings.allowed_email_domains:
        raise HTTPException(status_code=422, detail=f"Use your KPC email address (ending {domain_hint()}). Personal or other addresses cannot be used.")
    if not local or len(email) > 254 or not LOCAL_PART.match(local):
        raise HTTPException(status_code=422, detail="This email address is not valid.")
    return email


def check_password(password: str, email: str = "", display_name: str = "") -> None:
    """At least N characters, letters and digits, and not built from the person's name or address."""
    problems = []
    if len(password) < settings.password_min_length:
        problems.append(f"at least {settings.password_min_length} characters")
    if not re.search(r"[A-Za-z]", password) or not re.search(r"\d", password):
        problems.append("both letters and numbers")
    lowered = password.lower()
    personal = [email.split("@")[0]] + [part for part in re.split(r"[\s.]+", display_name.lower()) if len(part) >= 4]
    if any(part and len(part) >= 4 and part in lowered for part in personal):
        problems.append("not your name or email")
    if lowered in {"password123", "kpc12345678", "demo1234567"}:
        problems.append("not a common password")
    if problems:
        raise HTTPException(status_code=422, detail="Password must have " + ", ".join(problems) + ".")


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()


def password_matches(user: User, password: str) -> bool:
    if not user.password_hash:
        return False
    try:
        return bcrypt.checkpw(password.encode(), user.password_hash.encode())
    except ValueError:
        return False


def set_password(user: User, password: str) -> None:
    user.password_hash = hash_password(password)
    user.password_changed_at = utcnow()
    user.failed_logins = 0
    user.locked_until = None


def find_by_email(db: Session, email: str) -> User | None:
    return db.scalar(select(User).where(User.email == email))


def _code_hash(email: str, purpose: str, code: str) -> str:
    return hmac.new(settings.jwt_secret.encode(), f"{purpose}:{email}:{code}".encode(), hashlib.sha256).hexdigest()


def issue_code(db: Session, email: str, purpose: str) -> str | None:
    """A new 6-digit code (earlier unused ones stop working). None if too many were sent this hour."""
    now = utcnow()
    recent = db.scalar(select(func.count(EmailCode.id)).where(
        EmailCode.email == email, EmailCode.purpose == purpose, EmailCode.created_at >= now - timedelta(hours=1),
    )) or 0
    if recent >= settings.email_codes_per_hour:
        return None
    for old in db.scalars(select(EmailCode).where(EmailCode.email == email, EmailCode.purpose == purpose, EmailCode.used_at.is_(None))):
        old.used_at = now
    code = f"{secrets.randbelow(1_000_000):06d}"
    db.add(EmailCode(
        id=str(uuid.uuid4()), email=email, purpose=purpose, code_hash=_code_hash(email, purpose, code),
        expires_at=now + timedelta(minutes=settings.email_code_minutes), created_at=now,
    ))
    return code


def use_code(db: Session, email: str, purpose: str, code: str) -> None:
    """Accept the latest live code once, or 400. Wrong guesses count against it."""
    invalid = HTTPException(status_code=400, detail="That code is not right or has expired. Check the latest email, or ask for a new code.")
    current = db.scalar(select(EmailCode).where(
        EmailCode.email == email, EmailCode.purpose == purpose, EmailCode.used_at.is_(None),
    ).order_by(EmailCode.created_at.desc()))
    now = utcnow()
    if not current or utc_datetime(current.expires_at) <= now or current.attempts >= settings.email_code_attempts:
        raise invalid
    if not hmac.compare_digest(current.code_hash, _code_hash(email, purpose, (code or "").strip())):
        current.attempts += 1
        db.commit()
        raise invalid
    current.used_at = now


def send_mail(db: Session, recipient: str, subject: str, body: str) -> None:
    """Record the message. The prototype has no mail server: see the demo mailbox."""
    db.add(MailOutbox(id=str(uuid.uuid4()), recipient=recipient, subject=subject, body=body, created_at=utcnow()))


def is_locked(user: User, now: datetime | None = None) -> bool:
    return bool(user.locked_until and utc_datetime(user.locked_until) > (now or utcnow()))


def record_failed_login(user: User) -> None:
    user.failed_logins = (user.failed_logins or 0) + 1
    if user.failed_logins >= settings.login_attempts_before_lock:
        user.locked_until = utcnow() + timedelta(minutes=settings.login_lock_minutes)
        user.failed_logins = 0


def status_message(user: User) -> str | None:
    """Why a correctly-authenticated person still cannot sign in, in plain words."""
    if user.account_status == UNVERIFIED:
        return "Finish creating your account: enter the code we emailed you."
    if user.account_status == PENDING_APPROVAL:
        return "Your account is waiting for approval by the System Administrator. You will get an email when it is approved."
    if user.account_status == REJECTED:
        reason = f" Reason: {user.decision_note}" if user.decision_note else ""
        return f"Your account request was not approved.{reason} Contact the System Administrator."
    if user.account_status == DISABLED or not user.active:
        return "This account is disabled. Contact the System Administrator."
    return None


def password_version(user: User) -> int:
    """Changes whenever the password changes, so older sessions stop working."""
    return int(utc_datetime(user.password_changed_at).timestamp()) if user.password_changed_at else 0
