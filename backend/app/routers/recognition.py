"""Points, redemptions and awards (services/points.py). HR manages; everyone sees their own and the awards."""
from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import db_dep
from app.deps import current_user
from app.models import Award, HRSetting, PointEntry, PointRedemption, PointRule, User, utc_datetime, utcnow
from app.services import accounts, points
from app.services.access import SECTIONS, require_roles, role_definition, role_key
from app.services.audit import audit_user_change
from app.services.reports import fy_key, fy_start_year, recent as recent_report_periods
from app.services.analytics.periods import local_zone

router = APIRouter()

MANAGERS = ("hr_officer",)
VIEWERS = ("hr_officer", "maintenance_manager", "general_manager_om", "supervisor", "system_administrator")


class RedemptionCreate(BaseModel):
    user_id: str
    points: int = Field(gt=0, le=100000)
    option: str
    value_text: str = Field(default="", max_length=120)
    note: str = Field(default="", max_length=1000)


class RuleUpdate(BaseModel):
    kind: str
    points: int = Field(ge=0, le=1000)
    active: bool = True


class RulesUpdate(BaseModel):
    rules: list[RuleUpdate] = []
    monthly_cap: int | None = Field(default=None, ge=0, le=100000)
    point_value: str | None = Field(default=None, max_length=200)


class AwardCreate(BaseModel):
    award_type: str
    period: str | None = None
    scope: str = "Overall"
    user_id: str
    citation: str = Field(min_length=10, max_length=2000)
    prize: str = Field(default="", max_length=200)


def rules_payload(db: Session) -> dict:
    return {
        "rules": [{"kind": item.kind, "label": item.label, "points": item.points, "description": item.description, "active": bool(item.active)}
                  for item in sorted(points.rules(db).values(), key=lambda rule: -rule.points)],
        "monthly_cap": points.monthly_cap(db),
        "point_value": points.setting(db, "point_value", ""),
        "principle": "Points come only from verified contributions that help colleagues. Speed and number of reports never earn points.",
    }


@router.get("/api/v1/points/me")
def my_points(user: User = Depends(current_user), db: Session = Depends(db_dep)):
    points.sync(db)
    rule_map = points.rules(db)
    entries = db.scalars(select(PointEntry).where(PointEntry.user_id == user.id).order_by(PointEntry.earned_at.desc()).limit(200)).all()
    this_month = utcnow().astimezone(local_zone()).strftime("%Y-%m")
    month_total = sum(item.points for item in entries if utc_datetime(item.earned_at).astimezone(local_zone()).strftime("%Y-%m") == this_month)
    redemptions = db.scalars(select(PointRedemption).where(PointRedemption.user_id == user.id).order_by(PointRedemption.created_at.desc())).all()
    awards = db.scalars(select(Award).where(Award.user_id == user.id).order_by(Award.created_at.desc())).all()
    return {
        **points.balance(db, user.id),
        "this_month": month_total,
        "entries": [points.entry_payload(item, rule_map) for item in entries],
        "redemptions": [{"points": item.points, "option": points.REDEMPTION_OPTIONS.get(item.option, item.option),
                         "value_text": item.value_text, "created_at": utc_datetime(item.created_at).isoformat()} for item in redemptions],
        "awards": [points.award_payload(db, item) for item in awards],
        **rules_payload(db),
    }


@router.get("/api/v1/points/people")
def people_points(period_type: str = "YEAR", period: str | None = None, user: User = Depends(current_user), db: Session = Depends(db_dep)):
    require_roles(user, *VIEWERS)
    points.sync(db)
    key, label, first, last = points.award_period(period_type, period)
    earned = points.earned_in(db, first, last)
    holders = set(earned) | {row for row in db.scalars(select(PointEntry.user_id).distinct())}
    people = db.scalars(select(User).where(User.id.in_(list(holders)))).all() if holders else []
    rows = []
    for person in people:
        totals = points.balance(db, person.id)
        period_row = earned.get(person.id, {"points": 0, "by_kind": {}})
        rows.append({"user_id": person.id, "name": person.display_name, "role": role_definition(person)["label"],
                     "section": person.section or "Cross-section", "active": bool(person.active),
                     "period_points": period_row["points"], "by_kind": period_row["by_kind"], **totals})
    rows.sort(key=lambda item: (-item["period_points"], -item["earned"], item["name"]))
    return {"period": key, "period_label": label, "rows": rows, "can_manage": role_key(user) in MANAGERS}


@router.get("/api/v1/points/people/{user_id}")
def person_points(user_id: str, user: User = Depends(current_user), db: Session = Depends(db_dep)):
    require_roles(user, *VIEWERS)
    points.sync(db)
    person = db.get(User, user_id)
    if not person:
        raise HTTPException(status_code=404, detail="Person not found")
    rule_map = points.rules(db)
    entries = db.scalars(select(PointEntry).where(PointEntry.user_id == user_id).order_by(PointEntry.earned_at.desc()).limit(300)).all()
    return {"name": person.display_name, **points.balance(db, user_id), "entries": [points.entry_payload(item, rule_map) for item in entries]}


@router.post("/api/v1/points/redemptions", status_code=201)
def redeem(req: RedemptionCreate, user: User = Depends(current_user), db: Session = Depends(db_dep)):
    """HR records points exchanged for money, a voucher or a day off (per KPC policy)."""
    require_roles(user, *MANAGERS)
    if req.option not in points.REDEMPTION_OPTIONS:
        raise HTTPException(status_code=422, detail="Choose cash, voucher, day off or other")
    person = db.get(User, req.user_id)
    if not person:
        raise HTTPException(status_code=404, detail="Person not found")
    if person.id == user.id:
        raise HTTPException(status_code=409, detail="Another HR officer must record your own redemption")
    points.sync(db)
    available = points.balance(db, person.id)["balance"]
    if req.points > available:
        raise HTTPException(status_code=422, detail=f"Only {available} points available")
    db.add(PointRedemption(id=str(uuid.uuid4()), user_id=person.id, points=req.points, option=req.option,
                           value_text=req.value_text.strip(), note=req.note.strip(), recorded_by_id=user.id, created_at=utcnow()))
    accounts.send_mail(db, person.email, "Your recognition points were redeemed",
                       f"Hello {person.display_name},\n\n{req.points} points were exchanged for: "
                       f"{points.REDEMPTION_OPTIONS[req.option]}{' — ' + req.value_text.strip() if req.value_text.strip() else ''}.\n"
                       f"Remaining balance: {available - req.points} points.")
    audit_user_change(db, user.id, "POINTS_REDEEMED", person, {"points": req.points, "option": req.option, "value": req.value_text})
    db.commit()
    return points.balance(db, person.id)


@router.get("/api/v1/points/rules")
def get_rules(user: User = Depends(current_user), db: Session = Depends(db_dep)):
    return rules_payload(db)


@router.put("/api/v1/points/rules")
def update_rules(req: RulesUpdate, user: User = Depends(current_user), db: Session = Depends(db_dep)):
    """New values apply to points earned from now on; points already earned keep their value."""
    require_roles(user, *MANAGERS)
    for change in req.rules:
        rule = db.get(PointRule, change.kind)
        if not rule:
            raise HTTPException(status_code=422, detail=f"Unknown kind: {change.kind}")
        rule.points, rule.active = change.points, int(change.active)
    for key, value in (("monthly_cap", req.monthly_cap), ("point_value", req.point_value)):
        if value is not None:
            row = db.get(HRSetting, key) or HRSetting(key=key, value="")
            row.value = str(value)
            db.merge(row)
    audit_user_change(db, user.id, "POINT_RULES_CHANGED", user, req.model_dump())
    db.commit()
    return rules_payload(db)


def _award_periods(award_type: str) -> list[dict]:
    if award_type == "MONTH":
        return [item for item in recent_report_periods("month", count=12) if not item["partial"]]
    if award_type == "YEAR":
        return [item for item in recent_report_periods("year", count=3) if not item["partial"]]
    today = utcnow().astimezone(local_zone()).date()
    start = fy_start_year(today)
    current_quarter = (today.month - 7) % 12 // 3 + 1
    result = []
    year, quarter = start, current_quarter - 1
    for _ in range(6):
        if quarter == 0:
            year, quarter = year - 1, 4
        key = f"{fy_key(year)}-Q{quarter}"
        result.append({"key": key, "label": points.award_period("QUARTER", key)[1], "partial": False})
        quarter -= 1
    return result


@router.get("/api/v1/awards/shortlist")
def award_shortlist(award_type: str = "MONTH", period: str | None = None, scope: str = "Overall",
                    user: User = Depends(current_user), db: Session = Depends(db_dep)):
    require_roles(user, *VIEWERS)
    if scope != "Overall" and scope not in SECTIONS:
        raise HTTPException(status_code=422, detail="Scope is Overall or a section")
    points.sync(db)
    return {**points.shortlist(db, award_type, period, scope), "periods": _award_periods(award_type),
            "scopes": ["Overall", *SECTIONS], "can_award": role_key(user) in MANAGERS}


@router.post("/api/v1/awards", status_code=201)
def give_award(req: AwardCreate, user: User = Depends(current_user), db: Session = Depends(db_dep)):
    """Record the panel's decision. One award per type, period and scope."""
    require_roles(user, *MANAGERS)
    if req.scope != "Overall" and req.scope not in SECTIONS:
        raise HTTPException(status_code=422, detail="Scope is Overall or a section")
    key, label, _, _ = points.award_period(req.award_type, req.period)
    if db.scalar(select(Award).where(Award.award_type == req.award_type, Award.period_key == key, Award.scope == req.scope)):
        raise HTTPException(status_code=409, detail="This award has already been given for that period")
    person = db.get(User, req.user_id)
    if not person or not person.active:
        raise HTTPException(status_code=404, detail="Person not found")
    if req.scope != "Overall" and person.section != req.scope:
        raise HTTPException(status_code=422, detail=f"{person.display_name} is not in the {req.scope} section")
    award = Award(id=str(uuid.uuid4()), award_type=req.award_type, period_key=key, scope=req.scope, user_id=person.id,
                  citation=req.citation.strip(), prize=req.prize.strip(), decided_by_id=user.id, created_at=utcnow())
    db.add(award)
    title = f"{points.AWARD_TYPES[req.award_type]} — {label}{'' if req.scope == 'Overall' else ' — ' + req.scope}"
    accounts.send_mail(db, person.email, f"Congratulations: {title}",
                       f"Hello {person.display_name},\n\nYou have been named {title}.\n\n{req.citation.strip()}"
                       f"{chr(10) + 'Prize: ' + req.prize.strip() if req.prize.strip() else ''}\n\nThank you for sharing what you know.")
    audit_user_change(db, user.id, "AWARD_GIVEN", person, {"award": title})
    db.commit()
    return points.award_payload(db, award)


@router.get("/api/v1/awards")
def awards(user: User = Depends(current_user), db: Session = Depends(db_dep)):
    """Everyone can see the awards: recognition is meant to be public."""
    rows = db.scalars(select(Award).order_by(Award.created_at.desc()).limit(60)).all()
    return [points.award_payload(db, item) for item in rows]
