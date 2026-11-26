"""Similar past faults: score = wE·E + wS·S + wC·C + wR·R (METRICS.md).

Deterministic and explainable: each result lists why it ranked. A similar fault
is a lead to check, never proof of the same cause.
"""
from __future__ import annotations

import math
import re
from datetime import datetime

from app.core.config import settings
from app.services.analytics.facts import FaultFacts
from app.services.vocabulary import overlap

MIN_SCORE = 0.30
RECENCY_HALF_LIFE_DAYS = 120
# Equipment credit: same item 1.0; related (works in the same system) 0.6; same type 0.5.
RELATED_EQUIPMENT = 0.6
SAME_TYPE = 0.5
# Tags with different letters for the same type (11-P-501 and PUMP-101 are both pumps). Mirrors catalogue.TYPE_ALIASES.
TYPE_ALIASES = {"P": "PUMP"}


def kind(code: str) -> str:
    return TYPE_ALIASES.get(code, code)


def score(target: FaultFacts, candidate: FaultFacts, now: datetime, weights=None) -> tuple[float, list[str]]:
    w_equipment, w_symptom, w_category, w_relevance = weights or settings.similarity_weights
    reasons: list[str] = []

    equipment = 0.0
    if target.equipment_id and candidate.equipment_id == target.equipment_id:
        equipment = 1.0
        reasons.append("Same equipment")
    else:
        if target.system_id and candidate.system_id == target.system_id:
            equipment = RELATED_EQUIPMENT
            reasons.append(f"Related equipment ({candidate.equipment_tag}, same {candidate.system_name or 'system'})")
        if target.equipment_type and kind(candidate.equipment_type) == kind(target.equipment_type):
            equipment = max(equipment, SAME_TYPE)
            reasons.append(f"Same type of equipment ({kind(candidate.equipment_type)})")

    # Shorthand and word forms count: "drive tripped hot" matches "VFD trip on overtemperature" (services/vocabulary.py).
    symptom = overlap(f"{target.symptom} {target.description}", f"{candidate.symptom} {candidate.description}")
    if symptom >= 0.6:
        reasons.append("Same problem described")
    elif symptom >= 0.3:
        reasons.append("Similar problem description")
    else:
        symptom = 0.0  # a word or two in common is not a similar problem

    category = 1.0 if target.category and candidate.category == target.category else 0.0
    if category:
        reasons.append(f"Same fault category ({candidate.category})")

    fixed = bool(candidate.actions("SUCCESS"))
    age_days = max(0.0, (now - candidate.reported_at).total_seconds() / 86_400)
    recency = math.exp(-math.log(2) * age_days / RECENCY_HALF_LIFE_DAYS)
    relevance = (0.6 if fixed else 0.0) + 0.4 * recency
    if fixed:
        reasons.append("A fix that worked is recorded")

    total = w_equipment * equipment + w_symptom * symptom + w_category * category + w_relevance * relevance
    return round(total, 3), reasons


def similar_faults(target: FaultFacts, candidates: list[FaultFacts], now: datetime, limit: int = 5) -> list[dict]:
    ranked = []
    for candidate in candidates:
        if candidate.id == target.id or candidate.reported_at >= target.reported_at:
            continue
        value, reasons = score(target, candidate, now)
        if value < MIN_SCORE:
            continue
        ranked.append((value, candidate, reasons))
    ranked.sort(key=lambda entry: (-entry[0], -entry[1].reported_at.timestamp()))
    return [{
        "fault_id": candidate.id,
        "reference": candidate.reference,
        "equipment_tag": candidate.equipment_tag,
        "equipment_name": candidate.equipment_name,
        "reported_at": candidate.reported_at.isoformat(),
        "symptom": candidate.symptom,
        "causes": candidate.causes[:3],
        "worked": candidate.actions("SUCCESS")[:3],
        "did_not_work": candidate.actions("FAILED")[:3],
        "score": value,
        "reasons": reasons,
    } for value, candidate, reasons in ranked[:limit]]
