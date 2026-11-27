"""Admin console: system health, rules, organisation and the equipment register, the audit trail,
and the developer's tools (view as, demo reset).

Two levels. The System Administrator (ICT in real use) runs the system and never approves maintenance
work. The developer / owner of the standalone demonstration is a System Administrator with the
`developer` flag, and alone has the developer tools.
"""
from __future__ import annotations

import csv
import io
import json
import logging
import subprocess
import sys
import threading
import time
import uuid

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.core.config import BACKEND_ROOT
from app.db import db_dep, engine
from app.deps import current_user
from app.models import Equipment, User, UserAudit, utcnow
from app.services import system_settings, system_status
from app.services.access import REGIONS, SECTIONS, STATION_REGIONS, require_roles, role_definition, user_payload
from app.services.audit import audit_user_change

router = APIRouter()
logger = logging.getLogger("kpc")
CRITICALITY = ("Low", "Medium", "High", "Critical")
CATEGORIES = ("Automation", "Electrical", "Mechanical")


def admin_user(user: User = Depends(current_user)) -> User:
    require_roles(user, "system_administrator")
    return user


def developer_user(user: User = Depends(admin_user)) -> User:
    if not user.developer:
        raise HTTPException(status_code=403, detail="Only the developer can use this")
    return user


# --- open to every screen ------------------------------------------------------------------------

@router.get("/api/v1/system/config")
def system_config(db: Session = Depends(db_dep)):
    """The banner and feature switches (also before sign-in)."""
    system_settings.apply_saved(db)
    return system_settings.public_config()


# --- health ----------------------------------------------------------------------------------------

@router.get("/api/v1/admin/health")
def health(user: User = Depends(admin_user), db: Session = Depends(db_dep)):
    return {**system_status.health(db), "demo_reset": demo_reset_state}


# --- rules and switches ----------------------------------------------------------------------------

class SettingChange(BaseModel):
    value: bool | int | float | str | None = None
    reset: bool = False


@router.get("/api/v1/admin/settings")
def settings_list(user: User = Depends(admin_user), db: Session = Depends(db_dep)):
    return system_settings.listing(db, user)


@router.patch("/api/v1/admin/settings/{key}")
def settings_change(key: str, req: SettingChange, user: User = Depends(admin_user), db: Session = Depends(db_dep)):
    result = system_settings.change(db, user, key, req.value, reset=req.reset)
    db.commit()
    return result


# --- organisation and the equipment register -------------------------------------------------------

@router.get("/api/v1/admin/organisation")
def organisation(user: User = Depends(admin_user), db: Session = Depends(db_dep)):
    people = db.execute(select(User.section, User.region, func.count()).where(User.active == 1)
                        .group_by(User.section, User.region)).all()
    equipment = db.execute(select(Equipment.section, Equipment.region, Equipment.station, func.count())
                           .where(~Equipment.tag.like("UNCONFIRMED-%"))
                           .group_by(Equipment.section, Equipment.region, Equipment.station)).all()
    stations: dict[str, str] = dict(STATION_REGIONS)
    for _, region, station, _ in equipment:
        if station and station not in stations:
            stations[station] = region or ""
    return {
        "sections": [{
            "name": section,
            "people": sum(count for row_section, _, count in people if row_section == section),
            "equipment": sum(count for row_section, _, _, count in equipment if row_section == section),
            "people_by_region": {region: sum(count for row_section, row_region, count in people
                                             if row_section == section and row_region == region) for region in REGIONS},
        } for section in SECTIONS],
        "regions": [{"name": region, "stations": sorted(station for station, where in stations.items() if where == region)}
                    for region in REGIONS],
        "unplaced_stations": sorted(station for station, where in stations.items() if where not in REGIONS),
        "note": "Sections and regions are fixed for the demonstration; stations come from the equipment register.",
    }


class EquipmentIn(BaseModel):
    tag: str = Field(min_length=2, max_length=40)
    name: str = Field(min_length=2, max_length=120)
    section: str
    station: str = Field(min_length=2, max_length=40)
    region: str = ""
    location: str = Field(default="", max_length=120)
    category: str = ""
    criticality: str = "Medium"
    aliases: str = Field(default="", max_length=300)
    description: str = Field(default="", max_length=600)


def _clean(req: EquipmentIn) -> dict:
    tag = req.tag.strip().upper()
    if tag.startswith("UNCONFIRMED-"):
        raise HTTPException(status_code=422, detail="That tag is reserved")
    if req.section not in SECTIONS:
        raise HTTPException(status_code=422, detail="Section must be one of: " + ", ".join(SECTIONS))
    station = req.station.strip().upper()
    region = req.region.strip() or STATION_REGIONS.get(station, "")
    if region not in REGIONS:
        raise HTTPException(status_code=422, detail=f"Choose the region for station {station}: " + ", ".join(REGIONS))
    if req.criticality not in CRITICALITY:
        raise HTTPException(status_code=422, detail="Criticality must be Low, Medium, High or Critical")
    category = req.category.strip() or {"Systems Automation": "Automation"}.get(req.section, req.section)
    return {
        "tag": tag, "name": req.name.strip(), "section": req.section, "station": station, "region": region,
        "location": req.location.strip(), "category": category, "criticality": req.criticality,
        "aliases": req.aliases.strip().lower(),
        "description": req.description.strip() or "Added in the admin console for the demonstration; not a real KPC record.",
    }


def _payload(item: Equipment) -> dict:
    return {key: getattr(item, key) for key in ("id", "tag", "name", "section", "station", "region", "location", "category",
                                                "criticality", "aliases", "description")}


@router.get("/api/v1/admin/equipment")
def equipment_register(search: str = "", user: User = Depends(admin_user), db: Session = Depends(db_dep)):
    query = select(Equipment).where(~Equipment.tag.like("UNCONFIRMED-%")).order_by(Equipment.tag)
    if search.strip():
        needle = f"%{search.strip()}%"
        query = query.where(or_(Equipment.tag.ilike(needle), Equipment.name.ilike(needle), Equipment.station.ilike(needle),
                                Equipment.section.ilike(needle)))
    return [_payload(item) for item in db.scalars(query.limit(500))]


@router.post("/api/v1/admin/equipment", status_code=201)
def equipment_add(req: EquipmentIn, user: User = Depends(admin_user), db: Session = Depends(db_dep)):
    values = _clean(req)
    if db.scalar(select(Equipment.id).where(func.upper(Equipment.tag) == values["tag"])):
        raise HTTPException(status_code=409, detail=f"{values['tag']} is already in the register")
    item = Equipment(id=f"EQ-ADM-{uuid.uuid4().hex[:8]}", **values)
    db.add(item)
    audit_user_change(db, user.id, "EQUIPMENT_ADDED", None, {"tag": item.tag, "name": item.name, "section": item.section},
                      target=f"equipment:{item.id}")
    db.commit()
    return _payload(item)


@router.patch("/api/v1/admin/equipment/{equipment_id}")
def equipment_edit(equipment_id: str, req: EquipmentIn, user: User = Depends(admin_user), db: Session = Depends(db_dep)):
    item = db.get(Equipment, equipment_id)
    if not item or item.tag.startswith("UNCONFIRMED-"):
        raise HTTPException(status_code=404, detail="Equipment not found")
    values = _clean(req)
    clash = db.scalar(select(Equipment.id).where(func.upper(Equipment.tag) == values["tag"], Equipment.id != item.id))
    if clash:
        raise HTTPException(status_code=409, detail=f"{values['tag']} is already in the register")
    changed = {key: [getattr(item, key), value] for key, value in values.items() if getattr(item, key) != value}
    for key, value in values.items():
        setattr(item, key, value)
    if changed:
        audit_user_change(db, user.id, "EQUIPMENT_CHANGED", None, {"tag": item.tag, "changed": changed}, target=f"equipment:{item.id}")
    db.commit()
    return _payload(item)


class EquipmentImport(BaseModel):
    csv: str = Field(max_length=500_000)
    dry_run: bool = False


IMPORT_COLUMNS = ("tag", "name", "section", "station", "region", "location", "category", "criticality", "aliases")


@router.post("/api/v1/admin/equipment/import")
def equipment_import(req: EquipmentImport, user: User = Depends(admin_user), db: Session = Depends(db_dep)):
    """CSV with a header row: tag,name,section,station[,region,location,category,criticality,aliases].
    New tags are added; existing tags are updated. Nothing is saved if any row is wrong (or on a dry run)."""
    reader = csv.DictReader(io.StringIO(req.csv.strip()))
    headers = [name.strip().lower() for name in (reader.fieldnames or [])]
    missing = [name for name in ("tag", "name", "section", "station") if name not in headers]
    if missing:
        raise HTTPException(status_code=422, detail="The first row must name the columns. Missing: " + ", ".join(missing))
    errors, plan = [], []
    seen: set[str] = set()
    for number, raw in enumerate(reader, start=2):
        row = {key.strip().lower(): (value or "").strip() for key, value in raw.items() if key}
        try:
            values = _clean(EquipmentIn(**{key: row[key] for key in IMPORT_COLUMNS if row.get(key)} | {
                "criticality": row.get("criticality") or "Medium"}))
        except HTTPException as exc:
            errors.append({"row": number, "tag": row.get("tag", ""), "problem": exc.detail})
            continue
        except ValueError as exc:
            errors.append({"row": number, "tag": row.get("tag", ""), "problem": str(exc).splitlines()[0][:200]})
            continue
        if values["tag"] in seen:
            errors.append({"row": number, "tag": values["tag"], "problem": "This tag is in the file twice"})
            continue
        seen.add(values["tag"])
        existing = db.scalar(select(Equipment).where(func.upper(Equipment.tag) == values["tag"]))
        plan.append((existing, values))
    added = sum(1 for existing, _ in plan if existing is None)
    result = {"rows": len(plan) + len(errors), "add": added, "update": len(plan) - added, "errors": errors, "saved": False}
    if errors or req.dry_run or not plan:
        return result
    for existing, values in plan:
        if existing is None:
            db.add(Equipment(id=f"EQ-ADM-{uuid.uuid4().hex[:8]}", **values))
        else:
            for key, value in values.items():
                setattr(existing, key, value)
    audit_user_change(db, user.id, "EQUIPMENT_IMPORTED", None, {"added": added, "updated": len(plan) - added},
                      target="equipment:import")
    db.commit()
    return {**result, "saved": True}


# --- audit trail -----------------------------------------------------------------------------------

AUDIT_KINDS = {
    "access": ("USER_", "ENROLMENT_", "ACCOUNT_APPROVED", "ACCOUNT_REJECTED", "ROLE_", "PASSWORD_", "TECHNICIAN_"),
    "signin": ("SIGNED_IN", "ACCOUNT_LOCKED"),
    "settings": ("SETTING_",),
    "equipment": ("EQUIPMENT_",),
    "developer": ("VIEW_AS_", "DEMO_RESET"),
}


@router.get("/api/v1/admin/audit")
def audit_trail(kind: str = "", search: str = "", limit: int = 200, user: User = Depends(admin_user),
                db: Session = Depends(db_dep)):
    query = select(UserAudit).order_by(UserAudit.created_at.desc())
    if kind in AUDIT_KINDS:
        query = query.where(or_(*[UserAudit.action.like(f"{prefix}%") for prefix in AUDIT_KINDS[kind]]))
    if search.strip():
        needle = f"%{search.strip()}%"
        query = query.where(or_(UserAudit.action.ilike(needle), UserAudit.details.ilike(needle), UserAudit.target_user_id.ilike(needle)))
    rows = db.scalars(query.limit(max(1, min(limit, 500)))).all()
    ids = {row.actor_id for row in rows} | {row.target_user_id for row in rows}
    names = {person.id: person.display_name for person in db.scalars(select(User).where(User.id.in_(ids)))}
    return [{
        "id": row.id, "at": row.created_at.isoformat() if row.created_at else None, "action": row.action,
        "actor": names.get(row.actor_id, row.actor_id), "target": names.get(row.target_user_id, row.target_user_id),
        "details": json.loads(row.details or "{}"),
    } for row in rows]


# --- developer tools -------------------------------------------------------------------------------

VIEW_AS_HOURS = 1


@router.post("/api/v1/admin/view-as/{user_id}")
def view_as(user_id: str, user: User = Depends(developer_user), db: Session = Depends(db_dep)):
    """A read-only session as someone else, to see exactly their screens. Logged; ends after an hour."""
    from app.routers.auth import issue_token

    target = db.get(User, user_id)
    if not target or not target.active or target.account_status != "ACTIVE":
        raise HTTPException(status_code=404, detail="No active account with that id")
    if target.id == user.id:
        raise HTTPException(status_code=422, detail="That is you")
    audit_user_change(db, user.id, "VIEW_AS_STARTED", target, {"read_only": True, "hours": VIEW_AS_HOURS})
    db.commit()
    token = issue_token(target, extra={"view_as": user.id}, hours=VIEW_AS_HOURS)
    return {"access_token": token, "token_type": "Bearer", "user": {**user_payload(target), "viewing_as": True},
            "viewer": user.display_name, "read_only": True}


@router.get("/api/v1/admin/people")
def people_for_view_as(user: User = Depends(developer_user), db: Session = Depends(db_dep)):
    people = db.scalars(select(User).where(User.active == 1, User.account_status == "ACTIVE", User.id != user.id)
                        .order_by(User.role, User.section, User.display_name)).all()
    return [{"id": person.id, "name": person.display_name, "role_label": role_definition(person)["label"],
             "section": person.section, "region": person.region} for person in people]


demo_reset_state = {"running": False, "started_at": None, "finished_at": None, "ok": None, "by": ""}


def _reset_demo(actor_id: str) -> None:
    time.sleep(1)  # let the request that started it finish
    try:
        engine.dispose()  # close pooled connections so the tables can be dropped
        done = subprocess.run([sys.executable, "-m", "app.cli", "reset"], cwd=BACKEND_ROOT, capture_output=True,
                              text=True, timeout=600)
        ok = done.returncode == 0
        if not ok:
            logger.error("Demo reset failed: %s", (done.stderr or done.stdout)[-300:])
    except Exception:
        logger.exception("Demo reset failed")
        ok = False
    demo_reset_state.update(running=False, finished_at=utcnow().isoformat(), ok=ok)
    if ok:
        from app.db import SessionLocal
        with SessionLocal() as db:
            if db.get(User, actor_id):
                audit_user_change(db, actor_id, "DEMO_RESET", None, {"note": "Demonstration data reloaded"}, target="demo")
                db.commit()


class ResetRequest(BaseModel):
    confirm: str


@router.post("/api/v1/admin/demo/reset", status_code=202)
def demo_reset(req: ResetRequest, user: User = Depends(developer_user)):
    """Drop everything and reload the illustrative demonstration data. Signs everyone out."""
    if req.confirm.strip().upper() != "RESET":
        raise HTTPException(status_code=422, detail='Type RESET to confirm')
    if demo_reset_state["running"]:
        raise HTTPException(status_code=409, detail="A reset is already running")
    demo_reset_state.update(running=True, started_at=utcnow().isoformat(), finished_at=None, ok=None, by=user.display_name)
    threading.Thread(target=_reset_demo, args=(user.id,), daemon=True).start()
    return {"started": True}
