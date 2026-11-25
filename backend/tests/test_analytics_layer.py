"""Analytics layer: definitions in METRICS.md, checked on hand-built records, plus API access."""
from datetime import date, datetime, timedelta, timezone

from fastapi.testclient import TestClient

from app.main import app
from app.services.analytics import measures
from app.services.analytics.facts import FaultFacts, equipment_type, link_history
from app.services.analytics.insights import data_quality, equipment_attention
from app.services.analytics.measures import Window, compare
from app.services.analytics.periods import buckets, period_from_days
from app.services.analytics.similarity import similar_faults

client = TestClient(app)
NOW = datetime(2026, 11, 25, 12, 0, tzinfo=timezone.utc)


def fact(fid: str, reported: datetime, *, equipment="EQ-1", tag="11-MOV-601", **extra) -> FaultFacts:
    base = dict(
        id=fid, reference=f"REF-{fid}", equipment_id=equipment, equipment_tag=tag, equipment_name="Tank 601 inlet valve",
        equipment_type=equipment_type(tag) if equipment else "", category="Electrical", section="Electrical",
        station="PS02", symptom="Won't open / close", description="", severity="High", status="ASSIGNED", reported_at=reported,
    )
    base.update(extra)
    return FaultFacts(**base)


def at(days_ago: float, hours: float = 0) -> datetime:
    return NOW - timedelta(days=days_ago) + timedelta(hours=hours)


# --- periods -------------------------------------------------------------------------------

def test_week_buckets_start_on_monday_and_months_are_calendar_months():
    period = period_from_days(date(2026, 11, 5), date(2026, 11, 25))  # Thursday to Wednesday
    weeks = buckets(period, "week")
    assert [cut.first_day for cut in weeks] == [date(2026, 11, 5), date(2026, 11, 9), date(2026, 11, 16), date(2026, 11, 23)]
    assert weeks[1].label == "w/c 9 Nov"
    assert [cut.partial for cut in weeks] == [True, False, False, True]  # Thu-Sun and Mon-Wed are cut short
    assert (weeks[0].days, weeks[0].full_days, weeks[-1].days) == (4, 7, 3)
    months = buckets(period_from_days(date(2026, 1, 15), date(2026, 3, 2)), "month")
    assert [cut.label for cut in months] == ["Jan 2026", "Feb 2026", "Mar 2026"]
    assert [(cut.days, cut.full_days) for cut in months] == [(17, 31), (28, 28), (2, 31)]
    previous = period.previous()
    assert previous.days == period.days and previous.last_day == date(2026, 11, 4)


def test_periods_are_cut_at_kenya_midnight():
    period = period_from_days(date(2026, 11, 25), date(2026, 11, 25))
    assert period.start == datetime(2026, 11, 24, 21, 0, tzinfo=timezone.utc)  # 00:00 EAT


# --- measures ------------------------------------------------------------------------------

def test_time_measures_use_the_median_and_count_only_faults_that_reached_that_point():
    facts = [
        fact("a", at(3), first_response_at=at(3, 0.5), restored_at=at(3, 2)),
        fact("b", at(2), first_response_at=at(2, 1), restored_at=at(2, 30)),
        fact("c", at(1), first_response_at=at(1, 2)),
    ]
    window = Window(facts, at(10), NOW)
    assert measures.first_response_min(window) == (60.0, 3)
    assert measures.restore_h(window) == (16.0, 2)  # median of 2 h and 30 h; the open fault is not counted
    assert measures.faults_reported(window) == (3.0, 3)


def test_first_time_fix_looks_at_the_first_attempt_only():
    facts = [
        fact("a", at(5), restored_at=at(5, 3), attempts=[(at(5, 1), "FAILED", "reset"), (at(5, 2), "SUCCESS", "replace")]),
        fact("b", at(4), restored_at=at(4, 3), attempts=[(at(4, 1), "SUCCESS", "tighten")]),
        fact("c", at(3), attempts=[(at(3, 1), "SUCCESS", "tighten")]),  # not restored: excluded
    ]
    assert measures.first_time_fix_pct(Window(facts, at(10), NOW)) == (50.0, 2)
    assert measures.failed_attempts_per_fault(Window(facts, at(10), NOW)) == (0.33, 3)


def test_repeats_and_came_back_after_fix_follow_their_windows():
    facts = [
        fact("old", at(200), restored_at=at(200, 4)),
        fact("first", at(80), restored_at=at(80, 4)),        # >90 days after "old": not a repeat
        fact("again", at(60), restored_at=at(60, 4)),        # 20 days after "first": repeat; "first" came back
        fact("recent", at(10), restored_at=at(10, 4)),       # restored <30 days ago: unknown yet
        fact("other", at(59), equipment="EQ-2", tag="11-LT-601"),
        fact("unidentified", at(58), equipment=None, tag="valve near tank"),
    ]
    link_history(facts, NOW)
    by_id = {item.id: item for item in facts}
    assert not by_id["first"].is_repeat
    assert by_id["again"].is_repeat
    assert by_id["first"].came_back is True
    assert by_id["again"].came_back is False
    assert by_id["recent"].came_back is None
    assert by_id["recent"].is_repeat  # 50 days after "again"
    window = Window(facts, at(100), NOW)
    # Identified reports in the window: first, again, recent, other; repeats: again, recent.
    assert measures.repeat_pct(window) == (50.0, 4)  # unidentified equipment excluded
    assert measures.came_back_pct(window) == (50.0, 2)  # only restorations with a complete window


def test_comparison_says_better_or_worse_by_direction_and_refuses_tiny_samples():
    restore = measures.MEASURES["restore_h"]
    assert compare(restore, (4.0, 10), (6.0, 12))["verdict"] == "better"
    assert compare(restore, (8.0, 10), (6.0, 12))["verdict"] == "worse"
    assert compare(restore, (8.0, 3), (6.0, 12))["verdict"] == "too_few"
    assert compare(measures.MEASURES["first_time_fix_pct"], (80.0, 10), (60.0, 10))["verdict"] == "better"
    assert compare(measures.MEASURES["faults_reported"], (12.0, 12), (8.0, 8))["verdict"] == "context"
    assert compare(restore, (None, 0), (6.0, 12))["verdict"] == "no_data"


# --- intelligence --------------------------------------------------------------------------

def test_similar_faults_rank_same_equipment_first_and_explain_why():
    target = fact("now", at(0), description="valve fails to open from SCADA")
    same = fact("same", at(30), description="valve fails to open", restored_at=at(30, 3),
                attempts=[(at(30, 1), "FAILED", "Reset controller"), (at(30, 2), "SUCCESS", "Replaced terminal X1")])
    same_type = fact("type", at(20), equipment="EQ-9", tag="11-MOV-501", description="valve fails to open")
    unrelated = fact("other", at(10), equipment="EQ-3", tag="PUMP-101", category="Mechanical", symptom="Leaking", description="seal leak")
    later = fact("later", NOW + timedelta(days=1))
    results = similar_faults(target, [target, same, same_type, unrelated, later], NOW)
    assert [item["fault_id"] for item in results] == ["same", "type"]
    assert "Same equipment" in results[0]["reasons"]
    assert "A fix that worked is recorded" in results[0]["reasons"]
    assert results[0]["worked"] == ["Replaced terminal X1"]
    assert results[0]["did_not_work"] == ["Reset controller"]
    assert "Same type of equipment (MOV)" in results[1]["reasons"]


def test_equipment_needing_attention_ranks_with_reasons():
    facts = [
        fact("a1", at(40), restored_at=at(40, 5)),
        fact("a2", at(20), restored_at=at(20, 5), attempts=[(at(20, 1), "FAILED", "reset")], causes=["Loose terminal"]),
        fact("b1", at(15), equipment="EQ-2", tag="PUMP-101"),
    ]
    link_history(facts, NOW)
    period = period_from_days((NOW - timedelta(days=60)).date(), NOW.date())
    ranked = equipment_attention(facts, period)
    assert ranked[0]["equipment_tag"] == "11-MOV-601"
    assert "2 fault(s) reported" in ranked[0]["reasons"]
    assert "1 repeat(s) within 90 days" in ranked[0]["reasons"]
    assert "came back after a fix 1 time(s)" in ranked[0]["reasons"]
    assert ranked[0]["common_cause"] == "Loose terminal"


def test_data_quality_counts_gaps():
    facts = [
        fact("a", at(5), restored_at=at(5, 3), causes=["x"], has_back_in_service_time=True, write_up_lag_hours=[30.0]),
        fact("b", at(4), restored_at=at(4, 3)),
        fact("c", at(20), equipment=None, last_activity_at=at(19)),
    ]
    period = period_from_days((NOW - timedelta(days=30)).date(), NOW.date())
    checks = {item["key"]: item for item in data_quality(facts, period, NOW)}
    assert (checks["no_back_in_service"]["count"], checks["no_back_in_service"]["total"]) == (1, 2)
    assert checks["late_write_up"]["count"] == 1
    assert checks["no_cause"]["count"] == 1
    assert checks["unidentified"]["count"] == 1
    assert checks["stale"]["count"] == 1


# --- API -----------------------------------------------------------------------------------

def headers(username: str) -> dict:
    response = client.post("/api/v1/auth/login", json={"username": username, "password": "demo123"})
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


def test_analytics_access_follows_roles():
    manager = headers("maintenance-manager")
    summary = client.get("/api/v1/analytics/summary", headers=manager)
    assert summary.status_code == 200
    assert summary.json()["scope"] == "All sections"
    assert {item["key"] for item in summary.json()["measures"]} >= {"restore_h", "first_time_fix_pct", "repeat_pct"}
    assert client.get("/api/v1/analytics/summary?section=Mechanical", headers=manager).json()["scope"] == "Mechanical section"

    chief = headers("ct-electrical")
    assert client.get("/api/v1/analytics/summary?section=Mechanical", headers=chief).json()["scope"] == "Electrical section"
    sections = client.get("/api/v1/analytics/sections", headers=chief).json()["sections"]
    assert {row["section"] for row in sections} <= {"Electrical"}

    ceo = headers("ceo")
    assert client.get("/api/v1/analytics/trends", headers=ceo).status_code == 200
    assert client.get("/api/v1/analytics/equipment-attention", headers=ceo).status_code == 403
    for username in ("operations", "hr", "st-electrical"):
        assert client.get("/api/v1/analytics/summary", headers=headers(username)).status_code == 403


def test_trends_and_insight_endpoints_return_counts_with_every_point():
    manager = headers("maintenance-manager")
    trends = client.get("/api/v1/analytics/trends", params={"granularity": "month", "measure": ["faults_reported", "restore_h"]}, headers=manager).json()
    assert len(trends["buckets"]) in (12, 13)
    assert len(trends["series"]["restore_h"]) == len(trends["buckets"])
    assert all({"value", "n"} <= set(point) for point in trends["series"]["restore_h"])
    assert sum(point["n"] for point in trends["series"]["faults_reported"]) >= 100
    assert client.get("/api/v1/analytics/trends?measure=nonsense", headers=manager).status_code == 422
    assert client.get("/api/v1/analytics/trends?start=2026-11-10&end=2026-11-01", headers=manager).status_code == 422

    attention = client.get("/api/v1/analytics/equipment-attention?start=2026-05-01", headers=manager).json()["equipment"]
    assert attention and attention[0]["reasons"]
    quality = client.get("/api/v1/analytics/data-quality?start=2026-05-01", headers=manager).json()["checks"]
    assert {item["key"] for item in quality} >= {"unidentified", "no_back_in_service", "stale"}


def test_similar_faults_endpoint_respects_section_scope():
    technician = headers("st-electrical")
    faults = client.get("/api/v1/faults?search=11-MOV", headers=technician).json()
    target = faults[0]["id"]
    similar = client.get(f"/api/v1/intelligence/similar-faults?fault_id={target}", headers=technician)
    assert similar.status_code == 200
    assert "not the same cause" in similar.json()["note"]
    for item in similar.json()["similar"]:
        assert item["reasons"] and 0 < item["score"] <= 1
    assert client.get(f"/api/v1/intelligence/similar-faults?fault_id={target}", headers=headers("hr")).status_code == 403
