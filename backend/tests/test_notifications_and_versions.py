"""The bell (in-app notifications) and side-by-side procedure versions with change reasons."""
from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def headers(username: str) -> dict:
    response = client.post("/api/v1/auth/login", json={"email": f"demo.{username}@kpc.co.ke", "password": "demo123"})
    assert response.status_code == 200, response.text
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


def bell(username: str) -> dict:
    return client.get("/api/v1/notifications", headers=headers(username)).json()


def titles(username: str) -> list[str]:
    return [item["title"] for item in bell(username)["items"]]


def asset(tag: str) -> dict:
    rows = client.get(f"/api/v1/equipment?search={tag}", headers=headers("operations")).json()
    return next(row for row in rows if row["tag"] == tag)


def test_demo_history_does_not_fill_anyones_bell():
    assert bell("pt-electrical-western") == {"unread": 0, "items": []}


def test_a_new_fault_reaches_systems_automation_and_a_safety_one_the_chief_technician_too():
    operations = headers("operations")
    ordinary = client.post("/api/v1/faults", headers=operations, json={
        "equipment_id": asset("11-MOV-602")["id"], "symptom": "Won't open / close", "operational_impact": "No effect yet: Needs attention, not urgent",
    }).json()
    assert any(ordinary["reference"] in title and title.startswith("New fault") for title in titles("automation"))
    assert not any(ordinary["reference"] in title for title in titles("operations"))  # never told about your own action

    hazard = client.post("/api/v1/faults", headers=operations, json={
        "equipment_id": asset("11-MOV-602")["id"], "symptom": "Leaking", "operational_impact": "Running reduced: Working, but limited",
        "safety_hazard": True,
    }).json()
    section = asset("11-MOV-602")["section"].lower().replace(" ", "-")
    for username in ("automation", f"ct-{section}"):
        assert any(title.startswith(f"SAFETY: {hazard['reference']}") for title in titles(username)), username


def test_marking_read_is_personal():
    automation = headers("automation")
    first = bell("automation")["items"][0]
    assert client.post(f"/api/v1/notifications/{first['id']}/read", headers=headers("operations")).status_code == 404
    read = client.post(f"/api/v1/notifications/{first['id']}/read", headers=automation)
    assert read.status_code == 200 and read.json()["read"] is True
    assert client.post("/api/v1/notifications/read-all", headers=automation).json() == {"unread": 0}
    assert bell("automation")["unread"] == 0


def test_allocation_acknowledgement_and_escalation_notify_the_right_people():
    operations, automation = headers("operations"), headers("automation")
    equipment = next(row for row in client.get("/api/v1/equipment", headers=operations).json()
                     if row["section"] == "Electrical" and row["region"] == "Nairobi" and not row["tag"].startswith("UNCONFIRMED"))
    fault = client.post("/api/v1/faults", headers=operations, json={
        "equipment_id": equipment["id"], "symptom": "Stopped / tripped", "operational_impact": "Stopped: Operation stopped or at risk",
    }).json()
    assert client.post(f"/api/v1/faults/{fault['id']}/action?action=acknowledge", headers=automation).status_code == 200
    handover = client.post(f"/api/v1/faults/{fault['id']}/assignments/escalate", headers=automation, json={
        "next_section": "Electrical", "findings": "Controls fine.", "recommendation": "Check the drive."}).json()
    assert client.post(f"/api/v1/faults/{fault['id']}/assignments/{handover['assignment_id']}/review",
                       headers=headers("ct-systems-automation"), json={"decision": "APPROVE_ESCALATION"}).status_code == 200
    assert any(title.startswith(f"New work for Electrical: {fault['reference']}") for title in titles("ct-electrical"))

    chief = headers("ct-electrical")
    context = client.get(f"/api/v1/faults/{fault['id']}/context", headers=chief).json()
    assignment = next(item for item in context["assignments"] if item["is_active"])
    technician = client.get("/api/v1/auth/me", headers=headers("st-electrical")).json()
    assert client.post(f"/api/v1/faults/{fault['id']}/assignments/{assignment['id']}/allocate", headers=chief, json={
        "assigned_user_id": technician["id"], "severity": "High", "instructions": "Check the drive fan first."}).status_code == 200
    job = next(item for item in bell("st-electrical")["items"] if fault["reference"] in item["title"])
    assert job["title"].startswith("Job given to you") and "drive fan" in job["body"] and job["link"].endswith("/card")

    assert client.post(f"/api/v1/faults/{fault['id']}/action?action=acknowledge", headers=headers("st-electrical")).status_code == 200
    assert any(fault["reference"] in title and " took " in title for title in titles("ct-electrical"))

    level = client.get(f"/api/v1/faults/{fault['id']}", headers=chief).json()["escalation_level"]
    if level == 0:
        assert client.post(f"/api/v1/faults/{fault['id']}/escalate", headers=chief,
                           json={"to": "SE", "reason": "Trips again after every reset"}).status_code == 200
        escalated = next(item for item in bell("senior-engineer-electrical")["items"] if fault["reference"] in item["title"])
        assert "Trips again" in escalated["body"]
    else:
        # This equipment was fixed within 30 days, so the report went straight to the Chief Engineer.
        escalated = next(item for item in bell("chief-engineer-electrical")["items"] if fault["reference"] in item["title"])
    assert escalated["kind"] == "escalation" and escalated["title"].startswith("Escalated to you")
    assert not any(fault["reference"] in title for title in titles("senior-engineer-electrical-coast"))


def test_an_improvement_needs_a_reason_notifies_reviewers_and_author_and_versions_compare():
    strainers = client.get("/api/v1/library/types/STR", headers=headers("pt-mechanical")).json()
    group = next(item for item in strainers["symptoms"] if item["symptom"] == "Blocked or low flow")
    base = next(card for card in group["procedures"] if card["reference"].startswith("PU-LIB"))
    case = next(item for item in group["cases"] if item["reference"].startswith("KPC-LIB") and item["id"] != base["source_fault"]["id"])
    body = {"title": base["title"], "observed_symptom": base["symptom"], "confirmed_cause": base["cause"],
            "diagnostic_procedure": base["checks"] + "\n3. If it blocks again within a week, check the upstream tank for sediment.",
            "corrective_action": base["fix"], "safety": "", "builds_on_id": base["id"]}
    pt = headers("pt-mechanical")
    assert client.post(f"/api/v1/faults/{case['id']}/procedure-updates", headers=pt, json=body).status_code == 422
    new = client.post(f"/api/v1/faults/{case['id']}/procedure-updates", headers=pt,
                      json={**body, "change_reason": "Blocked again within a week: added the upstream sediment check"}).json()
    assert any(title.startswith("Improvement to review") for title in titles("ct-mechanical"))
    assert any(title.startswith("Improvement to review") for title in titles("chief-engineer-mechanical"))

    # An unpublished version is visible to its author and reviewers, not to everyone.
    assert client.get(f"/api/v1/procedure-updates/{new['id']}/versions", headers=headers("st-electrical")).status_code == 404
    assert client.post(f"/api/v1/procedure-updates/{new['id']}/review", headers=headers("ct-mechanical"),
                       json={"decision": "APPROVE"}).status_code == 200
    assert any(title.startswith("Ready to publish") for title in titles("supervisor"))
    assert client.post(f"/api/v1/procedure-updates/{new['id']}/review", headers=headers("supervisor"),
                       json={"decision": "APPROVE"}).status_code == 200
    assert any(title.startswith("Published") for title in titles("pt-mechanical"))

    versions = client.get(f"/api/v1/procedure-updates/{base['id']}/versions", headers=headers("st-electrical")).json()
    rows = versions["versions"]
    assert [row["status"] for row in rows] == ["SUPERSEDED", "APPROVED"]
    assert rows[1]["change_reason"].startswith("Blocked again") and rows[1]["published_by"] == "Demo Supervisor User"
    assert "upstream tank" in rows[1]["fields"]["diagnostic_procedure"] and "upstream tank" not in rows[0]["fields"]["diagnostic_procedure"]
    assert versions["field_labels"]["corrective_action"] == "Fix"
