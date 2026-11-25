"""Weekly, monthly and financial-year reports (services/reports.py)."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.db import db_dep
from app.deps import current_user
from app.models import User
from app.services import reports
from app.services.access import SECTIONS, require_roles, role_key
from app.services.workspace import ANALYTICS_ORG_WIDE

router = APIRouter()


class SubscriptionUpdate(BaseModel):
    kind: str
    enabled: bool


def scope_for(user: User, requested: str) -> tuple[str | None, bool]:
    """Section leads always get their own section; org-wide roles may pick one; the CEO gets the headline version."""
    section, headline_only = reports.report_scope(user)
    if role_key(user) in ANALYTICS_ORG_WIDE and requested:
        if requested not in SECTIONS:
            raise HTTPException(status_code=422, detail="Unknown section")
        section = requested
    return section, headline_only


@router.get("/api/v1/reports/periods")
def report_periods(kind: str = "week", user: User = Depends(current_user)):
    reports.report_scope(user)
    default = reports.resolve(kind, None)
    return {
        "kinds": [{"kind": key, "label": label} for key, label in reports.KINDS.items()],
        "periods": reports.recent(kind),
        "default": default.key,
    }


@router.get("/api/v1/reports/{kind}")
def report(kind: str, period: str | None = None, section: str = "", user: User = Depends(current_user), db: Session = Depends(db_dep)):
    scope, headline_only = scope_for(user, section)
    data = reports.build(db, kind, period, scope, headline_only=headline_only)
    return {**data, "link": reports.link(data)}


@router.post("/api/v1/reports/{kind}/email")
def email_report(kind: str, period: str | None = None, section: str = "", user: User = Depends(current_user), db: Session = Depends(db_dep)):
    """Send this report to my own KPC email now."""
    scope, headline_only = scope_for(user, section)
    data = reports.build(db, kind, period, scope, headline_only=headline_only)
    subject, body = reports.email_text(data, user.display_name)
    reports.accounts.send_mail(db, user.email, subject, body)
    db.commit()
    return {"message": f"Sent to {user.email}.", "subject": subject}


@router.get("/api/v1/account/report-subscriptions")
def my_subscriptions(user: User = Depends(current_user), db: Session = Depends(db_dep)):
    return {
        "subscriptions": reports.subscriptions(db, user),
        "schedule": "Weekly: Monday 07:00 for the week before. Monthly: the 1st at 07:00 for the month before. "
                    "Financial year: 1 July at 07:00 for the year to 30 June. Kenya time.",
    }


@router.put("/api/v1/account/report-subscriptions")
def update_subscription(req: SubscriptionUpdate, user: User = Depends(current_user), db: Session = Depends(db_dep)):
    reports.set_subscription(db, user, req.kind, req.enabled)
    db.commit()
    return {"subscriptions": reports.subscriptions(db, user)}


@router.post("/api/v1/reports/send-due")
def send_due_now(user: User = Depends(current_user), db: Session = Depends(db_dep)):
    """System Administrator: send any scheduled report that is due and not yet sent (normally automatic)."""
    require_roles(user, "system_administrator")
    return {"sent": reports.send_due(db)}
