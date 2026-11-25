"""Equipment needing attention, section comparison and data-quality checks (METRICS.md)."""
from __future__ import annotations

from collections import defaultdict
from datetime import datetime, timedelta
from statistics import median

from app.services.analytics.facts import UNIDENTIFIED, FaultFacts, in_period
from app.services.analytics.measures import Window, first_response_min, first_time_fix_pct, repeat_pct, restore_h
from app.services.analytics.periods import Period

STALE_AFTER = timedelta(days=7)
LATE_WRITE_UP_HOURS = 24


def _hours(later: datetime, earlier: datetime) -> float:
    return (later - earlier).total_seconds() / 3600


def equipment_attention(facts: list[FaultFacts], period: Period, limit: int = 10) -> list[dict]:
    """Equipment ranked by faults + repeats + 2 × came back after fix; each with its reasons."""
    groups: dict[str, list[FaultFacts]] = defaultdict(list)
    for item in in_period(facts, period.start, period.end):
        if item.equipment_id:
            groups[item.equipment_id].append(item)
    rows = []
    for items in groups.values():
        first = items[0]
        repeats = sum(item.is_repeat for item in items)
        came_back = sum(bool(item.came_back) for item in items)
        failed = sum(item.failed_attempts for item in items)
        restore_hours = round(sum(_hours(item.restored_at, item.reported_at) for item in items if item.restored_at), 1)
        open_now = sum(not item.is_restored for item in items)
        causes = [cause for item in items for cause in item.causes]
        reasons = [f"{len(items)} fault(s) reported"]
        if repeats:
            reasons.append(f"{repeats} repeat(s) within 90 days")
        if came_back:
            reasons.append(f"came back after a fix {came_back} time(s)")
        if failed:
            reasons.append(f"{failed} failed attempt(s)")
        if restore_hours:
            reasons.append(f"{restore_hours} h in total to restore")
        if open_now:
            reasons.append(f"{open_now} still open")
        rows.append({
            "equipment_id": first.equipment_id,
            "equipment_tag": first.equipment_tag,
            "equipment_name": first.equipment_name,
            "section": first.section,
            "station": first.station,
            "faults": len(items),
            "repeats": repeats,
            "came_back": came_back,
            "failed_attempts": failed,
            "restore_hours_total": restore_hours,
            "open_now": open_now,
            "common_cause": max(set(causes), key=causes.count) if causes else None,
            "score": len(items) + repeats + 2 * came_back,
            "reasons": reasons,
        })
    rows.sort(key=lambda row: (-row["score"], -row["restore_hours_total"], row["equipment_tag"]))
    return rows[:limit]


def section_comparison(facts: list[FaultFacts], period: Period, now: datetime) -> list[dict]:
    by_section: dict[str, list[FaultFacts]] = defaultdict(list)
    for item in facts:
        by_section[item.section].append(item)
    rows = []
    for section, items in sorted(by_section.items(), key=lambda entry: (entry[0] == UNIDENTIFIED, entry[0])):
        window = Window(items, period.start, period.end)
        reported = window.reported
        if not reported and not any(not item.is_restored for item in items):
            continue
        row = {"section": section, "faults": len(reported), "open_now": sum(item.open_at(now) for item in items)}
        for key, measure in (("first_response_min", first_response_min), ("restore_h", restore_h),
                             ("first_time_fix_pct", first_time_fix_pct), ("repeat_pct", repeat_pct)):
            value, n = measure(window)
            row[key] = {"value": value, "n": n}
        rows.append(row)
    return rows


def data_quality(facts: list[FaultFacts], period: Period, now: datetime) -> list[dict]:
    reported = in_period(facts, period.start, period.end)
    restored = [item for item in reported if item.is_restored]
    lags = [lag for item in reported for lag in item.write_up_lag_hours]
    open_items = [item for item in facts if not item.is_restored and item.reported_at < period.end]

    def check(key: str, label: str, count: int, total: int, why: str) -> dict:
        return {
            "key": key, "label": label, "count": count, "total": total,
            "percent": round(100 * count / total, 1) if total else None, "why": why,
        }

    return [
        check("unidentified", "Equipment still unidentified", sum(not item.equipment_id for item in reported), len(reported),
              "Excluded from repeat and equipment measures."),
        check("no_back_in_service", "Restored without a back-in-service time",
              sum(not item.has_back_in_service_time for item in restored), len(restored),
              "Restoration falls back to the sign-off time, which overstates time to restore."),
        check("late_write_up", f"Written up more than {LATE_WRITE_UP_HOURS} h after the visit",
              sum(lag > LATE_WRITE_UP_HOURS for lag in lags), len(lags), "Late write-ups lose detail."),
        check("no_cause", "Restored without any recorded cause", sum(not item.causes for item in restored), len(restored),
              "Nothing to learn from for next time."),
        check("stale", "Open with no activity for 7 days",
              sum((now - (item.last_activity_at or item.reported_at)) > STALE_AFTER for item in open_items), len(open_items),
              "Possibly forgotten."),
    ] + ([{
        "key": "write_up_lag", "label": "Typical delay from visit to write-up", "count": None, "total": len(lags),
        "percent": None, "median_hours": round(median(lags), 1), "why": "Shorter is fresher.",
    }] if lags else [])
