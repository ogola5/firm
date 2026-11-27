"""Admin console: two levels (System Administrator, and the developer / owner), health, rules, the
equipment register, the audit trail, read-only "view as" and the guarded demo reset."""
from datetime import datetime, timedelta, timezone

from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def sign_in(username: str) -> dict:
    response = client.post("/api/v1/auth/login", json={"email": f"demo.{username}@kpc.co.ke", "password": "demo123"})
    assert response.status_code == 200, response.text
    return response.json()


def headers(username: str) -> dict:
    return {"Authorization": f"Bearer {sign_in(username)['access_token']}"}


def test_two_levels_the_developer_has_the_tools_the_administrator_does_not():
    developer = sign_in("developer")["user"]
    assert developer["developer"] is True and developer["role"] == "system_administrator"
    assert developer["access"]["level"] == "DEV" and "dev.tools" in developer["access"]["can"]
    assert any(item["key"] == "admin" for item in developer["access"]["menu"])
    admin = sign_in("admin")["user"]
    assert admin["developer"] is False and "dev.tools" not in admin["access"]["can"]
    assert any(item["key"] == "admin" for item in admin["access"]["menu"])

    target = client.get("/api/v1/auth/me", headers=headers("st-electrical")).json()["id"]
    assert client.post(f"/api/v1/admin/view-as/{target}", headers=headers("admin")).status_code == 403
    assert client.post("/api/v1/admin/demo/reset", headers=headers("admin"), json={"confirm": "RESET"}).status_code == 403
    rows = client.get("/api/v1/admin/settings", headers=headers("admin")).json()
    assert rows and not any(row["developer_only"] for row in rows)
    assert client.patch("/api/v1/admin/settings/banner_text", headers=headers("admin"), json={"value": "Hello"}).status_code == 403
    # Nobody outside administration gets in.
    for username in ("st-electrical", "ct-electrical", "maintenance-manager", "hr"):
        assert client.get("/api/v1/admin/health", headers=headers(username)).status_code == 403, username


def test_health_reports_the_parts_that_matter():
    health = client.get("/api/v1/admin/health", headers=headers("admin")).json()
    assert health["database"]["ok"] is True and health["database"]["latency_ms"] >= 0
    assert {"app", "commit", "started_at"} <= set(health["version"])
    assert {"enabled", "last_run", "runs"} <= set(health["scheduler"])
    assert "files" in health["storage"] and "conflicts_waiting" in health["sync"]
    assert isinstance(health["errors"], list) and health["counts"]["people_active"] > 0


def test_view_as_is_read_only_and_logged():
    developer = headers("developer")
    person = next(row for row in client.get("/api/v1/admin/people", headers=developer).json() if row["name"].startswith("Demo Senior Technician (ST) (Electrical, Nairobi)"))
    started = client.post(f"/api/v1/admin/view-as/{person['id']}", headers=developer)
    assert started.status_code == 200, started.text
    viewing = {"Authorization": f"Bearer {started.json()['access_token']}"}
    assert client.get("/api/v1/auth/me", headers=viewing).json()["id"] == person["id"]
    assert client.get("/api/v1/me/jobs", headers=viewing).status_code == 200  # sees exactly their screens
    blocked = client.post("/api/v1/notifications/read-all", headers=viewing, json={})
    assert blocked.status_code == 403 and "read-only" in blocked.json()["detail"]
    trail = client.get("/api/v1/admin/audit?kind=developer", headers=developer).json()
    assert any(row["action"] == "VIEW_AS_STARTED" and row["target"] == person["name"] for row in trail)


def test_rules_change_the_workflow_and_can_be_reset():
    admin = headers("admin")
    assert client.patch("/api/v1/admin/settings/se_after_hours", headers=admin, json={"value": 0}).status_code == 422
    assert client.patch("/api/v1/admin/settings/se_after_hours", headers=admin, json={"value": "eight"}).status_code == 422
    assert client.patch("/api/v1/admin/settings/no_such_rule", headers=admin, json={"value": 1}).status_code == 404

    changed = client.patch("/api/v1/admin/settings/response_minutes_low", headers=admin, json={"value": 90})
    assert changed.status_code == 200 and changed.json()["value"] == 90
    try:
        rows = {row["key"]: row for row in client.get("/api/v1/admin/settings", headers=admin).json()}
        assert rows["response_minutes_low"]["changed"] and rows["response_minutes_low"]["updated_by"]
        operations = headers("operations")
        valve = next(row for row in client.get("/api/v1/equipment?search=11-MOV-602", headers=operations).json() if row["tag"] == "11-MOV-602")
        fault = client.post("/api/v1/faults", headers=operations, json={
            "equipment_id": valve["id"], "symptom": "Wrong or no reading", "severity": "Low",
            "operational_impact": "No effect yet: Needs attention, not urgent",
        }).json()
        active = next(item for item in client.get(f"/api/v1/faults/{fault['id']}/context", headers=operations).json()["assignments"] if item["is_active"])
        due = datetime.fromisoformat(active["response_due_at"])
        due = due if due.tzinfo else due.replace(tzinfo=timezone.utc)
        assert abs(due - (datetime.now(timezone.utc) + timedelta(minutes=90))) < timedelta(minutes=2)
    finally:
        reset = client.patch("/api/v1/admin/settings/response_minutes_low", headers=admin, json={"reset": True})
        assert reset.status_code == 200 and reset.json()["value"] == 1440
    trail = client.get("/api/v1/admin/audit?kind=settings", headers=admin).json()
    assert any(row["details"].get("key") == "response_minutes_low" and row["details"].get("to") == 90 for row in trail)


def test_the_developer_sets_a_banner_everyone_sees():
    developer = headers("developer")
    assert client.patch("/api/v1/admin/settings/banner_text", headers=developer, json={"value": "Board demonstration today"}).status_code == 200
    try:
        assert client.get("/api/v1/system/config").json()["banner"] == "Board demonstration today"
    finally:
        client.patch("/api/v1/admin/settings/banner_text", headers=developer, json={"reset": True})
    assert client.get("/api/v1/system/config").json()["banner"] == ""
    assert client.post("/api/v1/admin/demo/reset", headers=developer, json={"confirm": "yes"}).status_code == 422


def test_the_administrator_adds_demo_equipment_by_hand_or_from_a_csv():
    admin = headers("admin")
    tag = f"ADM-P-{datetime.now().strftime('%H%M%S%f')[:10]}"
    added = client.post("/api/v1/admin/equipment", headers=admin, json={
        "tag": tag, "name": "Demo booster pump C", "section": "Mechanical", "station": "PS02", "location": "Pump house",
        "criticality": "High", "aliases": "booster pump c",
    })
    assert added.status_code == 201, added.text
    assert added.json()["region"] == "Nairobi"  # from the station
    assert client.post("/api/v1/admin/equipment", headers=admin, json={
        "tag": tag, "name": "Again", "section": "Mechanical", "station": "PS02"}).status_code == 409
    assert client.post("/api/v1/admin/equipment", headers=admin, json={
        "tag": "X-1", "name": "Bad", "section": "Instrumentation", "station": "PS02"}).status_code == 422
    found = client.get(f"/api/v1/equipment?search={tag}", headers=headers("operations")).json()
    assert any(row["tag"] == tag for row in found)  # Operations can report on it at once

    csv_text = "\n".join([
        "tag,name,section,station,region,criticality",
        f"{tag}-A,Demo valve A,Electrical,PS02,,Medium",
        f"{tag}-B,Demo transmitter B,Systems Automation,NEW-STN,Western,Low",
        f"{tag}-C,Bad row,Plumbing,PS02,,Medium",
    ])
    checked = client.post("/api/v1/admin/equipment/import", headers=admin, json={"csv": csv_text})
    assert checked.status_code == 200 and checked.json()["saved"] is False
    assert [error["row"] for error in checked.json()["errors"]] == [4]  # nothing saved while any row is wrong
    good = "\n".join(csv_text.splitlines()[:3])
    dry = client.post("/api/v1/admin/equipment/import", headers=admin, json={"csv": good, "dry_run": True}).json()
    assert dry["add"] == 2 and dry["saved"] is False
    saved = client.post("/api/v1/admin/equipment/import", headers=admin, json={"csv": good}).json()
    assert saved["saved"] is True and saved["add"] == 2
    again = client.post("/api/v1/admin/equipment/import", headers=admin, json={"csv": good}).json()
    assert again["add"] == 0 and again["update"] == 2
    organisation = client.get("/api/v1/admin/organisation", headers=admin).json()
    assert "NEW-STN" in next(region for region in organisation["regions"] if region["name"] == "Western")["stations"]
    assert {section["name"] for section in organisation["sections"]} == {"Systems Automation", "Electrical", "Mechanical"}


def test_sign_ins_are_in_the_audit_trail():
    sign_in("ct-mechanical")
    trail = client.get("/api/v1/admin/audit?kind=signin", headers=headers("admin")).json()
    assert any(row["action"] == "SIGNED_IN" and "Mechanical" in row["actor"] for row in trail)
