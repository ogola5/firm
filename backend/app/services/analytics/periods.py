"""Reporting periods and buckets, cut in the reporting time zone (Kenya time)."""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, time, timedelta, timezone
from typing import Literal
from zoneinfo import ZoneInfo

from fastapi import HTTPException

from app.core.config import settings

Granularity = Literal["week", "month"]
MAX_DAYS = 3 * 366


def local_zone() -> ZoneInfo:
    return ZoneInfo(settings.reporting_timezone)


@dataclass(frozen=True)
class Period:
    """[start, end) in UTC, built from local calendar dates."""
    start: datetime
    end: datetime
    first_day: date
    last_day: date

    @property
    def days(self) -> int:
        return (self.last_day - self.first_day).days + 1

    def previous(self) -> "Period":
        """The period of the same length immediately before this one."""
        return period_from_days(self.first_day - timedelta(days=self.days), self.first_day - timedelta(days=1))

    def as_dict(self) -> dict:
        return {"from": self.first_day.isoformat(), "to": self.last_day.isoformat(), "days": self.days}


def _local_midnight(day: date) -> datetime:
    return datetime.combine(day, time.min, tzinfo=local_zone()).astimezone(timezone.utc)


def period_from_days(first_day: date, last_day: date) -> Period:
    if last_day < first_day:
        raise HTTPException(status_code=422, detail="The period ends before it starts")
    if (last_day - first_day).days >= MAX_DAYS:
        raise HTTPException(status_code=422, detail="Choose a period of at most three years")
    return Period(_local_midnight(first_day), _local_midnight(last_day + timedelta(days=1)), first_day, last_day)


def today_local() -> date:
    return datetime.now(local_zone()).date()


def resolve_period(start: date | None, end: date | None, default_days: int = 84) -> Period:
    """Explicit dates, or the last `default_days` days up to today (local)."""
    last_day = end or today_local()
    first_day = start or (last_day - timedelta(days=default_days - 1))
    return period_from_days(first_day, last_day)


@dataclass(frozen=True)
class Bucket:
    start: datetime
    end: datetime
    first_day: date
    label: str
    days: int = 0        # days of the bucket inside the period
    full_days: int = 0   # days in a whole week or month

    @property
    def partial(self) -> bool:
        """Cut short by the period's edges: counts in it are not comparable with whole buckets."""
        return self.days < self.full_days


def buckets(period: Period, granularity: Granularity) -> list[Bucket]:
    """Week (Monday start) or calendar-month buckets covering the period, clipped to it."""
    result: list[Bucket] = []
    if granularity == "week":
        cursor = period.first_day - timedelta(days=period.first_day.weekday())
        step = lambda day: day + timedelta(days=7)  # noqa: E731
        label = lambda day: f"w/c {day.day} {day.strftime('%b')}"  # noqa: E731
    else:
        cursor = period.first_day.replace(day=1)
        step = lambda day: (day.replace(day=28) + timedelta(days=4)).replace(day=1)  # noqa: E731
        label = lambda day: day.strftime("%b %Y")  # noqa: E731
    while cursor <= period.last_day:
        following = step(cursor)
        first = max(cursor, period.first_day)
        last = min(following - timedelta(days=1), period.last_day)
        result.append(Bucket(
            _local_midnight(first), _local_midnight(last + timedelta(days=1)), first, label(cursor),
            days=(last - first).days + 1, full_days=(following - cursor).days,
        ))
        cursor = following
    return result
