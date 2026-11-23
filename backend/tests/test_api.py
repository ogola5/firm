from fastapi.testclient import TestClient

from app.main import app


client = TestClient(app)


def login(username="operations"):
    response = client.post("/api/v1/auth/login", json={"username": username, "password": "demo123"})
    assert response.status_code == 200
    return response.json()["access_token"]


def auth_headers(token):
    return {"Authorization": f"Bearer {token}"}


def test_login_and_seeded_data():
    token = login()
    me = client.get("/api/v1/auth/me", headers=auth_headers(token))
    assert me.status_code == 200
    assert me.json()["role"] == "Operations"
    equipment = client.get("/api/v1/equipment")
    assert len(equipment.json()) >= 30
    faults = client.get("/api/v1/faults")
    assert len(faults.json()) >= 100


def test_equipment_and_fault_reporting_permissions():
    operations_token = login("operations")
    equipment = client.get("/api/v1/equipment?search=PUMP").json()
    assert equipment
    created = client.post("/api/v1/faults", headers=auth_headers(operations_token), json={
        "equipment_id": equipment[0]["id"],
        "category": "Mechanical",
        "symptom": "Unexpected trip",
        "severity": "High",
        "description": "Test fault",
    })
    assert created.status_code == 200
    assert created.json()["reference"].startswith("KPC-DMO")

    mechanical_token = login("mechanical")
    denied = client.post("/api/v1/faults", headers=auth_headers(mechanical_token), json={
        "equipment_id": equipment[0]["id"],
        "category": "Mechanical",
        "symptom": "Unexpected trip",
    })
    assert denied.status_code == 403


def test_triage_and_workflow():
    token = login("automation")
    faults = client.get("/api/v1/faults").json()
    fault_id = faults[0]["id"]
    triage = client.post(f"/api/v1/faults/{fault_id}/triage", headers=auth_headers(token), json={
        "assigned_section": "Electrical",
        "triage_comment": "Test triage",
    })
    assert triage.status_code == 200
    acknowledge = client.post(f"/api/v1/faults/{fault_id}/action?action=acknowledge", headers=auth_headers(login("electrical")))
    assert acknowledge.status_code == 200
    assert acknowledge.json()["status"] == "ACKNOWLEDGED"


def test_sync_is_idempotent():
    event_id = "test-sync-event-001"
    payload = [{"event_id": event_id, "fault_id": "FAULT-DEMO", "event_type": "DIAGNOSIS_RECORDED", "actor_id": "USER-electrical", "client_timestamp": "2026-11-20T12:00:00Z", "payload": {"result": "test"}}]
    first = client.post("/api/v1/sync/events", json=payload)
    second = client.post("/api/v1/sync/events", json=payload)
    assert first.status_code == 200
    assert second.status_code == 200
    assert event_id in second.json()["duplicates"]


def test_analytics_and_repeat_intelligence():
    overview = client.get("/api/v1/analytics/overview")
    assert overview.status_code == 200
    data = overview.json()
    assert data["total_faults"] >= 100
    assert data["data_type"].startswith("Illustrative")
    equipment = client.get("/api/v1/equipment").json()[0]
    intelligence = client.get(f"/api/v1/intelligence/equipment/{equipment['id']}")
    assert intelligence.status_code == 200
