"""Desk workflow: descriptive equipment search, report times, visit write-ups with real times."""
import uuid
from datetime import datetime, timedelta, timezone

from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def headers(username: str) -> dict:
    response = client.post("/api/v1/auth/login", json={"email": f"demo.{username}@kpc.co.ke", "password": "demo123"})
    assert response.status_code == 200
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


def user_id(auth: dict) -> str:
    return client.get("/api/v1/auth/me", headers=auth).json()["id"]


def iso(moment: datetime) -> str:
    return moment.astimezone(timezone.utc).isoformat()


def parsed(value: str) -> datetime:
    moment = datetime.fromisoformat(value)
    return moment if moment.tzinfo else moment.replace(tzinfo=timezone.utc)


def equipment_by_tag(tag: str) -> dict:
    rows = client.get(f"/api/v1/equipment?search={tag}", headers=headers("operations")).json()
    return next(row for row in rows if row["tag"] == tag)


def test_equipment_search_understands_tags_and_plain_descriptions():
    operations = headers("operations")

    def first(query: str) -> str:
        rows = client.get("/api/v1/equipment", params={"search": query}, headers=operations).json()
        return rows[0]["tag"]

    assert first("tank 601 inlet valve") == "11-MOV-601"
    assert first("T601 inlet") == "11-MOV-601"
    assert first("mov 501") == "11-MOV-501"
    assert first("11-mov-501") == "11-MOV-501"
    assert first("tank 601 level") == "11-LT-601"
    assert first("booster pump b") == "PUMP-102"


def test_report_records_how_and_when_it_was_seen():
    operations = headers("operations")
    valve = equipment_by_tag("11-MOV-601")
    seen = datetime.now(timezone.utc) - timedelta(minutes=40)
    report = client.post("/api/v1/faults", headers=operations, json={
        "equipment_id": valve["id"], "symptom": "Won't open / close", "operational_impact": "Stopped",
        "severity": "High", "seen_via": "SITE_WALK", "observed_at": iso(seen),
    })
    assert report.status_code == 200
    context = client.get(f"/api/v1/faults/{report.json()['id']}/context", headers=operations).json()
    assert context["fault"]["seen_via"] == "SITE_WALK"
    assert abs(parsed(context["fault"]["observed_at"]) - seen) < timedelta(seconds=2)
    assert context["fault"]["equipment_name"] == "Tank 601 inlet valve"

    future = client.post("/api/v1/faults", headers=operations, json={
        "equipment_id": valve["id"], "symptom": "Leaking", "operational_impact": "Running reduced",
        "observed_at": iso(datetime.now(timezone.utc) + timedelta(hours=2)),
    })
    assert future.status_code == 422
    assert "future" in future.json()["detail"]


def allocated_electrical_job(seen_hours_ago: float = 3) -> str:
    """Report straight to Electrical (no Systems Automation step); its Chief Technician gives it to st-electrical."""
    operations = headers("operations")
    valve = equipment_by_tag("11-MOV-501")
    report = client.post("/api/v1/faults", headers=operations, json={
        "equipment_id": valve["id"], "symptom": "Won't open / close", "operational_impact": "Stopped",
        "seen_via": "SCADA", "observed_at": iso(datetime.now(timezone.utc) - timedelta(hours=seen_hours_ago)),
        "send_to": "Electrical",
    }).json()
    assert report["assigned_section"] == "Electrical"
    fault = report["id"]
    chief = headers("ct-electrical")
    active = next(item for item in client.get(f"/api/v1/faults/{fault}/context", headers=chief).json()["assignments"] if item["is_active"])
    assert client.post(f"/api/v1/faults/{fault}/assignments/{active['id']}/allocate", headers=chief, json={
        "assigned_user_id": user_id(headers("st-electrical")), "severity": "High",
    }).status_code == 200
    return fault


def test_visit_write_up_uses_the_technicians_times_through_to_restoration():
    fault = allocated_electrical_job()
    technician = headers("st-electrical")

    jobs = client.get("/api/v1/me/jobs", headers=technician).json()
    assert any(item["fault_id"] == fault for item in jobs["assigned"])

    assert client.post(f"/api/v1/faults/{fault}/action?action=acknowledge", headers=technician).status_code == 200
    jobs = client.get("/api/v1/me/jobs", headers=technician).json()
    assert any(item["fault_id"] == fault for item in jobs["to_write_up"])

    now = datetime.now(timezone.utc)
    on_site, back = now - timedelta(hours=2), now - timedelta(minutes=50)
    visit = client.post(f"/api/v1/faults/{fault}/visits", headers=technician, json={
        "on_site_at": iso(on_site),
        "back_in_service_at": iso(back),
        "found": "Loose supply terminal at X1",
        "attempts": [
            {"action": "Reset the actuator controller", "result": "failed"},
            {"action": "Replaced terminal X1", "result": "worked"},
        ],
        "parts": "1 x terminal block",
        "request_signoff": True,
    })
    assert visit.status_code == 200, visit.text
    assert visit.json()["status"] == "RESTORED"  # working again now; the Chief Technician checks the write-up later
    assert any(item["fault_id"] == fault for item in client.get("/api/v1/me/jobs", headers=technician).json()["waiting"])

    timeline = client.get(f"/api/v1/faults/{fault}/timeline", headers=technician).json()
    on_site_event = next(item for item in timeline if item["event_type"] == "FAULT_ON_SITE")
    assert abs(parsed(on_site_event["created_at"]) - on_site) < timedelta(seconds=2)
    assert [item["event_type"] for item in timeline if item["event_type"].startswith("INTERVENTION_")] == [
        "INTERVENTION_FAILED", "INTERVENTION_SUCCESS",
    ]

    chief = headers("ct-electrical")
    checked = next(item for item in client.get(f"/api/v1/faults/{fault}/context", headers=chief).json()["assignments"]
                   if item["completion_review_status"] == "PENDING")
    assert client.post(f"/api/v1/faults/{fault}/assignments/{checked['id']}/review", headers=chief, json={
        "decision": "APPROVE_COMPLETION",
    }).status_code == 200
    timeline = client.get(f"/api/v1/faults/{fault}/timeline", headers=technician).json()
    restored = next(item for item in timeline if item["event_type"] == "FAULT_RESTORE")
    assert abs(parsed(restored["created_at"]) - back) < timedelta(seconds=2), "restoration is when it worked, not sign-off"
    assert any(item["fault_id"] == fault for item in client.get("/api/v1/me/jobs", headers=technician).json()["procedure_ready"])


def test_visit_times_and_sign_off_are_checked():
    fault = allocated_electrical_job(seen_hours_ago=1)
    technician = headers("st-electrical")
    assert client.post(f"/api/v1/faults/{fault}/action?action=acknowledge", headers=technician).status_code == 200
    now = datetime.now(timezone.utc)

    def visit(**changes):
        body = {
            "on_site_at": iso(now - timedelta(minutes=30)), "back_in_service_at": iso(now - timedelta(minutes=10)),
            "found": "Torque switch tripped", "attempts": [{"action": "Reset torque switch", "result": "worked"}],
        }
        body.update(changes)
        return client.post(f"/api/v1/faults/{fault}/visits", headers=technician, json=body)

    assert visit(on_site_at=iso(now + timedelta(hours=1))).status_code == 422
    assert visit(on_site_at=iso(now - timedelta(hours=5))).json()["detail"].startswith("Arrival on site is earlier")
    assert visit(back_in_service_at=iso(now - timedelta(minutes=45))).status_code == 422
    assert visit(attempts=[{"action": "Reset", "result": "failed"}], request_signoff=True).status_code == 422
    assert visit(found=" ").status_code == 422
    assert client.post(f"/api/v1/faults/{fault}/visits", headers=headers("pt-electrical"), json={
        "on_site_at": iso(now - timedelta(minutes=30)), "found": "x", "attempts": [{"action": "y", "result": "worked"}],
    }).status_code == 409

    # A partial visit (not fixed) is fine without sign-off and keeps the job with the technician.
    partial = visit(attempts=[{"action": "Reset torque switch", "result": "partly"}], back_in_service_at=None)
    assert partial.status_code == 200
    assert partial.json()["fixed"] is False
    assert any(item["fault_id"] == fault for item in client.get("/api/v1/me/jobs", headers=technician).json()["to_write_up"])


def test_writing_up_without_taking_the_job_first_counts_as_taking_it_on_arrival():
    fault = allocated_electrical_job()
    technician = headers("st-electrical")
    on_site = datetime.now(timezone.utc) - timedelta(hours=2)
    visit = client.post(f"/api/v1/faults/{fault}/visits", headers=technician, json={
        "on_site_at": iso(on_site), "found": "Torque switch tripped",
        "attempts": [{"action": "Reset torque switch", "result": "partly"}],
    })
    assert visit.status_code == 200, visit.text
    timeline = client.get(f"/api/v1/faults/{fault}/timeline", headers=technician).json()
    acknowledged = next(item for item in timeline if item["event_type"] == "FAULT_ACKNOWLEDGE")
    assert abs(parsed(acknowledged["created_at"]) - on_site) < timedelta(seconds=2)
    assert '"implied_by_visit": true' in acknowledged["payload"]
    # Someone else in the section cannot write up a job allocated to this technician.
    assert client.post(f"/api/v1/faults/{fault}/visits", headers=headers("pt-electrical"), json={
        "on_site_at": iso(on_site), "found": "x", "attempts": [{"action": "y", "result": "worked"}],
    }).status_code == 409


def test_a_visit_written_up_offline_syncs_through_the_same_rules():
    fault = allocated_electrical_job()
    technician = headers("st-electrical")
    assert client.post(f"/api/v1/faults/{fault}/action?action=acknowledge", headers=technician).status_code == 200
    now = datetime.now(timezone.utc)
    result = client.post("/api/v1/sync/events", headers=technician, json=[{
        "event_id": str(uuid.uuid4()), "fault_id": fault, "event_type": "VISIT_RECORDED",
        "device_id": "DEVICE-LAPTOP", "client_timestamp": iso(now), "sequence_number": 1,
        "payload": {
            "on_site_at": iso(now - timedelta(hours=1)), "back_in_service_at": iso(now - timedelta(minutes=20)),
            "found": "Supply fuse blown", "attempts": [{"action": "Replaced fuse F2", "result": "worked"}],
            "request_signoff": True,
        },
    }]).json()["results"][0]
    assert result["status"] == "APPLIED", result
    assert result["result"]["status"] == "RESTORED"
