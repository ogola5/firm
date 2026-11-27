"""Rules and switches the System Administrator changes in the admin console.

Defaults live in core/config.py (and environment variables). A change made in the app is stored in
`app_settings` and applied over the default, in this process and in every other one when it next
loads (apply_saved runs at start-up, before each scheduled run and on each config request).
Only the keys listed here can be changed in the app; secrets and infrastructure never can.
"""
from __future__ import annotations

import json
from dataclasses import dataclass

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models import AppSetting, User, utcnow
from app.services.audit import audit_user_change


@dataclass(frozen=True)
class Rule:
    key: str
    group: str
    label: str
    help: str
    kind: str  # "int", "bool" or "text"
    minimum: int = 0
    maximum: int = 0
    developer_only: bool = False


RULES: tuple[Rule, ...] = (
    Rule("untaken_alert_minutes", "Work", "Show untaken jobs to other sections and the Chief Technician after (minutes)",
         "Anyone free can take a job at once; after this long, other sections and the Chief Technician are told nobody has.", "int", 1, 240),
    Rule("response_minutes_critical", "Response targets", "Critical: respond within (minutes)", "Set on each new fault; overdue after this.", "int", 5, 1440),
    Rule("response_minutes_high", "Response targets", "High: respond within (minutes)", "Set on each new fault; overdue after this.", "int", 5, 2880),
    Rule("response_minutes_medium", "Response targets", "Medium: respond within (minutes)", "Set on each new fault; overdue after this.", "int", 5, 10080),
    Rule("response_minutes_low", "Response targets", "Low: respond within (minutes)", "Set on each new fault; overdue after this.", "int", 5, 20160),
    Rule("se_after_hours", "Escalation", "To the regional Senior Engineer when not working again after (hours)",
         "Counted from the report.", "int", 1, 168),
    Rule("ce_repeat_days", "Escalation", "To the section Chief Engineer when it fails again within (days) of a fix",
         "A repeat this soon means the fix did not hold.", "int", 1, 365),
    Rule("knowledge_fade_days", "Knowledge", "A procedure is shown as fading when not confirmed working for (days)",
         "So people check it before relying on it.", "int", 30, 1825),
    Rule("login_attempts_before_lock", "Sign-in", "Wrong passwords before the account locks", "", "int", 3, 20),
    Rule("login_lock_minutes", "Sign-in", "Locked for (minutes)", "", "int", 1, 1440),
    Rule("password_min_length", "Sign-in", "Shortest password allowed (characters)", "Applies to new passwords.", "int", 8, 64),
    Rule("banner_text", "Developer", "Message at the top of every screen", "For example planned maintenance, or \"Demonstration in progress\". Empty hides it.",
         "text", 0, 200, developer_only=True),
    Rule("feature_guided_demo", "Developer", "Guided demo link on the sign-in page", "", "bool", developer_only=True),
    Rule("feature_network_simulator", "Developer", "Network simulator (online / offline) on the sign-in page", "", "bool", developer_only=True),
)
BY_KEY = {rule.key: rule for rule in RULES}
# The defaults as started (environment or core/config.py), so "Reset to default" works.
DEFAULTS = {rule.key: getattr(settings, rule.key) for rule in RULES}


def _decode(rule: Rule, raw: str):
    value = json.loads(raw)
    return bool(value) if rule.kind == "bool" else int(value) if rule.kind == "int" else str(value)


def apply_saved(db: Session) -> None:
    """Put the values saved in the app over the defaults."""
    saved = {row.key: row.value for row in db.scalars(select(AppSetting))}
    for rule in RULES:
        try:
            setattr(settings, rule.key, _decode(rule, saved[rule.key]) if rule.key in saved else DEFAULTS[rule.key])
        except (ValueError, TypeError, json.JSONDecodeError):
            setattr(settings, rule.key, DEFAULTS[rule.key])


def listing(db: Session, user: User) -> list[dict]:
    apply_saved(db)
    saved = {row.key: row for row in db.scalars(select(AppSetting))}
    names = {person.id: person.display_name for person in db.scalars(select(User).where(
        User.id.in_([row.updated_by_id for row in saved.values() if row.updated_by_id])))}
    rows = []
    for rule in RULES:
        if rule.developer_only and not user.developer:
            continue
        row = saved.get(rule.key)
        rows.append({
            "key": rule.key, "group": rule.group, "label": rule.label, "help": rule.help, "kind": rule.kind,
            "minimum": rule.minimum, "maximum": rule.maximum, "developer_only": rule.developer_only,
            "value": getattr(settings, rule.key), "default": DEFAULTS[rule.key], "changed": row is not None,
            "updated_by": names.get(row.updated_by_id, "") if row else "",
            "updated_at": row.updated_at.isoformat() if row and row.updated_at else None,
        })
    return rows


def change(db: Session, user: User, key: str, value, reset: bool = False) -> dict:
    rule = BY_KEY.get(key)
    if not rule:
        raise HTTPException(status_code=404, detail="Unknown setting")
    if rule.developer_only and not user.developer:
        raise HTTPException(status_code=403, detail="Only the developer can change this")
    before = getattr(settings, key)
    row = db.get(AppSetting, key)
    if reset:
        if row:
            db.delete(row)
        new = DEFAULTS[key]
    else:
        if rule.kind == "int":
            if isinstance(value, bool) or not isinstance(value, (int, float)) or int(value) != value:
                raise HTTPException(status_code=422, detail="Enter a whole number")
            new = int(value)
            if not rule.minimum <= new <= rule.maximum:
                raise HTTPException(status_code=422, detail=f"Choose a number from {rule.minimum} to {rule.maximum}")
        elif rule.kind == "bool":
            if not isinstance(value, bool):
                raise HTTPException(status_code=422, detail="Choose on or off")
            new = value
        else:
            new = str(value or "").strip()
            if len(new) > rule.maximum:
                raise HTTPException(status_code=422, detail=f"At most {rule.maximum} characters")
        if row is None:
            row = AppSetting(key=key, value="")
            db.add(row)
        row.value = json.dumps(new)
        row.updated_by_id = user.id
        row.updated_at = utcnow()
    setattr(settings, key, new)
    audit_user_change(db, user.id, "SETTING_CHANGED", None, {"key": key, "label": rule.label, "from": before, "to": new,
                                                             "reset": reset}, target=f"setting:{key}")
    return {"key": key, "value": new}


def public_config() -> dict:
    """What every screen (and the sign-in page) needs: the banner and the feature switches."""
    return {
        "banner": settings.banner_text,
        "features": {"guided_demo": settings.feature_guided_demo, "network_simulator": settings.feature_network_simulator},
    }
