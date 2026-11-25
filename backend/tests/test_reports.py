"""Weekly, monthly and financial-year (July-June) reports: periods, content by level, email and schedule."""
from datetime import date, datetime, timezone

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from app.db import SessionLocal
from app.main import app
from app.services import reports

client = TestClient(app)
WEDNESDAY = datetime(2026, 11, 25, 9, 0, tzinfo=timezone.utc)  # 12:00 Kenya time


def headers(username: str) -> dict:
    response = client.post("/api/v1/auth/login", json={"email": f"demo.{username}@kpc.co.ke", "password": "demo123"})
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


def days(period) -> tuple[date, date]:
    return period.first_day, period.last_day


# --- periods ----------------------------------------------------------------------------------

def test_weeks_run_monday_to_sunday_and_default_to_the_last_full_week():
    last = reports.resolve("week", None, WEDNESDAY)
    assert (last.key, days(last.period), days(last.previous), last.partial) == (
        "2026-11-16", (date(2026, 11, 16), date(2026, 11, 22)), (date(2026, 11, 9), date(2026, 11, 15)), False)
    current = reports.resolve("week", "2026-11-23", WEDNESDAY)
    assert current.partial and days(current.period) == (date(2026, 11, 23), date(2026, 11, 25))
    assert current.label == "Week of 23 Nov 2026 (so far)"
    with pytest.raises(HTTPException):
        reports.resolve("week", "2026-11-17", WEDNESDAY)  # not a Monday


def test_months_are_calendar_months_compared_with_the_month_before():
    last = reports.resolve("month", None, WEDNESDAY)
    assert (last.key, last.label, days(last.period), days(last.previous)) == (
        "2026-10", "October 2026", (date(2026, 10, 1), date(2026, 10, 31)), (date(2026, 9, 1), date(2026, 9, 30)))
    so_far = reports.resolve("month", "2026-11", WEDNESDAY)
    assert so_far.partial and days(so_far.previous) == (date(2026, 10, 1), date(2026, 10, 25))
    assert days(reports.resolve("month", "2026-01", WEDNESDAY).previous) == (date(2025, 12, 1), date(2025, 12, 31))


def test_the_financial_year_runs_july_to_june():
    assert reports.fy_start_year(date(2026, 6, 30)) == 2025
    assert reports.fy_start_year(date(2026, 7, 1)) == 2026
    last = reports.resolve("year", None, WEDNESDAY)
    assert (last.key, last.label, days(last.period), days(last.previous)) == (
        "2025/26", "Financial year 2025/26", (date(2025, 7, 1), date(2026, 6, 30)), (date(2024, 7, 1), date(2025, 6, 30)))
    to_date = reports.resolve("year", "2026/27", WEDNESDAY)
    assert to_date.label == "Financial year 2026/27 to date"
    assert days(to_date.period) == (date(2026, 7, 1), date(2026, 11, 25))
    assert days(to_date.previous) == (date(2025, 7, 1), date(2025, 11, 25))  # same dates a year before
    leap = reports.resolve("year", "2023/24", WEDNESDAY)
    assert days(leap.previous) == (date(2022, 7, 1), date(2023, 6, 30))
    for bad in ("2025/27", "2027/28", "FY25"):
        with pytest.raises(HTTPException):
            reports.resolve("year", bad, WEDNESDAY)


def test_reports_are_issued_after_the_period_ends():
    assert reports.issued_period("week", WEDNESDAY) == "2026-11-16"
    assert reports.issued_period("month", WEDNESDAY) == "2026-10"
    assert reports.issued_period("year", WEDNESDAY) == "2025/26"
    monday_early = datetime(2026, 11, 23, 3, 30, tzinfo=timezone.utc)   # 06:30 Kenya: not yet
    monday_after = datetime(2026, 11, 23, 4, 0, tzinfo=timezone.utc)    # 07:00 Kenya
    assert reports.issued_period("week", monday_early) == "2026-11-09"
    assert reports.issued_period("week", monday_after) == "2026-11-16"
    assert reports.issued_period("year", datetime(2026, 7, 1, 3, 59, tzinfo=timezone.utc)) == "2024/25"
    assert reports.issued_period("year", datetime(2026, 7, 1, 4, 0, tzinfo=timezone.utc)) == "2025/26"


# --- content by level -------------------------------------------------------------------------

def test_the_manager_gets_the_full_report_for_all_sections_or_one():
    manager = headers("maintenance-manager")
    report = client.get("/api/v1/reports/month", headers=manager).json()
    assert report["title"].startswith("Monthly report: ") and not report["partial"]  # last complete month
    assert report["version"] == "full" and report["scope"] == "All sections"
    assert {item["key"] for item in report["headline"]} >= {"restore_h", "first_time_fix_pct", "repeat_pct", "open_at_end"}
    assert all("n" in item and "verdict" in item for item in report["headline"])
    assert len(report["sections"]) >= 4
    assert {"attention", "open_faults", "procedures_published", "data_quality"} <= set(report)
    assert len(report["trend"]["buckets"]) in (12, 13)
    assert "/reports?kind=month" in report["link"]
    assert client.get("/api/v1/reports/month?section=Mechanical", headers=manager).json()["scope"] == "Mechanical section"
    year = client.get("/api/v1/reports/year", headers=manager).json()
    assert year["trend"]["buckets"][0]["label"].startswith("Jul")


def test_section_leads_get_their_section_and_the_ceo_the_headline_version():
    chief = client.get("/api/v1/reports/week?section=Mechanical", headers=headers("ct-electrical")).json()
    assert chief["scope"] == "Electrical section" and chief["sections"] == []
    ceo = client.get("/api/v1/reports/year", headers=headers("ceo")).json()
    assert ceo["version"] == "headline" and "attention" not in ceo and "open_faults" not in ceo
    for username in ("st-electrical", "operations", "hr"):
        assert client.get("/api/v1/reports/week", headers=headers(username)).status_code == 403
    assert client.get("/api/v1/reports/fortnight", headers=headers("maintenance-manager")).status_code == 404


def test_email_me_puts_the_report_summary_and_link_in_my_mailbox():
    response = client.post("/api/v1/reports/week/email", headers=headers("chief-engineer-electrical"))
    assert response.status_code == 200
    mail = client.get("/api/v1/demo/mailbox", params={"email": "demo.chief-engineer-electrical@kpc.co.ke"}).json()[0]
    assert mail["subject"].startswith("Weekly report: Week of") and "Electrical section" in mail["subject"]
    assert "Time to restore:" in mail["body"] and "/reports?kind=week" in mail["body"]


# --- schedule ---------------------------------------------------------------------------------

def test_scheduled_reports_go_once_to_default_readers_and_respect_choices():
    manager = headers("maintenance-manager")
    subscriptions = {item["kind"]: item for item in client.get("/api/v1/account/report-subscriptions", headers=manager).json()["subscriptions"]}
    assert all(subscriptions[kind]["enabled"] for kind in ("week", "month", "year"))
    ceo = {item["kind"]: item["enabled"] for item in client.get("/api/v1/account/report-subscriptions", headers=headers("ceo")).json()["subscriptions"]}
    assert ceo == {"week": False, "month": False, "year": True}

    # The manager stops the weekly email.
    assert client.put("/api/v1/account/report-subscriptions", headers=manager, json={"kind": "week", "enabled": False}).status_code == 200

    with SessionLocal() as db:
        sent = reports.send_due(db, WEDNESDAY)
        again = reports.send_due(db, WEDNESDAY)
    assert sent > 0 and again == 0  # never twice

    def subjects(username):
        return [item["subject"] for item in client.get("/api/v1/demo/mailbox", params={"email": f"demo.{username}@kpc.co.ke"}).json()]

    assert any(s.startswith("Weekly report: Week of 16 Nov 2026 — Electrical section") for s in subjects("ct-electrical"))
    assert any(s.startswith("Monthly report: October 2026 — All sections") for s in subjects("maintenance-manager"))
    assert not any(s.startswith("Weekly report: Week of 16 Nov 2026") for s in subjects("maintenance-manager"))
    assert any(s.startswith("Financial year report: Financial year 2025/26") for s in subjects("ceo"))
    assert not any(s.startswith("Monthly report") for s in subjects("ceo"))
    assert not any("report:" in s for s in subjects("st-electrical"))

    assert client.post("/api/v1/reports/send-due", headers=headers("ct-electrical")).status_code == 403
    assert client.put("/api/v1/account/report-subscriptions", headers=headers("st-electrical"), json={"kind": "week", "enabled": True}).status_code == 403
