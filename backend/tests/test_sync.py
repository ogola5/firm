"""Offline event synchronisation: application, idempotency, conflicts, permissions."""
import json
import uuid

from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def headers(username: str) -> dict:
    response = client.post("/api/v1/auth/login", json={"email": f"demo.{username}@kpc.co.ke", "password": "demo123"})
    assert response.status_code == 200
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


def me(auth: dict) -> dict:
    return client.get("/api/v1/auth/me", headers=auth).json()


def event(event_type: str, fault_id: str | None, sequence: int, payload: dict, **extra) -> dict:
    return {
        "event_id": str(uuid.uuid4()),
        "fault_id": fault_id,
        "event_type": event_type,
        "device_id": "DEVICE-TEST-01",
        "client_timestamp": f"2026-11-24T08:{sequence:02d}:00Z",
        "sequence_number": sequence,
        "payload": payload,
        **extra,
    }


def electrical_asset(auth: dict) -> dict:
    return next(item for item in client.get("/api/v1/equipment", headers=auth).json() if item["section"] == "Electrical")


def report_online(auth: dict, symptom: str) -> str:
    response = client.post("/api/v1/faults", headers=auth, json={
        "equipment_id": electrical_asset(auth)["id"],
        "symptom": symptom,
        "operational_impact": "Synthetic test impact",
    })
    assert response.status_code == 200
    return response.json()["id"]


def test_offline_lifecycle_is_applied_once_and_timeline_keeps_device_time():
    operations = headers("operations")
    fault_id = str(uuid.uuid4())
    report = event("FAULT_REPORTED", fault_id, 1, {
        "equipment_id": electrical_asset(operations)["id"],
        "symptom": "Offline-reported actuator fault",
        "operational_impact": "Transfer delayed (synthetic)",
    })
    first = client.post("/api/v1/sync/events", headers=operations, json=[report])
    assert first.status_code == 200
    assert first.json()["results"][0]["status"] == "APPLIED"
    assert first.json()["results"][0]["result"]["id"] == fault_id
    assert first.json()["results"][0]["result"]["reference"].startswith("KPC-DMO-")

    automation = headers("automation")
    diagnosis_id = str(uuid.uuid4())
    investigation = [
        event("FAULT_ACTION", fault_id, 1, {"action": "acknowledge"}, base_status="ASSIGNED"),
        event("DIAGNOSIS_RECORDED", fault_id, 2, {
            "diagnosis_id": diagnosis_id,
            "possible_cause": "Loose actuator supply terminal",
            "diagnostic_method": "Visual inspection and continuity test",
        }),
        event("INTERVENTION_RECORDED", fault_id, 3, {
            "diagnosis_id": diagnosis_id, "corrective_action": "Reseated connector", "outcome": "FAILED",
        }),
        event("INTERVENTION_RECORDED", fault_id, 4, {
            "diagnosis_id": diagnosis_id, "corrective_action": "Replaced terminal block", "outcome": "SUCCESS",
        }),
    ]
    # Send out of order: the server must apply them in sequence order.
    applied = client.post("/api/v1/sync/events", headers=automation, json=list(reversed(investigation)))
    assert applied.status_code == 200
    assert [item["status"] for item in applied.json()["results"]] == ["APPLIED"] * 4
    assert applied.json()["counts"]["APPLIED"] == 4

    again = client.post("/api/v1/sync/events", headers=automation, json=investigation)
    assert again.json()["counts"] == {"APPLIED": 0, "CONFLICT": 0, "REJECTED": 0, "DUPLICATE": 4}
    assert [item["stored_status"] for item in again.json()["results"]] == ["APPLIED"] * 4

    context = client.get(f"/api/v1/faults/{fault_id}/context", headers=automation)
    assert context.status_code == 200
    timeline = client.get(f"/api/v1/faults/{fault_id}/timeline", headers=automation).json()
    failed = [item for item in timeline if item["event_type"] == "INTERVENTION_FAILED"]
    succeeded = [item for item in timeline if item["event_type"] == "INTERVENTION_SUCCESS"]
    assert len(failed) == 1 and len(succeeded) == 1, "both attempts are kept exactly once"
    reported = next(item for item in timeline if item["event_type"] == "FAULT_REPORTED")
    payload = json.loads(reported["payload"]) if isinstance(reported["payload"], str) else reported["payload"]
    assert payload["offline"]["device_id"] == "DEVICE-TEST-01"
    assert payload["offline"]["client_timestamp"] == "2026-11-24T08:01:00Z"
    assert payload["offline"]["received_at"]


def test_concurrent_offline_edits_are_held_for_reconciliation():
    operations = headers("operations")
    fault_id = report_online(operations, "Concurrent offline acknowledgement test")

    # A supervisor takes the job while the Systems Automation device is offline.
    supervisor = headers("supervisor")
    assert client.post(f"/api/v1/faults/{fault_id}/action?action=acknowledge", headers=supervisor).status_code == 200

    automation = headers("automation")
    stale_ack = event("FAULT_ACTION", fault_id, 1, {"action": "acknowledge"}, base_status="ASSIGNED")
    later_note = event("DIAGNOSIS_RECORDED", fault_id, 2, {
        "possible_cause": "Comms card fault", "diagnostic_method": "Loopback test",
    })
    response = client.post("/api/v1/sync/events", headers=automation, json=[stale_ack, later_note]).json()
    statuses = {item["event_id"]: item for item in response["results"]}
    assert statuses[stale_ack["event_id"]]["status"] == "CONFLICT"
    assert "while this device was offline" in statuses[stale_ack["event_id"]]["detail"]
    assert statuses[later_note["event_id"]]["status"] == "CONFLICT"
    assert "Held behind" in statuses[later_note["event_id"]]["detail"]

    # Nothing was silently overwritten.
    fault = client.get(f"/api/v1/faults/{fault_id}", headers=supervisor).json()
    assert fault["assigned_user_id"] == me(supervisor)["id"]

    conflicts = client.get("/api/v1/sync/conflicts", headers=automation).json()
    assert {stale_ack["event_id"], later_note["event_id"]} <= {item["event_id"] for item in conflicts}
    assert any(item["event_id"] == stale_ack["event_id"] for item in client.get("/api/v1/sync/conflicts", headers=supervisor).json())
    assert not any(item["event_id"] == stale_ack["event_id"] for item in client.get("/api/v1/sync/conflicts", headers=operations).json())

    # Re-applying still fails because the job belongs to the supervisor; it stays open.
    retry = client.post(f"/api/v1/sync/conflicts/{stale_ack['event_id']}/resolve", headers=automation, json={"decision": "APPLY"})
    assert retry.status_code == 409
    assert "owned by another employee" in retry.json()["detail"]

    assert client.post(
        f"/api/v1/sync/conflicts/{stale_ack['event_id']}/resolve", headers=automation, json={"decision": "DISCARD"},
    ).status_code == 422
    discarded = client.post(
        f"/api/v1/sync/conflicts/{stale_ack['event_id']}/resolve", headers=supervisor,
        json={"decision": "DISCARD", "note": "Supervisor already took the job"},
    )
    assert discarded.status_code == 200
    assert discarded.json()["status"] == "RESOLVED_DISCARDED"
    assert discarded.json()["resolved_by_id"] == me(supervisor)["id"]
    timeline = client.get(f"/api/v1/faults/{fault_id}/timeline", headers=supervisor).json()
    assert any(item["event_type"] == "SYNC_CONFLICT_RESOLVED" for item in timeline)
    assert client.post(
        f"/api/v1/sync/conflicts/{stale_ack['event_id']}/resolve", headers=supervisor, json={"decision": "APPLY"},
    ).status_code == 409


def test_resolving_a_stale_action_can_apply_it_when_still_permitted():
    operations = headers("operations")
    fault_id = report_online(operations, "Stale base status but still permitted")
    automation = headers("automation")
    assert client.post(f"/api/v1/faults/{fault_id}/action?action=acknowledge", headers=automation).status_code == 200
    # The device believed the fault was still ASSIGNED; the server says ACKNOWLEDGED.
    stale_on_site = event("FAULT_ACTION", fault_id, 1, {"action": "on_site"}, base_status="ASSIGNED")
    result = client.post("/api/v1/sync/events", headers=automation, json=[stale_on_site]).json()["results"][0]
    assert result["status"] == "CONFLICT"
    resolved = client.post(
        f"/api/v1/sync/conflicts/{stale_on_site['event_id']}/resolve", headers=automation,
        json={"decision": "APPLY", "note": "Confirmed I was on site"},
    )
    assert resolved.status_code == 200
    assert resolved.json()["status"] == "RESOLVED_APPLIED"
    assert client.get(f"/api/v1/faults/{fault_id}", headers=automation).json()["status"] == "ON_SITE"


def test_offline_events_cannot_bypass_permissions():
    operations = headers("operations")
    fault_id = report_online(operations, "Offline permission test")
    batch = [
        event("FAULT_ACTION", fault_id, 1, {"action": "acknowledge"}),
        event("OPERATOR_UPDATE", fault_id, 2, {"note": "Pressure still low"}, actor_id="USER-supervisor"),
        event("KNOWLEDGE_APPROVED", fault_id, 3, {}),
        event("FAULT_REPORTED", "not-a-uuid", 4, {"symptom": "x", "operational_impact": "y", "equipment_id": None, "equipment_confirmed": False, "reported_location": "PS01"}),
    ]
    results = client.post("/api/v1/sync/events", headers=operations, json=batch).json()["results"]
    assert [(item["status"], item["status_code"]) for item in results] == [
        ("REJECTED", 403), ("REJECTED", 403), ("REJECTED", 422), ("REJECTED", 422),
    ]
    assert client.get("/api/v1/sync/events", headers=operations).status_code == 405

    history = client.get("/api/v1/sync/history", headers=operations).json()
    assert history[0]["rejected"] == 4
    assert len(history[0]["events"]) == 4
    summary = client.get("/api/v1/sync/status", headers=operations).json()
    assert summary["mine"]["REJECTED"] >= 4
