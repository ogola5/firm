"""Open pickup: reported straight to a section, anyone free takes it (any section), colleagues called in
to help, the equipment working again at once, and the Chief Technician's check of the write-up afterwards."""
from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def headers(username: str) -> dict:
    response = client.post("/api/v1/auth/login", json={"email": f"demo.{username}@kpc.co.ke", "password": "demo123"})
    assert response.status_code == 200, response.text
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


def me(username: str) -> dict:
    return client.get("/api/v1/auth/me", headers=headers(username)).json()


def asset(tag: str) -> dict:
    rows = client.get(f"/api/v1/equipment?search={tag}", headers=headers("operations")).json()
    return next(row for row in rows if row["tag"] == tag)


def report(tag: str, **extra) -> dict:
    response = client.post("/api/v1/faults", headers=headers("operations"), json={
        "equipment_id": asset(tag)["id"], "symptom": "Won't open / close", "operational_impact": "Stopped: Operation stopped or at risk",
        **extra,
    })
    assert response.status_code == 200, response.text
    return response.json()


def timeline(fault_id: str, username: str = "operations") -> list[dict]:
    return client.get(f"/api/v1/faults/{fault_id}/timeline", headers=headers(username)).json()


def test_operations_sends_it_straight_to_mechanical_or_electrical():
    strainer = asset("11-STR-601")  # looked after by Mechanical
    assert strainer["section"] == "Mechanical"
    direct = report("11-STR-601")
    assert direct["assigned_section"] == "Mechanical"
    chosen = report("11-STR-601", send_to="Electrical")  # the reporter knows better: it is the heater supply
    assert chosen["assigned_section"] == "Electrical"
    assigned = [item for item in timeline(chosen["id"]) if item["event_type"] == "FAULT_ASSIGNED"]
    assert '"routing_strategy": "REPORTER_CHOSE"' in assigned[0]["payload"]
    bad = client.post("/api/v1/faults", headers=headers("operations"), json={
        "equipment_id": strainer["id"], "symptom": "Leaking", "operational_impact": "Stopped", "send_to": "Instrumentation",
    })
    assert bad.status_code == 422  # Instrumentation and Control is now Systems Automation


def test_anyone_free_in_another_section_can_take_it_and_their_chief_is_told():
    fault = report("11-STR-601")  # Mechanical
    electrical = headers("st-electrical")
    jobs = client.get("/api/v1/me/jobs", headers=electrical).json()
    listed = next(item for item in jobs["available"] if item["fault_id"] == fault["id"])
    assert listed["own_section"] is False and listed["section"] == "Mechanical"

    taken = client.post(f"/api/v1/faults/{fault['id']}/action?action=acknowledge", headers=electrical)
    assert taken.status_code == 200, taken.text
    assert taken.json()["assigned_section"] == "Electrical"  # their own Chief Technician checks the write-up
    events = [item["event_type"] for item in timeline(fault["id"])]
    assert "TAKEN_FROM_OTHER_SECTION" in events and "FAULT_ACKNOWLEDGE" in events
    mechanical_chief = [item["title"] for item in client.get("/api/v1/notifications", headers=headers("ct-mechanical")).json()["items"]]
    assert any(fault["reference"] in title and "took" in title for title in mechanical_chief)
    # First to take it gets it.
    late = client.post(f"/api/v1/faults/{fault['id']}/action?action=acknowledge", headers=headers("pt-mechanical"))
    assert late.status_code == 409 and "Already taken by" in late.json()["detail"]
    # Gone from everyone's "nobody has taken it" list.
    assert not any(item["fault_id"] == fault["id"] for item in client.get("/api/v1/me/jobs", headers=headers("pt-mechanical")).json()["available"])


def test_call_someone_in_to_help_and_the_fix_counts_at_once():
    fault = report("11-MOV-601")
    lead = headers("pt-electrical")
    assert client.post(f"/api/v1/faults/{fault['id']}/action?action=acknowledge", headers=lead).status_code == 200

    candidates = client.get(f"/api/v1/faults/{fault['id']}/helper-candidates", headers=lead).json()
    mechanic = next(item for item in candidates if item["id"] == me("st-mechanical")["id"])
    assert mechanic["section"] == "Mechanical"
    assert not any(item["id"] == me("pt-electrical")["id"] for item in candidates)
    added = client.post(f"/api/v1/faults/{fault['id']}/helpers", headers=lead, json={"user_id": mechanic["id"], "note": "Gearbox feels stiff"})
    assert added.status_code == 200, added.text
    assert client.post(f"/api/v1/faults/{fault['id']}/helpers", headers=lead, json={"user_id": mechanic["id"]}).status_code == 409
    # Someone not on the job cannot call people in.
    assert client.post(f"/api/v1/faults/{fault['id']}/helpers", headers=headers("st-electrical"),
                       json={"user_id": me("pt-mechanical")["id"]}).status_code == 403

    helper = headers("st-mechanical")
    bell = [item["title"] for item in client.get("/api/v1/notifications", headers=helper).json()["items"]]
    assert any("asked you to help" in title and fault["reference"] in title for title in bell)
    assert any(item["fault_id"] == fault["id"] for item in client.get("/api/v1/me/jobs", headers=helper).json()["helping"])
    context = client.get(f"/api/v1/faults/{fault['id']}/context", headers=helper).json()  # the helper can open it
    active = next(item for item in context["assignments"] if item["is_active"])
    assert [person["name"] for person in active["helpers"]] == [me("st-mechanical")["display_name"]]

    # The helper writes up what they found and did; it works, so it is working again now.
    from datetime import datetime, timedelta, timezone
    now = datetime.now(timezone.utc)
    visit = client.post(f"/api/v1/faults/{fault['id']}/visits", headers=helper, json={
        "on_site_at": (now - timedelta(minutes=2)).isoformat(), "back_in_service_at": (now - timedelta(minutes=1)).isoformat(),
        "found": "Gearbox dry; actuator stalled on torque", "attempts": [{"action": "Greased gearbox, reset torque switch", "result": "worked"}],
        "request_signoff": True,
    })
    assert visit.status_code == 200, visit.text
    assert visit.json()["status"] == "RESTORED"
    reporter_bell = [item["title"] for item in client.get("/api/v1/notifications", headers=headers("operations")).json()["items"]]
    assert any(title.startswith("Back in service: please confirm") and fault["reference"] in title for title in reporter_bell)

    chief = headers("ct-electrical")
    workspace = client.get("/api/v1/chief/workspace", headers=chief).json()
    record = next(item for item in workspace["faults"] if item["id"] == fault["id"])
    assert record["write_up_to_check"] and not record["handover_review"]
    needs = client.get("/api/v1/me/needs-you", headers=chief).json()["items"]
    assert any(item["title"].startswith("Check the write-up") and item["reference"] == fault["reference"] for item in needs)

    # Operations confirm and it closes; the Chief Technician can still check the write-up afterwards.
    assert client.post(f"/api/v1/faults/{fault['id']}/operator-confirmation", headers=headers("operations"),
                       json={"confirmed": True}).json()["status"] == "CLOSED"
    review = client.post(f"/api/v1/faults/{fault['id']}/assignments/{active['id']}/review", headers=chief,
                         json={"decision": "APPROVE_COMPLETION"})
    assert review.status_code == 200 and review.json()["status"] == "CLOSED"


def test_the_chief_technicians_note_reaches_whoever_takes_the_job_and_help_reaches_the_chief():
    fault = report("11-MOV-501")  # Electrical
    chief = headers("ct-electrical")
    # The Chief Technician comments before anyone has taken it.
    assert client.post(f"/api/v1/faults/{fault['id']}/notes", headers=chief,
                       json={"note": "Check the torque switch first; it tripped twice last week."}).status_code == 200
    technician = headers("st-electrical")
    assert client.post(f"/api/v1/faults/{fault['id']}/action?action=acknowledge", headers=technician).status_code == 200
    context = client.get(f"/api/v1/faults/{fault['id']}/context", headers=technician).json()
    assert context["job_notes"][0]["note"].startswith("Check the torque switch") and context["job_notes"][0]["by"]
    job = next(item for item in client.get("/api/v1/me/jobs", headers=technician).json()["to_write_up"] if item["fault_id"] == fault["id"])
    assert job["latest_note"]["note"].startswith("Check the torque switch")

    # A later note is sent to the person on the job.
    client.post(f"/api/v1/faults/{fault['id']}/notes", headers=chief, json={"note": "Spare actuator card is in store B."})
    bell = [item["title"] for item in client.get("/api/v1/notifications", headers=technician).json()["items"]]
    assert any(title.startswith("Note on your job") and fault["reference"] in title for title in bell)

    # On a job: other new (non-safety) faults stay out of "Needs you now" until it is finished.
    report("11-MOV-501")
    needs = client.get("/api/v1/me/needs-you", headers=technician).json()["items"]
    assert not any(item["title"].startswith("New fault") and not item["safety"] for item in needs)

    # The technician asks the Chief Technician for help; it waits in their list until a Chief Technician answers.
    assert client.post(f"/api/v1/faults/{fault['id']}/notes", headers=technician,
                       json={"note": "Gearbox is seized; need a decision on replacing it.", "ask_chief": True}).status_code == 200
    chief_needs = client.get("/api/v1/me/needs-you", headers=chief).json()["items"]
    assert any(item["title"].startswith("Help asked by") and item["reference"] == fault["reference"] for item in chief_needs)
    client.post(f"/api/v1/faults/{fault['id']}/notes", headers=chief, json={"note": "Replace it; I have ordered the part."})
    chief_needs = client.get("/api/v1/me/needs-you", headers=chief).json()["items"]
    assert not any(item["title"].startswith("Help asked by") and item["reference"] == fault["reference"] for item in chief_needs)
    assert client.post(f"/api/v1/faults/{fault['id']}/notes", headers=headers("operations"), json={"note": "x"}).status_code == 403


def test_whoever_takes_an_unidentified_fault_confirms_the_equipment():
    operations = headers("operations")
    created = client.post("/api/v1/faults", headers=operations, json={
        "equipment_confirmed": False, "reported_equipment_text": "the noisy pump by tank 601", "symptom": "Noisy / vibrating",
        "operational_impact": "Running reduced", "send_to": "Mechanical",
    }).json()
    assert created["assigned_section"] == "Mechanical"
    mechanic = headers("st-mechanical")
    assert client.post(f"/api/v1/faults/{created['id']}/action?action=acknowledge", headers=mechanic).status_code == 409
    pump = asset("11-P-601")
    confirmed = client.post(f"/api/v1/faults/{created['id']}/triage", headers=mechanic, json={
        "assigned_section": "Mechanical", "confirmed_equipment_id": pump["id"], "triage_comment": "It is the transfer pump",
    })
    assert confirmed.status_code == 200, confirmed.text
    assert client.post(f"/api/v1/faults/{created['id']}/triage", headers=mechanic, json={"assigned_section": "Electrical"}).status_code in (403, 422)
    assert client.post(f"/api/v1/faults/{created['id']}/action?action=acknowledge", headers=mechanic).status_code == 200
