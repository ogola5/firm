"""Likely to need attention: an explainable watch list, and how often it has been right.

No black box: each asset is listed for reasons a technician can check, e.g.
"fails about every 45 days; last failure 41 days ago" or "temporary fix in place
since 3 Oct". Accuracy is measured honestly by back-testing: the list is rebuilt
as it would have looked on past dates (using only what was known then) and
compared with what actually failed in the 30 days after.
"""
from __future__ import annotations

from collections import defaultdict
from datetime import datetime, timedelta
from statistics import median

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Diagnosis, DrawingDifference, Fault, Intervention, ProcedureUpdate, utc_datetime
from app.services.analytics.facts import FaultFacts
from app.services.catalogue import CAUSE_CATEGORIES, TYPE_ALIASES

HORIZON_DAYS = 30
MIN_SCORE = 2.0


def _type(fact: FaultFacts) -> str:
    return TYPE_ALIASES.get(fact.equipment_type, fact.equipment_type)


def _temporary_fixes(db: Session) -> dict[str, list[tuple[datetime, bool]]]:
    """Per equipment: (when, is_temporary) for each fix attempt that worked or partly worked."""
    rows = db.execute(
        select(Fault.equipment_id, Intervention.created_at, Intervention.action_type, Intervention.outcome, Diagnosis.workaround)
        .join(Fault, Intervention.fault_id == Fault.id)
        .outerjoin(Diagnosis, Intervention.diagnosis_id == Diagnosis.id)
        .where(Intervention.outcome.in_(("SUCCESS", "IN_PROGRESS")))
    ).all()
    result: dict[str, list[tuple[datetime, bool]]] = defaultdict(list)
    for equipment_id, created_at, action_type, outcome, workaround in rows:
        temporary = action_type == "temporary" or outcome == "IN_PROGRESS" or bool(workaround)
        result[equipment_id].append((utc_datetime(created_at), temporary))
    return result


def build(db: Session, facts: list[FaultFacts], as_of: datetime, *, include_live_signals: bool = True) -> list[dict]:
    """The watch list as it would have looked at `as_of`, from facts known by then."""
    known = [item for item in facts if item.equipment_id and item.reported_at < as_of]
    by_equipment: dict[str, list[FaultFacts]] = defaultdict(list)
    for item in known:
        by_equipment[item.equipment_id].append(item)
    recent_by_type: dict[str, list[FaultFacts]] = defaultdict(list)
    for item in known:
        if as_of - item.reported_at <= timedelta(days=30):
            recent_by_type[_type(item)].append(item)
    fixes = _temporary_fixes(db)
    unverified = set()
    if include_live_signals:
        unverified = {row for row in db.scalars(select(DrawingDifference.equipment_id).where(DrawingDifference.status == "REPORTED"))}

    rows = []
    for equipment_id, items in by_equipment.items():
        items.sort(key=lambda fact: fact.reported_at)
        if any(fact.open_at(as_of) for fact in items):
            continue  # already broken and being worked on
        latest = items[-1]
        days_since = (as_of - latest.reported_at).days
        reasons: list[str] = []
        score = 0.0
        gaps = [(later.reported_at - earlier.reported_at).days for earlier, later in zip(items, items[1:])]
        if len(gaps) >= 2:
            typical = max(1, round(median(gaps)))
            ratio = days_since / typical
            if typical <= 180 and 0.75 <= ratio <= 2.0:
                score += 3 * min(ratio, 1.5)
                reasons.append(f"Fails about every {typical} days; last failure {days_since} days ago")
        elif len(gaps) == 1 and gaps[0] <= 120 and days_since >= 0.75 * gaps[0]:
            score += 1.5
            reasons.append(f"Failed twice, {gaps[0]} days apart; last failure {days_since} days ago")
        in_90 = [fact for fact in items if as_of - fact.reported_at <= timedelta(days=90)]
        if len(in_90) >= 2:
            score += len(in_90) - 1
            reasons.append(f"{len(in_90)} faults in the last 90 days")
        came_back = [later for earlier, later in zip(items, items[1:])
                     if earlier.restored_at and earlier.restored_at <= later.reported_at
                     and later.reported_at - earlier.restored_at <= timedelta(days=30)
                     and as_of - later.reported_at <= timedelta(days=180)]
        if came_back:
            score += 1.5
            reasons.append(f"Came back within 30 days of a fix ({came_back[-1].reported_at:%b %Y})")
        attempts = sorted(item for item in fixes.get(equipment_id, []) if item[0] < as_of)
        if attempts and attempts[-1][1]:
            score += 2.5
            reasons.append(f"Temporary fix in place since {attempts[-1][0]:%d %b %Y}")
        elsewhere = [fact for fact in recent_by_type[_type(latest)] if fact.equipment_id != equipment_id]
        if len(elsewhere) >= 2:
            score += 1
            reasons.append(f"Same type of equipment failed {len(elsewhere)} times elsewhere in the last 30 days")
        if equipment_id in unverified:
            score += 0.5
            reasons.append("A difference from the drawing was reported and is not yet verified")
        if score < MIN_SCORE:
            continue
        causes = [cause for fact in items for cause in fact.causes]
        rows.append({
            "equipment_id": equipment_id, "equipment_tag": latest.equipment_tag, "equipment_name": latest.equipment_name,
            "section": latest.section, "score": round(score, 1), "level": "HIGH" if score >= 4 else "WATCH",
            "reasons": reasons, "faults_on_record": len(items), "last_fault": latest.reported_at.isoformat(),
            "days_since_last": days_since, "likely_cause": max(set(causes), key=causes.count) if causes else None,
        })
    return sorted(rows, key=lambda row: (-row["score"], row["equipment_tag"]))


def add_guidance(db: Session, rows: list[dict]) -> list[dict]:
    """What to check: the cause category seen most on this equipment and its latest approved procedure."""
    for row in rows:
        categories = [value for value in db.scalars(
            select(Diagnosis.cause_category).join(Fault, Diagnosis.fault_id == Fault.id)
            .where(Fault.equipment_id == row["equipment_id"], Diagnosis.cause_category != "")
        )]
        row["common_cause_category"] = CAUSE_CATEGORIES.get(max(set(categories), key=categories.count)) if categories else None
        procedure = db.scalar(
            select(ProcedureUpdate).join(Fault, ProcedureUpdate.fault_id == Fault.id)
            .where(Fault.equipment_id == row["equipment_id"], ProcedureUpdate.status == "APPROVED")
            .order_by(ProcedureUpdate.version.desc(), ProcedureUpdate.updated_at.desc())
        )
        row["procedure"] = {"id": procedure.id, "title": procedure.title, "reference": procedure.reference} if procedure else None
    return rows


def backtest(db: Session, facts: list[FaultFacts], now: datetime, checks: int = 10, every_days: int = 14) -> dict:
    """How often a listed asset really failed within 30 days, against all assets (the base rate)."""
    listed = hits = population = failed = 0
    dates = []
    for step in range(checks):
        as_of = now - timedelta(days=HORIZON_DAYS + step * every_days)
        dates.append(as_of)
        window_end = as_of + timedelta(days=HORIZON_DAYS)
        failed_soon = {fact.equipment_id for fact in facts if fact.equipment_id and as_of <= fact.reported_at < window_end}
        candidates = {fact.equipment_id for fact in facts if fact.equipment_id and fact.reported_at < as_of
                      and not any(other.open_at(as_of) for other in facts if other.equipment_id == fact.equipment_id)}
        watch = {row["equipment_id"] for row in build(db, facts, as_of, include_live_signals=False)}
        listed += len(watch)
        hits += len(watch & failed_soon)
        population += len(candidates)
        failed += len(candidates & failed_soon)
    hit_rate = round(100 * hits / listed) if listed else None
    base_rate = round(100 * failed / population) if population else None
    if hit_rate is None:
        verdict = "Not enough history yet to check the list."
    elif base_rate is not None and hit_rate > base_rate:
        verdict = f"Listed assets failed within 30 days {hit_rate}% of the time, against {base_rate}% for all assets: the list helps, but it is a guide, not a certainty."
    else:
        verdict = f"Listed assets failed within 30 days {hit_rate}% of the time, against {base_rate}% for all assets: not yet better than chance; do not rely on it."
    return {"checks": checks, "from": min(dates).date().isoformat(), "to": max(dates).date().isoformat(),
            "listed": listed, "hits": hits, "hit_rate_pct": hit_rate, "base_rate_pct": base_rate,
            "horizon_days": HORIZON_DAYS, "verdict": verdict,
            "method": f"The list rebuilt every {every_days} days over the past months, using only what was known on each date."}
