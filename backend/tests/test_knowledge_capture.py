"""Points and awards, pick-lists, drawing differences, expert knowledge, shadowing and the watch list."""
from datetime import date, datetime, timedelta, timezone

from fastapi.testclient import TestClient
from sqlalchemy import func, select

from app.db import SessionLocal
from app.main import app
from app.models import PointEntry
from app.services import points
from app.services.reports import fy_key, fy_start_year
from test_desk_workflow import allocated_electrical_job, iso

client = TestClient(app)


def headers(username: str) -> dict:
    response = client.post("/api/v1/auth/login", json={"email": f"demo.{username}@kpc.co.ke", "password": "demo123"})
    assert response.status_code == 200, response.text
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


def me(username: str) -> dict:
    return client.get("/api/v1/auth/me", headers=headers(username)).json()


# --- points ------------------------------------------------------------------------------------

def test_points_come_from_verified_work_once_and_keep_their_value():
    with SessionLocal() as db:
        points.sync(db)
        assert points.sync(db) == 0  # each piece of work is credited once
    mine =client.get("/api/v1/points/me", headers=headers("senior-engineer-instrumentation")).json()
    kinds = {entry["kind"] for entry in mine["entries"]}
    assert kinds & {"PROCEDURE_APPROVED", "REUSE_CONFIRMED", "ANSWER_ACCEPTED"}
    assert all(entry["reason"] and entry["points"] >= 0 for entry in mine["entries"])
    assert mine["balance"] == mine["earned"] - mine["redeemed"]
    assert "Speed and number of reports never earn points" in mine["principle"]

    # HR changes a value: points already earned keep theirs.
    before = {entry["id"]: entry["points"] for entry in mine["entries"]}
    hr = headers("hr")
    rules = client.get("/api/v1/points/rules", headers=hr).json()["rules"]
    assert client.put("/api/v1/points/rules", headers=headers("maintenance-manager"), json={"rules": []}).status_code == 403
    changed = client.put("/api/v1/points/rules", headers=hr, json={"rules": [{"kind": "PROCEDURE_APPROVED", "points": 20, "active": True}]})
    assert changed.status_code == 200
    after = {entry["id"]: entry["points"] for entry in client.get("/api/v1/points/me", headers=headers("senior-engineer-instrumentation")).json()["entries"]}
    assert all(after[key] == value for key, value in before.items())
    original = next(rule["points"] for rule in rules if rule["kind"] == "PROCEDURE_APPROVED")
    client.put("/api/v1/points/rules", headers=hr, json={"rules": [{"kind": "PROCEDURE_APPROVED", "points": original, "active": True}]})


def test_two_requests_crediting_the_same_work_at_once_do_not_fail(monkeypatch):
    """The page's two panels (or the scheduler) may credit at the same moment: one wins, the other steps back."""
    with SessionLocal() as db:
        points.sync(db)
        newest = db.scalar(select(PointEntry).order_by(PointEntry.earned_at.desc()))
        copy = {column: getattr(newest, column) for column in ("user_id", "kind", "points", "reason", "source_type", "source_id", "earned_at")}
        db.delete(newest)
        db.commit()
    original = points._candidates

    def competing_request_first(db):
        # Another request records the same work after this one checked, before it saves.
        with SessionLocal() as other:
            other.add(PointEntry(id="race-winner", **copy))
            other.commit()
        return original(db)

    monkeypatch.setattr(points, "_candidates", competing_request_first)
    with SessionLocal() as db:
        assert points.sync(db) == 0  # no error; the work is credited once (by the other request)
        assert db.scalar(select(func.count(PointEntry.id)).where(
            PointEntry.user_id == copy["user_id"], PointEntry.kind == copy["kind"], PointEntry.source_id == copy["source_id"])) == 1


def test_hr_redeems_points_and_records_awards_from_a_shortlist():
    hr = headers("hr")
    table = client.get("/api/v1/points/people?period_type=YEAR", headers=hr).json()
    person = next(row for row in table["rows"] if row["balance"] >= 10)
    assert client.post("/api/v1/points/redemptions", headers=hr, json={"user_id": person["user_id"], "points": person["balance"] + 1, "option": "CASH"}).status_code == 422
    redeemed = client.post("/api/v1/points/redemptions", headers=hr, json={
        "user_id": person["user_id"], "points": 10, "option": "VOUCHER", "value_text": "Shopping voucher (illustrative)",
    })
    assert redeemed.status_code == 201 and redeemed.json()["balance"] == person["balance"] - 10
    assert client.post("/api/v1/points/redemptions", headers=headers("maintenance-manager"), json={"user_id": person["user_id"], "points": 1, "option": "CASH"}).status_code == 403
    assert client.get("/api/v1/points/people", headers=headers("st-electrical")).status_code == 403

    # The demo's points were all earned in the current financial year.
    this_year = fy_key(fy_start_year(date.today()))
    shortlist = client.get(f"/api/v1/awards/shortlist?award_type=YEAR&period={this_year}&scope=Overall", headers=hr).json()
    assert shortlist["award_label"] == "Employee of the Year" and shortlist["period"].count("/") == 1
    winner = shortlist["shortlist"][0]
    assert winner["points"] > 0 and winner["evidence"]
    award = client.post("/api/v1/awards", headers=hr, json={
        "award_type": "YEAR", "period": shortlist["period"], "scope": "Overall", "user_id": winner["user_id"],
        "citation": "Procedures colleagues used to fix repeat faults first time.", "prize": "Trophy (illustrative)",
    })
    assert award.status_code == 201
    assert client.post("/api/v1/awards", headers=hr, json={
        "award_type": "YEAR", "period": shortlist["period"], "scope": "Overall", "user_id": winner["user_id"], "citation": "Again, a second time.",
    }).status_code == 409
    wall = client.get("/api/v1/awards", headers=headers("st-electrical")).json()  # everyone sees the awards
    assert any(item["id"] == award.json()["id"] for item in wall)


def test_financial_year_quarters():
    now = datetime(2026, 11, 25, 9, tzinfo=timezone.utc)
    assert points.award_period("QUARTER", None, now)[0] == "2026/27-Q1"
    key, label, first, last = points.award_period("QUARTER", "2026/27-Q2", now)
    assert (first, last) == (date(2026, 10, 1), date(2026, 12, 31)) and label.startswith("Q2 of FY 2026/27")
    assert points.award_period("QUARTER", "2026/27-Q3", now)[2:] == (date(2027, 1, 1), date(2027, 3, 31))
    assert points.award_period("QUARTER", "2025/26-Q4", now)[2:] == (date(2026, 4, 1), date(2026, 6, 30))


# --- write-up pick-lists and drawing differences -------------------------------------------------

def test_write_up_records_cause_action_and_a_drawing_difference_that_the_chief_verifies():
    catalogue = client.get("/api/v1/catalogue", headers=headers("st-electrical")).json()
    assert {item["value"] for item in catalogue["cause_categories"]} >= {"loose_connection", "modification", "not_found"}
    fault = allocated_electrical_job()
    technician = headers("st-electrical")
    now = datetime.now(timezone.utc)
    base = {"on_site_at": iso(now - timedelta(hours=2)), "back_in_service_at": iso(now - timedelta(hours=1)),
            "found": "Close limit switch wired to a different terminal than the drawing shows"}
    bad = client.post(f"/api/v1/faults/{fault}/visits", headers=technician, json={
        **base, "cause_category": "gremlins", "attempts": [{"action": "Re-terminated", "result": "worked", "action_type": "tighten"}]})
    assert bad.status_code == 422
    visit = client.post(f"/api/v1/faults/{fault}/visits", headers=technician, json={
        **base, "cause_category": "modification",
        "attempts": [{"action": "Re-terminated the limit switch at X5", "result": "worked", "action_type": "tighten"}],
        "drawing_difference": {"description": "Close limit switch on terminal X5, drawing shows X3", "drawing_number": "ILL-PS02-E-0388",
                               "permanence": "PERMANENT"},
    })
    assert visit.status_code == 200, visit.text
    context = client.get(f"/api/v1/faults/{fault}/context", headers=technician).json()
    assert context["diagnoses"][-1]["cause_category_label"] == "Unrecorded change (differs from drawing)"
    assert context["interventions"][-1]["action_type_label"] == "Tightened or re-terminated"
    difference = next(item for item in context["drawing_differences"] if "terminal X5" in item["description"])
    assert difference["status"] == "REPORTED" and difference["drawing_in_register"]

    queue = client.get("/api/v1/drawing-differences", headers=headers("ct-electrical")).json()
    assert queue["can_verify"] and any(item["id"] == difference["id"] for item in queue["differences"])
    # Another section's chief cannot see it at all (as with other section records).
    assert client.post(f"/api/v1/drawing-differences/{difference['id']}/review", headers=headers("ct-mechanical"),
                       json={"decision": "VERIFIED"}).status_code == 404
    verified = client.post(f"/api/v1/drawing-differences/{difference['id']}/review", headers=headers("ct-electrical"), json={"decision": "VERIFIED"})
    assert verified.status_code == 200 and verified.json()["status"] == "VERIFIED"

    # The drawing office (here the administrator) issues a new revision.
    assert client.post(f"/api/v1/drawing-differences/{difference['id']}/incorporated", headers=headers("st-electrical"), json={"revision": "E"}).status_code == 403
    drawn = client.post(f"/api/v1/drawing-differences/{difference['id']}/incorporated", headers=headers("admin"), json={"revision": "E"})
    assert drawn.status_code == 200 and drawn.json()["incorporated_revision"] == "E"

    entries = client.get("/api/v1/points/me", headers=technician).json()["entries"]
    assert any(entry["kind"] == "DRAWING_DIFFERENCE" for entry in entries)


def test_known_differences_and_expert_notes_reach_the_job_card():
    operations = headers("operations")
    valve = next(row for row in client.get("/api/v1/equipment?search=11-MOV-601", headers=operations).json() if row["tag"] == "11-MOV-601")
    fault = client.post("/api/v1/faults", headers=operations, json={"equipment_id": valve["id"], "symptom": "Won't open / close",
                                                                    "operational_impact": "Stopped"}).json()["id"]
    context = client.get(f"/api/v1/faults/{fault}/context", headers=headers("ct-electrical")).json()
    assert any(item["status"] == "VERIFIED" and "X5" in item["description"] for item in context["drawing_differences"])
    assert any(item["number"] == "ILL-PS02-E-0412" and item["status"] == "PAPER" for item in context["drawings"])
    rtu = next(row for row in client.get("/api/v1/equipment?search=RTU-201", headers=operations).json() if row["tag"] == "RTU-201")
    rtu_fault = client.post("/api/v1/faults", headers=operations, json={"equipment_id": rtu["id"], "symptom": "Communication lost",
                                                                        "operational_impact": "Running reduced"}).json()["id"]
    notes = client.get(f"/api/v1/faults/{rtu_fault}/context", headers=headers("automation")).json()["expert_notes"]
    assert notes and notes[0]["credit"].startswith("Expert knowledge: ")


def test_drawing_register_waits_for_digitised_files():
    register = client.get("/api/v1/drawings", headers=headers("st-electrical")).json()
    assert register["total"] >= 10 and register["digitised"] == 0
    drawing = register["drawings"][0]
    assert client.patch(f"/api/v1/drawings/{drawing['id']}", headers=headers("st-electrical"), json={"document_url": "https://example.org/x.pdf"}).status_code == 403
    linked = client.patch(f"/api/v1/drawings/{drawing['id']}", headers=headers("admin"), json={"document_url": "https://example.org/dwg.pdf"})
    assert linked.json()["status"] == "DIGITISED"
    client.patch(f"/api/v1/drawings/{drawing['id']}", headers=headers("admin"), json={"document_url": ""})
    assert client.get("/api/v1/drawings", headers=headers("hr")).status_code == 403


# --- expert knowledge --------------------------------------------------------------------------

def test_knowledge_at_risk_names_retiring_experts():
    rows = client.get("/api/v1/expertise/at-risk", headers=headers("maintenance-manager")).json()["rows"]
    assert rows and any(expert["retirement_date"] for row in rows for expert in row["experts"])
    assert all(row["level"] in ("HIGH", "MEDIUM", "LOW") and row["reasons"] for row in rows)
    assert client.get("/api/v1/expertise/at-risk", headers=headers("hr")).status_code == 200
    assert client.get("/api/v1/expertise/at-risk", headers=headers("operations")).status_code == 403
    scoped = client.get("/api/v1/expertise/at-risk", headers=headers("ct-electrical")).json()
    assert all(row["section"] == "Electrical" for row in scoped["rows"])
    assert client.patch(f"/api/v1/users/{me('st-mechanical')['id']}/retirement", headers=headers("hr"), json={"retirement_date": "2029-01-31"}).status_code == 200
    assert client.patch(f"/api/v1/users/{me('st-mechanical')['id']}/retirement", headers=headers("ct-mechanical"), json={"retirement_date": None}).status_code == 403


def test_expert_session_and_answer_earn_credit_after_review():
    scribe = headers("st-instrumentation")
    expert_id = me("senior-engineer-instrumentation")["id"]
    created = client.post("/api/v1/expertise/sessions", headers=scribe, json={
        "expert_id": expert_id, "equipment_type": "LT", "section": "Instrumentation", "title": "Level transmitters at night",
        "how_it_fails": "Condensation in the housing.", "first_checks": "Compare with a manual dip.",
    })
    assert created.status_code == 201
    session = created.json()
    assert client.post(f"/api/v1/expertise/sessions/{session['id']}/review", headers=headers("ct-electrical"), json={"decision": "APPROVE"}).status_code == 404
    approved = client.post(f"/api/v1/expertise/sessions/{session['id']}/review", headers=headers("ct-instrumentation"), json={"decision": "APPROVE"})
    assert approved.json()["status"] == "APPROVED"
    shared = client.get("/api/v1/expertise/sessions?equipment_type=LT", headers=headers("st-mechanical")).json()
    assert any(item["id"] == session["id"] for item in shared)  # approved knowledge is shared across sections
    kinds = {entry["kind"] for entry in client.get("/api/v1/points/me", headers=scribe).json()["entries"]}
    assert "EXPERT_SESSION_SCRIBE" in kinds

    asked = client.post("/api/v1/expertise/questions", headers=headers("st-mechanical"), json={
        "equipment_type": "PUMP", "section": "Mechanical", "text": "Transfer pump trips on high temperature after an hour. Where to start?"}).json()
    answered = client.post(f"/api/v1/expertise/questions/{asked['id']}/answers", headers=headers("pt-mechanical"),
                           json={"text": "Check the cooling fan and the bearing grease first."}).json()
    answer_id = answered["answers"][0]["id"]
    assert client.post(f"/api/v1/expertise/answers/{answer_id}/accept", headers=headers("pt-mechanical")).status_code == 403
    assert client.post(f"/api/v1/expertise/answers/{answer_id}/accept", headers=headers("st-mechanical")).json()["status"] == "ANSWERED"
    kinds = {entry["kind"] for entry in client.get("/api/v1/points/me", headers=headers("pt-mechanical")).json()["entries"]}
    assert "ANSWER_ACCEPTED" in kinds


def test_chief_pairs_an_adviser_on_a_job():
    fault = allocated_electrical_job()
    chief = headers("ct-electrical")
    assignment = next(item for item in client.get(f"/api/v1/faults/{fault}/context", headers=chief).json()["assignments"] if item["is_active"])
    adviser = me("senior-engineer-electrical")["id"]
    assert client.patch(f"/api/v1/faults/{fault}/assignments/{assignment['id']}/adviser", headers=headers("st-electrical"),
                        json={"adviser_id": adviser}).status_code == 403
    paired = client.patch(f"/api/v1/faults/{fault}/assignments/{assignment['id']}/adviser", headers=chief, json={"adviser_id": adviser})
    assert paired.status_code == 200 and paired.json()["adviser_name"]
    technician = headers("st-electrical")
    now = datetime.now(timezone.utc)
    client.post(f"/api/v1/faults/{fault}/visits", headers=technician, json={
        "on_site_at": iso(now - timedelta(hours=2)), "back_in_service_at": iso(now - timedelta(hours=1)), "found": "Loose terminal",
        "cause_category": "loose_connection", "attempts": [{"action": "Tightened X2", "result": "worked", "action_type": "tighten"}]})
    kinds = [entry["kind"] for entry in client.get("/api/v1/points/me", headers=technician).json()["entries"]]
    assert "SHADOW_JOB" in kinds and "COMPLETE_WRITE_UP" in kinds


# --- watch list -------------------------------------------------------------------------------

def test_watch_list_explains_itself_and_reports_its_accuracy():
    listed = client.get("/api/v1/analytics/watch-list", headers=headers("maintenance-manager")).json()
    assert listed["equipment"], "the seeded history should put some assets on the list"
    for row in listed["equipment"]:
        assert row["reasons"] and row["level"] in ("HIGH", "WATCH")
    assert any("Temporary fix in place" in reason for row in listed["equipment"] for reason in row["reasons"])
    accuracy = listed["accuracy"]
    assert accuracy["horizon_days"] == 30 and accuracy["verdict"]
    own = client.get("/api/v1/analytics/watch-list", headers=headers("st-electrical")).json()
    assert own["scope"] == "Electrical section" and all(row["section"] == "Electrical" for row in own["equipment"])
    for username in ("operations", "hr", "ceo"):
        assert client.get("/api/v1/analytics/watch-list", headers=headers(username)).status_code == 403
