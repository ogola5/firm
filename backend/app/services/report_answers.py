"""The reporter's follow-up answers ("position: stuck part-way", "leaking: product") as data.

Stored as JSONB on PostgreSQL (GIN-indexed, so "answers contain X" is fast) and as JSON on
SQLite. Used to answer questions like "valves reported stuck part-way: what usually fixed them?"
"""
from __future__ import annotations

import json
from collections import Counter, defaultdict

from sqlalchemy import String, cast, type_coerce
from sqlalchemy.dialects.postgresql import JSONB

from app.models import Fault

# Choice questions from the report form (frontend reportQuestions.ts). Free-text answers are not counted.
ANSWER_LABELS: dict[str, str] = {
    "from": "Tried from",
    "position": "Position",
    "reset": "Reset",
    "what": "What was leaking",
    "amount": "How much",
    "contained": "Contained",
    "behaviour": "The reading was",
    "missing": "Missing on SCADA",
    "signs": "Noticed",
}
MAX_BYTES = 8000


def clean_details(details: dict | None) -> dict:
    """Keep the stored answers small and plain (strings, lists of strings, booleans)."""
    details = details if isinstance(details, dict) else {}
    answers = details.get("answers") if isinstance(details.get("answers"), dict) else {}
    tidy: dict = {}
    for key, value in list(answers.items())[:30]:
        key = str(key)[:40]
        if isinstance(value, list):
            tidy[key] = [str(item)[:120] for item in value[:10]]
        elif isinstance(value, (str, int, float, bool)):
            tidy[key] = value if isinstance(value, bool) else str(value)[:300]
    result = {"problem": str(details.get("problem", ""))[:80], "answers": tidy, "hazard": bool(details.get("hazard"))}
    if len(json.dumps(result)) > MAX_BYTES:
        result["answers"] = {}
    return result


def report_details_of(fault: Fault) -> dict:
    value = fault.report_details
    if isinstance(value, str):  # rows written before the JSONB column
        try:
            value = json.loads(value or "{}")
        except ValueError:
            value = {}
    return value if isinstance(value, dict) else {}


def answers_of(fault: Fault) -> dict:
    answers = report_details_of(fault).get("answers")
    return answers if isinstance(answers, dict) else {}


def answer_filter(dialect: str, key: str, value: str):
    """SQL condition "the reporter answered key = value" (uses the JSONB GIN index on PostgreSQL)."""
    if dialect == "postgresql":
        # @> containment, served by the GIN index ix_faults_report_details.
        return type_coerce(Fault.report_details, JSONB).contains({"answers": {key: value}})
    # SQLite stores JSON text; good enough for tests and local use.
    return cast(Fault.report_details, String).like(f'%"{key}": "{value}"%')


def answer_insights(faults: list[Fault], fixes: dict[str, str]) -> list[dict]:
    """For each choice answer given on these faults: how often, and what usually fixed it.

    `fixes` maps fault id -> the successful corrective action.
    """
    counts: Counter = Counter()
    fixed_by: dict[tuple[str, str], Counter] = defaultdict(Counter)
    for fault in faults:
        for key, value in answers_of(fault).items():
            if key not in ANSWER_LABELS:
                continue
            for item in (value if isinstance(value, list) else [value]):
                if not isinstance(item, str) or not item:
                    continue
                counts[(key, item)] += 1
                if fault.id in fixes:
                    fixed_by[(key, item)][fixes[fault.id]] += 1
    rows = []
    for (key, value), times in counts.most_common(8):
        best = fixed_by[(key, value)].most_common(1)
        rows.append({
            "key": key, "question": ANSWER_LABELS[key], "answer": value, "times": times,
            "usually_fixed_by": best[0][0] if best else "", "fixed_times": best[0][1] if best else 0,
        })
    return rows
