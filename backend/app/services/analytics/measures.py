"""The measures defined in METRICS.md, computed from FaultFacts.

Each returns (value, n): `n` is the number of faults behind the value, shown
with every figure so small samples are visible.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from statistics import median
from typing import Callable, Literal

from app.services.analytics.facts import FaultFacts, in_period
from app.services.analytics.periods import Granularity, Period, buckets

MIN_N_TO_COMPARE = 5
Result = tuple[float | None, int]


@dataclass(frozen=True)
class Window:
    """Everything a measure may look at: all faults, and the bucket's bounds."""
    facts: list[FaultFacts]
    start: datetime
    end: datetime

    @property
    def reported(self) -> list[FaultFacts]:
        return in_period(self.facts, self.start, self.end)


def _median(values: list[float]) -> Result:
    return (round(median(values), 1), len(values)) if values else (None, 0)


def _percent(flags: list[bool]) -> Result:
    return (round(100 * sum(flags) / len(flags), 1), len(flags)) if flags else (None, 0)


def _minutes(later: datetime, earlier: datetime) -> float:
    return (later - earlier).total_seconds() / 60


def faults_reported(w: Window) -> Result:
    count = len(w.reported)
    return float(count), count


def first_response_min(w: Window) -> Result:
    return _median([_minutes(f.first_response_at, f.reported_at) for f in w.reported if f.first_response_at])


def on_site_min(w: Window) -> Result:
    return _median([_minutes(f.on_site_at, f.reported_at) for f in w.reported if f.on_site_at])


def restore_h(w: Window) -> Result:
    return _median([_minutes(f.restored_at, f.reported_at) / 60 for f in w.reported if f.restored_at])


def first_time_fix_pct(w: Window) -> Result:
    return _percent([bool(f.worked_on_first_attempt) for f in w.reported if f.is_restored and f.attempts])


def repeat_pct(w: Window) -> Result:
    return _percent([f.is_repeat for f in w.reported if f.equipment_id])


def came_back_pct(w: Window) -> Result:
    # Counted by restoration date; only restorations old enough to have a full 30-day window.
    return _percent([
        bool(f.came_back) for f in w.facts
        if f.restored_at and w.start <= f.restored_at < w.end and f.came_back is not None
    ])


def failed_attempts_per_fault(w: Window) -> Result:
    counts = [f.failed_attempts for f in w.reported if f.attempts]
    return (round(sum(counts) / len(counts), 2), len(counts)) if counts else (None, 0)


def open_at_end(w: Window) -> Result:
    count = sum(f.open_at(w.end) for f in w.facts)
    return float(count), count


@dataclass(frozen=True)
class Measure:
    key: str
    label: str
    unit: str
    better: Literal["lower", "higher"] | None
    definition: str
    compute: Callable[[Window], Result]

    def describe(self) -> dict:
        return {"key": self.key, "label": self.label, "unit": self.unit, "better": self.better, "definition": self.definition}


MEASURES: dict[str, Measure] = {m.key: m for m in [
    Measure("faults_reported", "Faults reported", "faults", None,
            "Reports submitted in the period. Volume is workload, not performance.", faults_reported),
    Measure("first_response_min", "Time to first response", "min", "lower",
            "Median minutes from report to the first acknowledgement of the job.", first_response_min),
    Measure("on_site_min", "Time to get on site", "min", "lower",
            "Median minutes from report to arrival on site.", on_site_min),
    Measure("restore_h", "Time to restore", "h", "lower",
            "Median hours from report to the equipment working again. Not measured downtime: operation may have continued.", restore_h),
    Measure("first_time_fix_pct", "First-time fix", "%", "higher",
            "Restored faults whose first recorded attempt worked.", first_time_fix_pct),
    Measure("repeat_pct", "Repeat faults", "%", "lower",
            "Reports on identified equipment that had another report on it in the previous 90 days.", repeat_pct),
    Measure("came_back_pct", "Came back after fix", "%", "lower",
            "Restored faults followed by a new report on the same equipment within 30 days (only restorations at least 30 days old).", came_back_pct),
    Measure("failed_attempts", "Failed attempts per fault", "attempts", "lower",
            "Mean failed attempts among faults with recorded attempts. Also a sign of honest recording.", failed_attempts_per_fault),
    Measure("open_at_end", "Open at period end", "faults", "lower",
            "Faults reported before the end and not restored by then.", open_at_end),
]}

HEADLINE = ["faults_reported", "first_response_min", "restore_h", "first_time_fix_pct", "repeat_pct", "came_back_pct", "open_at_end"]


def compare(measure: Measure, current: Result, previous: Result) -> dict:
    """Change against the previous period, stated as better/worse in words."""
    value, n = current
    before, n_before = previous
    result = {"value": value, "n": n, "previous": before, "previous_n": n_before, "change": None, "verdict": "no_data"}
    if value is None or before is None:
        return result
    change = round(value - before, 2)
    result["change"] = change
    if measure.better is None:
        result["verdict"] = "context"
    elif min(n, n_before) < MIN_N_TO_COMPARE:
        result["verdict"] = "too_few"
    elif change == 0:
        result["verdict"] = "same"
    else:
        improved = change < 0 if measure.better == "lower" else change > 0
        result["verdict"] = "better" if improved else "worse"
    return result


def summary(facts: list[FaultFacts], period: Period, keys: list[str] = HEADLINE) -> dict:
    previous = period.previous()
    now_window = Window(facts, period.start, period.end)
    before_window = Window(facts, previous.start, previous.end)
    return {
        "period": period.as_dict(),
        "previous_period": previous.as_dict(),
        "measures": [
            {**MEASURES[key].describe(), **compare(MEASURES[key], MEASURES[key].compute(now_window), MEASURES[key].compute(before_window))}
            for key in keys
        ],
        "min_n_to_compare": MIN_N_TO_COMPARE,
    }


def trends(facts: list[FaultFacts], period: Period, granularity: Granularity, keys: list[str]) -> dict:
    cuts = buckets(period, granularity)
    series = {}
    for key in keys:
        measure = MEASURES[key]
        points = []
        for cut in cuts:
            value, n = measure.compute(Window(facts, cut.start, cut.end))
            points.append({"value": value, "n": n})
        series[key] = points
    return {
        "period": period.as_dict(),
        "granularity": granularity,
        "buckets": [{"label": cut.label, "from": cut.first_day.isoformat(), "days": cut.days,
                     "full_days": cut.full_days, "partial": cut.partial} for cut in cuts],
        "measures": [MEASURES[key].describe() for key in keys],
        "series": series,
    }
