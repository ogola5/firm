"""Expert knowledge before it retires: where it is at risk, and how it is captured.

Knowledge at risk is computed from the work records: for each equipment type in
each section, who has actually fixed it (successful interventions), whether a
procedure or expert session exists, and whether the people who fix it most
retire soon (retirement date set by HR).
"""
from __future__ import annotations

from collections import defaultdict
from datetime import date, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Equipment, ExpertSession, Fault, Intervention, ProcedureUpdate, User, utcnow
from app.services.catalogue import type_name, type_of

RETIREMENT_HORIZON_YEARS = 3


def retiring_soon(db: Session, today: date | None = None) -> dict[str, User]:
    today = today or utcnow().date()
    horizon = today + timedelta(days=365 * RETIREMENT_HORIZON_YEARS)
    return {person.id: person for person in db.scalars(select(User).where(
        User.active == 1, User.retirement_date.is_not(None), User.retirement_date <= horizon,
    ))}


def knowledge_at_risk(db: Session, section: str | None = None, today: date | None = None) -> list[dict]:
    """Equipment types whose know-how sits mostly with people retiring within three years."""
    retiring = retiring_soon(db, today)
    fixes: dict[tuple[str, str], dict[str, int]] = defaultdict(lambda: defaultdict(int))
    rows = db.execute(
        select(Intervention.actor_id, Equipment.tag, Equipment.section)
        .join(Fault, Intervention.fault_id == Fault.id).join(Equipment, Fault.equipment_id == Equipment.id)
        .where(Intervention.outcome == "SUCCESS", Fault.equipment_confirmed == 1)
    ).all()
    for actor_id, tag, equipment_section in rows:
        fixes[(equipment_section, type_of(tag))][actor_id] += 1
    procedures: dict[tuple[str, str], int] = defaultdict(int)
    for tag, equipment_section in db.execute(
        select(Equipment.tag, Equipment.section).join(Fault, Fault.equipment_id == Equipment.id)
        .join(ProcedureUpdate, ProcedureUpdate.fault_id == Fault.id).where(ProcedureUpdate.status == "APPROVED")
    ).all():
        procedures[(equipment_section, type_of(tag))] += 1
    sessions: dict[tuple[str, str], int] = defaultdict(int)
    for item in db.scalars(select(ExpertSession).where(ExpertSession.status == "APPROVED")):
        sessions[(item.section, item.equipment_type)] += 1

    results = []
    for (equipment_section, code), by_person in fixes.items():
        if section and equipment_section != section:
            continue
        total = sum(by_person.values())
        leaving = {person_id: count for person_id, count in by_person.items() if person_id in retiring}
        if not leaving or total == 0:
            continue
        share = sum(leaving.values()) / total
        others = [person_id for person_id in by_person if person_id not in retiring]
        written = procedures[(equipment_section, code)] + sessions[(equipment_section, code)]
        if share >= 0.5 and (len(others) <= 1 or written == 0):
            level = "HIGH"
        elif share >= 0.25 or written == 0:
            level = "MEDIUM"
        else:
            level = "LOW"
        experts = sorted(leaving.items(), key=lambda pair: -pair[1])
        names = [f"{retiring[person_id].display_name} (retires {retiring[person_id].retirement_date:%b %Y})" for person_id, _ in experts]
        reasons = [f"{round(share * 100)}% of successful fixes by people retiring soon: {', '.join(names)}",
                   f"{len(others)} other person(s) have fixed one",
                   f"{procedures[(equipment_section, code)]} procedure(s) and {sessions[(equipment_section, code)]} expert session(s) written"]
        results.append({
            "section": equipment_section, "equipment_type": code, "equipment_type_name": type_name(code),
            "level": level, "share_retiring": round(share * 100), "successful_fixes": total,
            "other_fixers": len(others), "procedures": procedures[(equipment_section, code)],
            "expert_sessions": sessions[(equipment_section, code)],
            "experts": [{"user_id": person_id, "name": retiring[person_id].display_name,
                         "retirement_date": retiring[person_id].retirement_date.isoformat(), "fixes": count}
                        for person_id, count in experts],
            "reasons": reasons,
            "suggestion": "Book an expert session and pair them on the next jobs of this type." if level != "LOW"
            else "Covered: keep the procedures up to date.",
        })
    order = {"HIGH": 0, "MEDIUM": 1, "LOW": 2}
    return sorted(results, key=lambda row: (order[row["level"]], -row["share_retiring"], row["equipment_type"]))


def equipment_types(db: Session, section: str | None = None) -> list[dict]:
    """The equipment types present (for pick-lists), with names."""
    query = select(Equipment.tag, Equipment.section).where(~Equipment.tag.like("UNCONFIRMED-%"))
    if section:
        query = query.where(Equipment.section == section)
    seen: dict[tuple[str, str], int] = defaultdict(int)
    for tag, equipment_section in db.execute(query).all():
        seen[(type_of(tag), equipment_section)] += 1
    return [{"code": code, "name": type_name(code), "section": equipment_section, "count": count}
            for (code, equipment_section), count in sorted(seen.items())]
