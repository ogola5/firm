"""Fault reports: structured answers, call-back number, and safety hazards first."""
from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def headers(username: str) -> dict:
    response = client.post("/api/v1/auth/login", json={"email": f"demo.{username}@kpc.co.ke", "password": "demo123"})
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


def valve() -> dict:
    rows = client.get("/api/v1/equipment?search=11-MOV-602", headers=headers("operations")).json()
    return next(row for row in rows if row["tag"] == "11-MOV-602")


def test_a_safety_hazard_is_critical_kept_with_its_answers_and_first_in_the_queue():
    operations = headers("operations")
    report = client.post("/api/v1/faults", headers=operations, json={
        "equipment_id": valve()["id"], "symptom": "Leaking", "severity": "Medium",
        "operational_impact": "Running reduced: Working, but limited",
        "description": "11-MOV-602 · Tank 601 outlet valve: leaking.\nLeaking product; spraying or pooling.",
        "operating_conditions": "State now: Running. Already done: Told the shift supervisor",
        "safety_hazard": True, "callback": "ext 2231",
        "report_details": {"problem": "Leaking", "answers": {"what": "Product", "amount": "Spraying or pooling"}, "hazard": True},
    })
    assert report.status_code == 200, report.text
    fault_id = report.json()["id"]

    context = client.get(f"/api/v1/faults/{fault_id}/context", headers=operations).json()["fault"]
    assert context["severity"] == "Critical"  # a hazard is always Critical, whatever the effect
    assert context["safety_hazard"] is True and context["callback"] == "ext 2231"
    assert context["report_details"]["answers"]["what"] == "Product"
    timeline = client.get(f"/api/v1/faults/{fault_id}/timeline", headers=operations).json()
    assert any(item["event_type"] == "SAFETY_HAZARD_REPORTED" for item in timeline)

    # Systems Automation sees it first, ahead of older non-hazard faults.
    available = client.get("/api/v1/me/jobs", headers=headers("automation")).json()["available"]
    assert available and available[0]["fault_id"] == fault_id and available[0]["safety_hazard"] is True
    listed = client.get("/api/v1/faults", headers=headers("automation")).json()
    assert listed[0]["id"] == fault_id and listed[0]["safety_hazard"] is True


def test_an_ordinary_report_keeps_its_effect_based_priority():
    report = client.post("/api/v1/faults", headers=headers("operations"), json={
        "equipment_id": valve()["id"], "symptom": "Wrong or no reading", "severity": "Low",
        "operational_impact": "No effect yet: Needs attention, not urgent",
        "report_details": {"problem": "Wrong or no reading", "answers": {"which": "Tank 601 level"}},
    })
    context = client.get(f"/api/v1/faults/{report.json()['id']}/context", headers=headers("operations")).json()["fault"]
    assert context["severity"] == "Low" and context["safety_hazard"] is False and context["callback"] == ""
