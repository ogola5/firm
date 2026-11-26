"""Per-fault facts: everything the measures need, loaded once per request.

Plain dataclasses keep the measures independent of the database, so they can
be unit-tested with hand-built records.
"""
from __future__ import annotations

import json
import re
from bisect import bisect_left
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import datetime, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Diagnosis, Equipment, Fault, FaultAssignment, FaultEvent, Intervention, System, utc_datetime, utcnow

REPEAT_WINDOW = timedelta(days=90)
CAME_BACK_WINDOW = timedelta(days=30)
UNIDENTIFIED = "Unidentified equipment"


@dataclass
class FaultFacts:
    id: str
    reference: str
    equipment_id: str | None  # None when the equipment is not identified
    equipment_tag: str
    equipment_name: str
    equipment_type: str
    category: str
    section: str
    station: str
    symptom: str
    description: str
    severity: str
    status: str
    reported_at: datetime
    first_response_at: datetime | None = None
    on_site_at: datetime | None = None
    restored_at: datetime | None = None
    attempts: list[tuple[datetime, str, str]] = field(default_factory=list)  # (when, outcome, action), in order
    causes: list[str] = field(default_factory=list)
    has_back_in_service_time: bool = False
    write_up_lag_hours: list[float] = field(default_factory=list)
    last_activity_at: datetime | None = None
    # The system the equipment works in (related equipment), if known.
    system_id: str | None = None
    system_name: str = ""
    # Filled by link_history():
    is_repeat: bool = False
    came_back: bool | None = None  # None: restored too recently to know

    @property
    def is_restored(self) -> bool:
        return self.restored_at is not None

    @property
    def failed_attempts(self) -> int:
        return sum(outcome == "FAILED" for _, outcome, _ in self.attempts)

    def actions(self, outcome: str) -> list[str]:
        return [action for _, result, action in self.attempts if result == outcome]

    @property
    def worked_on_first_attempt(self) -> bool | None:
        return (self.attempts[0][1] == "SUCCESS") if self.attempts else None

    def open_at(self, moment: datetime) -> bool:
        return self.reported_at < moment and (self.restored_at is None or self.restored_at >= moment)


def equipment_type(tag: str) -> str:
    """'11-MOV-601' -> 'MOV', 'PUMP-101' -> 'PUMP', 'LT-301' -> 'LT'."""
    parts = [part for part in re.split(r"[^A-Za-z0-9]+", tag.upper()) if part]
    letters = [part for part in parts if part.isalpha()]
    return letters[0] if letters else ""


def link_history(facts: list[FaultFacts], now: datetime) -> None:
    """Mark repeats (90 days before) and came-back-after-fix (30 days after restoration)."""
    by_equipment: dict[str, list[datetime]] = defaultdict(list)
    for item in facts:
        if item.equipment_id:
            by_equipment[item.equipment_id].append(item.reported_at)
    for times in by_equipment.values():
        times.sort()
    for item in facts:
        if not item.equipment_id:
            continue
        times = by_equipment[item.equipment_id]
        index = bisect_left(times, item.reported_at)
        item.is_repeat = index > 0 and item.reported_at - times[index - 1] <= REPEAT_WINDOW
        if item.restored_at:
            if now - item.restored_at < CAME_BACK_WINDOW:
                item.came_back = None
            else:
                after = bisect_left(times, item.restored_at)
                item.came_back = after < len(times) and times[after] - item.restored_at <= CAME_BACK_WINDOW


def load_facts(db: Session, section: str | None = None, now: datetime | None = None) -> list[FaultFacts]:
    """All faults (optionally for one owning section), with their history linked.

    Loads every fault so repeat and came-back links across period edges are right.
    Prototype scale; at production volume this becomes SQL aggregation (METRICS.md).
    """
    now = now or utcnow()
    rows = db.execute(
        select(Fault, Equipment).join(Equipment, Fault.equipment_id == Equipment.id, isouter=True)
    ).all()
    facts: dict[str, FaultFacts] = {}
    system_names = {item.id: item.name for item in db.scalars(select(System))}
    for fault, equipment in rows:
        identified = bool(fault.equipment_confirmed and equipment and not equipment.tag.startswith("UNCONFIRMED-"))
        facts[fault.id] = FaultFacts(
            id=fault.id,
            reference=fault.reference,
            equipment_id=equipment.id if identified else None,
            equipment_tag=equipment.tag if identified else (fault.reported_equipment_text or "Not identified"),
            equipment_name=equipment.name if identified else UNIDENTIFIED,
            equipment_type=equipment_type(equipment.tag) if identified else "",
            category=fault.category or "",
            section=equipment.section if identified else UNIDENTIFIED,
            station=equipment.station if identified else "",
            symptom=fault.symptom or "",
            description=fault.description or "",
            severity=fault.severity or "",
            status=fault.status,
            reported_at=utc_datetime(fault.created_at),
            restored_at=utc_datetime(fault.restored_at) if fault.restored_at else None,
            system_id=equipment.system_id if identified else None,
            system_name=system_names.get(equipment.system_id, "") if identified and equipment.system_id else "",
        )

    events = db.execute(
        select(FaultEvent.fault_id, FaultEvent.event_type, FaultEvent.created_at, FaultEvent.payload)
        .order_by(FaultEvent.created_at)
    ).all()
    for fault_id, event_type, created_at, payload in events:
        item = facts.get(fault_id)
        if not item:
            continue
        moment = utc_datetime(created_at)
        item.last_activity_at = moment if not item.last_activity_at or moment > item.last_activity_at else item.last_activity_at
        if event_type == "FAULT_ACKNOWLEDGE" and item.first_response_at is None:
            item.first_response_at = moment
        elif event_type == "FAULT_ON_SITE" and item.on_site_at is None:
            item.on_site_at = moment
        elif event_type == "VISIT_RECORDED":
            try:
                data = json.loads(payload or "{}")
                lag = (datetime.fromisoformat(data["recorded_at"]) - datetime.fromisoformat(data["on_site_at"])).total_seconds() / 3600
                item.write_up_lag_hours.append(max(0.0, lag))
            except (KeyError, ValueError, TypeError):
                pass

    for fault_id, created_at, outcome, action in db.execute(
        select(Intervention.fault_id, Intervention.created_at, Intervention.outcome, Intervention.corrective_action)
        .order_by(Intervention.created_at)
    ).all():
        if fault_id in facts:
            facts[fault_id].attempts.append((utc_datetime(created_at), outcome, action or ""))
    for fault_id, cause in db.execute(select(Diagnosis.fault_id, Diagnosis.possible_cause)).all():
        if fault_id in facts:
            facts[fault_id].causes.append(cause)
    for (fault_id,) in db.execute(
        select(FaultAssignment.fault_id).where(FaultAssignment.back_in_service_at.is_not(None))
    ).all():
        if fault_id in facts:
            facts[fault_id].has_back_in_service_time = True

    result = list(facts.values())
    link_history(result, now)
    if section:
        result = [item for item in result if item.section == section]
    return result


def in_period(facts: list[FaultFacts], start: datetime, end: datetime) -> list[FaultFacts]:
    return [item for item in facts if start <= item.reported_at < end]
