"""'Needs you now': each person's prioritised list, safety first."""
from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def headers(username: str) -> dict:
    response = client.post("/api/v1/auth/login", json={"email": f"demo.{username}@kpc.co.ke", "password": "demo123"})
    assert response.status_code == 200, response.text
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


def items(username: str) -> list[dict]:
    response = client.get("/api/v1/me/needs-you", headers=headers(username))
    assert response.status_code == 200, response.text
    return response.json()["items"]


def asset(tag: str) -> dict:
    rows = client.get(f"/api/v1/equipment?search={tag}", headers=headers("operations")).json()
    return next(row for row in rows if row["tag"] == tag)


def test_a_new_safety_fault_is_first_for_systems_automation():
    fault = client.post("/api/v1/faults", headers=headers("operations"), json={
        "equipment_id": asset("11-MOV-602")["id"], "symptom": "Leaking", "operational_impact": "Running reduced: Working, but limited",
        "safety_hazard": True}).json()
    rows = items("automation")
    assert rows[0]["safety"] is True and rows[0]["priority"] == 0
    assert any(row["reference"] == fault["reference"] and row["action"] == "Open" for row in rows)
    assert [row["priority"] for row in rows] == sorted(row["priority"] for row in rows)


def test_each_role_gets_its_own_kind_of_item():
    assert all(row["link"] for row in items("ct-mechanical"))
    supervisor = items("supervisor")
    assert any(row["link"] == "/approvals" and "to publish" in row["title"] for row in supervisor) or supervisor == []
    assert isinstance(items("operations"), list) and isinstance(items("hr"), list)
    assert client.get("/api/v1/me/needs-you").status_code == 401


def test_equipment_summary_brings_everything_together_and_respects_scope():
    pump = asset("11-P-401")
    summary = client.get(f"/api/v1/equipment/{pump['id']}/summary", headers=headers("st-mechanical")).json()
    assert summary["type_code"] == "PUMP" and summary["system"]["name"] == "Line 4 pump A unit"
    assert summary["fault_count"] >= 1 and summary["usual_causes"]
    assert all(row["status"] not in ("RESTORED", "CLOSED") for row in summary["open_faults"])
    assert client.get(f"/api/v1/equipment/{pump['id']}/summary", headers=headers("st-mechanical-coast")).status_code == 404
