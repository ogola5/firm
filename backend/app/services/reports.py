"""Weekly, monthly and financial-year reports: built, printed and emailed.

Every figure comes from the analytics layer (METRICS.md), so a report always
agrees with the Analytics page. Periods are in Kenya time; weeks start Monday;
the financial year runs July to June (FY 2025/26 = 1 Jul 2025 - 30 Jun 2026).
"""
from __future__ import annotations

import re
import uuid
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta
from typing import Literal
from urllib.parse import urlencode

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models import ProcedureUpdate, ReportDelivery, ReportSubscription, User, utc_datetime, utcnow
from app.services import accounts
from app.services.access import role_key
from app.services.analytics import insights, measures
from app.services.analytics.facts import load_facts
from app.services.analytics.periods import Period, local_zone, period_from_days
from app.services.workspace import ANALYTICS_HEADLINE_ONLY, ANALYTICS_ORG_WIDE, ANALYTICS_SECTION_LEADS

Kind = Literal["week", "month", "year"]
KINDS: dict[str, str] = {"week": "Weekly report", "month": "Monthly report", "year": "Financial year report"}

# Who receives each report by email unless they change it in My account.
DEFAULT_READERS: dict[str, set[str]] = {
    "week": {"technician_ct", "chief_engineer", "maintenance_manager", "supervisor"},
    "month": {"technician_ct", "chief_engineer", "maintenance_manager", "general_manager_om", "supervisor"},
    "year": {"technician_ct", "chief_engineer", "maintenance_manager", "general_manager_om", "supervisor", "managing_director"},
}
REPORT_ROLES = set(ANALYTICS_ORG_WIDE) | set(ANALYTICS_SECTION_LEADS) | set(ANALYTICS_HEADLINE_ONLY)
TREND_KEYS = ["faults_reported", "restore_h", "first_time_fix_pct", "repeat_pct"]


# --- periods ------------------------------------------------------------------------------------

@dataclass(frozen=True)
class ReportPeriod:
    kind: str
    key: str
    label: str
    period: Period
    previous: Period
    previous_label: str
    partial: bool  # still running: "to date"


def today_local(now: datetime | None = None) -> date:
    return (now or utcnow()).astimezone(local_zone()).date()


def fy_start_year(day: date) -> int:
    """FY 2025/26 starts in 2025."""
    return day.year if day.month >= settings.financial_year_start_month else day.year - 1


def fy_key(start_year: int) -> str:
    return f"{start_year}/{(start_year + 1) % 100:02d}"


def _month_bounds(year: int, month: int) -> tuple[date, date]:
    first = date(year, month, 1)
    following = date(year + (month == 12), month % 12 + 1, 1)
    return first, following - timedelta(days=1)


def _span(first: date, last: date, today: date) -> tuple[date, bool]:
    """Cut a period that has not ended yet at today."""
    return (min(last, today), last > today)


def _day(value: date) -> str:
    return f"{value.day} {value.strftime('%b %Y')}"


def resolve(kind: str, key: str | None, now: datetime | None = None) -> ReportPeriod:
    """A period from its key (week: Monday's date; month: YYYY-MM; year: 2025/26), or the last complete one."""
    today = today_local(now)
    if kind not in KINDS:
        raise HTTPException(status_code=404, detail="Unknown report")
    try:
        if kind == "week":
            monday = date.fromisoformat(key) if key else today - timedelta(days=today.weekday() + 7)
            if monday.weekday() != 0:
                raise ValueError
            last, partial = _span(monday, monday + timedelta(days=6), today)
            previous = period_from_days(monday - timedelta(days=7), monday - timedelta(days=1))
            label = f"Week of {_day(monday)}" + (" (so far)" if partial else "")
            previous_label = "the week before"
            first = monday
        elif kind == "month":
            if key:
                if not re.fullmatch(r"\d{4}-\d{2}", key):
                    raise ValueError
                year, month = int(key[:4]), int(key[5:])
            else:
                last_month_end = today.replace(day=1) - timedelta(days=1)
                year, month = last_month_end.year, last_month_end.month
            first, month_end = _month_bounds(year, month)
            last, partial = _span(first, month_end, today)
            before_first, before_last = _month_bounds(year - (month == 1), (month - 2) % 12 + 1)
            if partial:  # same days of the month before
                before_last = min(before_last, before_first + (last - first))
            previous = period_from_days(before_first, before_last)
            label = first.strftime("%B %Y") + (" (so far)" if partial else "")
            previous_label = "the month before"
        else:
            if key:
                match = re.fullmatch(r"(\d{4})/(\d{2})", key)
                if not match or (int(match.group(1)) + 1) % 100 != int(match.group(2)):
                    raise ValueError
                start_year = int(match.group(1))
            else:
                start_year = fy_start_year(today) - 1
            first = date(start_year, settings.financial_year_start_month, 1)
            year_end = date(start_year + 1, settings.financial_year_start_month, 1) - timedelta(days=1)
            last, partial = _span(first, year_end, today)
            # Against the whole previous financial year, or (to date) the same dates a year earlier.
            before_first = date(start_year - 1, settings.financial_year_start_month, 1)
            if partial:
                before_last = last.replace(year=last.year - 1, day=min(last.day, 28) if (last.month, last.day) == (2, 29) else last.day)
            else:
                before_last = first - timedelta(days=1)
            previous = period_from_days(before_first, before_last)
            label = f"Financial year {fy_key(start_year)}" + (" to date" if partial else "")
            previous_label = f"the same period of FY {fy_key(start_year - 1)}"
    except ValueError as exc:
        raise HTTPException(status_code=422, detail="Unknown report period") from exc
    if first > today:
        raise HTTPException(status_code=422, detail="That period has not started yet")
    return ReportPeriod(kind, key or period_key(kind, first), label, period_from_days(first, last), previous, previous_label, partial)


def period_key(kind: str, first: date) -> str:
    if kind == "week":
        return first.isoformat()
    if kind == "month":
        return first.strftime("%Y-%m")
    return fy_key(first.year)


def recent(kind: str, now: datetime | None = None, count: int = 8) -> list[dict]:
    """The current period (so far) and the last few complete ones, newest first."""
    today = today_local(now)
    keys: list[str] = []
    if kind == "week":
        monday = today - timedelta(days=today.weekday())
        keys = [(monday - timedelta(weeks=step)).isoformat() for step in range(count + 1)]
    elif kind == "month":
        year, month = today.year, today.month
        for _ in range(count + 1):
            keys.append(f"{year}-{month:02d}")
            year, month = (year - 1, 12) if month == 1 else (year, month - 1)
    else:
        start = fy_start_year(today)
        keys = [fy_key(start - step) for step in range(min(count, 4) + 1)]
    periods = [resolve(kind, key, now) for key in keys]
    return [{"key": item.key, "label": item.label, "partial": item.partial} for item in periods]


# --- content ------------------------------------------------------------------------------------

def _trend_period(report: ReportPeriod) -> tuple[Period, str]:
    """The context chart: 8 weeks to this week, 12 months to this month, or the year's months."""
    period = report.period
    if report.kind == "week":
        return period_from_days(period.first_day - timedelta(weeks=7), period.last_day), "week"
    if report.kind == "month":
        start = date(period.first_day.year - 1, period.first_day.month, 1) + timedelta(days=32)
        return period_from_days(start.replace(day=1), period.last_day), "month"
    return period, "month"


def build(db: Session, kind: str, key: str | None, section: str | None, *, headline_only: bool,
          now: datetime | None = None) -> dict:
    """The report as data: the page prints it, the email summarises it."""
    now = now or utcnow()
    report = resolve(kind, key, now)
    facts = load_facts(db, section, now)
    period = report.period
    trend_period, granularity = _trend_period(report)
    data = {
        "kind": kind,
        "title": f"{KINDS[kind]}: {report.label}",
        "key": report.key,
        "label": report.label,
        "partial": report.partial,
        "period": period.as_dict(),
        "previous_period": {**report.previous.as_dict(), "label": report.previous_label},
        "scope": f"{section} section" if section else "All sections",
        "section": section,
        "version": "headline" if headline_only else "full",
        "generated_at": now.isoformat(),
        "data_type": "Illustrative synthetic demonstration data; not KPC operating performance.",
        "headline": measures.summary(facts, period, previous=report.previous)["measures"],
        "min_n_to_compare": measures.MIN_N_TO_COMPARE,
        "trend": measures.trends(facts, trend_period, granularity, TREND_KEYS),
    }
    if headline_only:
        return data
    end = period.end
    still_open = sorted((item for item in facts if item.open_at(end)), key=lambda item: item.reported_at)
    data.update({
        "sections": insights.section_comparison(facts, period, now) if section is None else [],
        "attention": insights.equipment_attention(facts, period, 10),
        "open_faults": {
            "count": len(still_open),
            "oldest": [
                {"reference": item.reference, "equipment": f"{item.equipment_tag} · {item.equipment_name}".strip(" ·"),
                 "section": item.section, "symptom": item.symptom, "status": item.status,
                 "reported_at": item.reported_at.isoformat(),
                 "days_open": round((end - utc_datetime(item.reported_at)).total_seconds() / 86400, 1)}
                for item in still_open[:10]
            ],
        },
        "procedures_published": _procedures_published(db, period, section),
        "data_quality": insights.data_quality(facts, period, now),
    })
    return data


def _procedures_published(db: Session, period: Period, section: str | None) -> int:
    query = select(ProcedureUpdate).where(ProcedureUpdate.status == "APPROVED")
    if section:
        query = query.where(ProcedureUpdate.section == section)
    return sum(1 for item in db.scalars(query) if period.start <= utc_datetime(item.updated_at) < period.end)


def _figure(item: dict) -> str:
    if item["value"] is None:
        return "no data"
    unit = item["unit"]
    value = item["value"]
    shown = f"{value}%" if unit == "%" else f"{round(value)}" if unit == "faults" else f"{value} {unit}"
    return f"{shown} (from {item['n']} faults)" if unit != "faults" else shown


def _change(item: dict, previous_label: str) -> str:
    verdict = item["verdict"]
    if verdict == "no_data":
        return ""
    if verdict == "too_few":
        return "too few faults to compare"
    if verdict == "same":
        return f"same as {previous_label}"
    direction = "lower" if (item["change"] or 0) < 0 else "higher"
    size = abs(item["change"] or 0)
    amount = f"{size} points" if item["unit"] == "%" else f"{round(size, 2)} {item['unit']}"
    words = f"{amount} {direction} than {previous_label}"
    return words if verdict == "context" else f"{words}: {verdict}"


def link(data: dict) -> str:
    query = {"kind": data["kind"], "period": data["key"], **({"section": data["section"]} if data["section"] else {})}
    return f"{settings.app_url.rstrip('/')}/reports?{urlencode(query)}"


def email_text(data: dict, name: str) -> tuple[str, str]:
    """Subject and plain-text body: the headline in words, the top items, and the link to print it."""
    subject = f"{data['title']} — {data['scope']}"
    lines = [f"Hello {name},", "", f"{data['title']} for {data['scope'].lower() if data['section'] is None else data['scope']}.",
             f"Compared with {data['previous_period']['label']}.", ""]
    for item in data["headline"]:
        change = _change(item, data["previous_period"]["label"])
        lines.append(f"- {item['label']}: {_figure(item)}{' — ' + change if change else ''}")
    if data["version"] == "full":
        if data["attention"]:
            lines += ["", "Equipment needing attention:"]
            lines += [f"- {row['equipment_tag']} ({row['equipment_name']}): {'; '.join(row['reasons'][:3])}" for row in data["attention"][:3]]
        lines += ["", f"Open at the end of the period: {data['open_faults']['count']}.",
                  f"Procedures published: {data['procedures_published']}."]
    lines += ["", f"Open, print or save the full report: {link(data)}", "",
              data["data_type"], "Change which reports you receive under My account."]
    return subject, "\n".join(lines)


# --- who gets what -------------------------------------------------------------------------------

def report_scope(user: User) -> tuple[str | None, bool]:
    """(section or None for all sections, headline_only) for this person's reports."""
    key = role_key(user)
    if key not in REPORT_ROLES:
        raise HTTPException(status_code=403, detail="Reports are not available for this role")
    if key in ANALYTICS_SECTION_LEADS:
        return user.section, False
    return None, key in ANALYTICS_HEADLINE_ONLY


def subscriptions(db: Session, user: User) -> list[dict]:
    key = role_key(user)
    if key not in REPORT_ROLES:
        return []
    chosen = {item.kind: bool(item.enabled) for item in db.scalars(select(ReportSubscription).where(ReportSubscription.user_id == user.id))}
    return [
        {"kind": kind, "label": label, "default": key in DEFAULT_READERS[kind],
         "enabled": chosen.get(kind, key in DEFAULT_READERS[kind])}
        for kind, label in KINDS.items()
    ]


def set_subscription(db: Session, user: User, kind: str, enabled: bool) -> None:
    if kind not in KINDS:
        raise HTTPException(status_code=404, detail="Unknown report")
    report_scope(user)  # 403 for roles without reports
    row = db.get(ReportSubscription, (user.id, kind))
    if row:
        row.enabled, row.updated_at = int(enabled), utcnow()
    else:
        db.add(ReportSubscription(user_id=user.id, kind=kind, enabled=int(enabled), updated_at=utcnow()))


def send_to(db: Session, user: User, kind: str, key: str | None, now: datetime | None = None, cache: dict | None = None) -> dict:
    section, headline_only = report_scope(user)
    cache_key = (kind, key, section, headline_only)
    data = cache.get(cache_key) if cache is not None else None
    if data is None:
        data = build(db, kind, key, section, headline_only=headline_only, now=now)
        if cache is not None:
            cache[cache_key] = data
    subject, body = email_text(data, user.display_name)
    accounts.send_mail(db, user.email, subject, body)
    return data


def issued_period(kind: str, now: datetime) -> str | None:
    """The period whose report is due by now: last week (from Monday 07:00), last month (from the 1st),
    last financial year (from 1 July). None before the first send time has passed."""
    local_now = now.astimezone(local_zone())
    today = local_now.date()
    send_at = time(settings.report_send_hour)
    if kind == "week":
        monday = today - timedelta(days=today.weekday())
        if local_now.time() < send_at and today == monday:
            monday -= timedelta(days=7)
        return (monday - timedelta(days=7)).isoformat()
    if kind == "month":
        first = today.replace(day=1)
        if local_now.time() < send_at and today == first:
            first = (first - timedelta(days=1)).replace(day=1)
        previous_month = (first - timedelta(days=1)).replace(day=1)
        return previous_month.strftime("%Y-%m")
    start = fy_start_year(today)
    fy_first = date(start, settings.financial_year_start_month, 1)
    if local_now.time() < send_at and today == fy_first:
        start -= 1
    return fy_key(start - 1)


def send_due(db: Session, now: datetime | None = None) -> int:
    """Email each due report to everyone who receives it, once. Safe to run as often as you like."""
    now = now or utcnow()
    sent = 0
    cache: dict = {}
    people = db.scalars(select(User).where(User.active == 1, User.account_status == accounts.ACTIVE)).all()
    for kind in KINDS:
        key = issued_period(kind, now)
        delivered = {item.recipient_id for item in db.scalars(select(ReportDelivery).where(
            ReportDelivery.kind == kind, ReportDelivery.period_key == key))}
        for person in people:
            if person.id in delivered or role_key(person) not in REPORT_ROLES:
                continue
            if not next((item["enabled"] for item in subscriptions(db, person) if item["kind"] == kind), False):
                continue
            data = send_to(db, person, kind, key, now, cache)
            db.add(ReportDelivery(id=str(uuid.uuid4()), kind=kind, period_key=key, recipient_id=person.id,
                                  scope=data["scope"], sent_at=now))
            sent += 1
        db.commit()
    return sent
