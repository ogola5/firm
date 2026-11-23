from fastapi.testclient import TestClient
import uuid

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
    assert me.json()["role"] == "operations"
    equipment = client.get("/api/v1/equipment", headers=auth_headers(token))
    assert len(equipment.json()) >= 30
    faults = client.get("/api/v1/faults", headers=auth_headers(token))
    assert len(faults.json()) >= 100


def test_equipment_and_fault_reporting_permissions():
    operations_token = login("operations")
    equipment = client.get("/api/v1/equipment?search=PUMP", headers=auth_headers(operations_token)).json()
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

    executive_token = login("ceo")
    denied = client.post("/api/v1/faults", headers=auth_headers(executive_token), json={
        "equipment_id": equipment[0]["id"],
        "category": "Mechanical",
        "symptom": "Unexpected trip",
    })
    assert denied.status_code == 403


def test_triage_and_workflow():
    token = login("automation")
    faults = client.get("/api/v1/faults", headers=auth_headers(token)).json()
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
    token = login("electrical")
    payload = [{"event_id": event_id, "fault_id": "FAULT-DEMO", "event_type": "DIAGNOSIS_RECORDED", "actor_id": "USER-electrical", "client_timestamp": "2026-11-20T12:00:00Z", "payload": {"result": "test"}}]
    first = client.post("/api/v1/sync/events", headers=auth_headers(token), json=payload)
    second = client.post("/api/v1/sync/events", headers=auth_headers(token), json=payload)
    assert first.status_code == 200
    assert second.status_code == 200
    assert event_id in second.json()["duplicates"]


def test_analytics_and_repeat_intelligence():
    token = login("maintenance-manager")
    overview = client.get("/api/v1/analytics/overview", headers=auth_headers(token))
    assert overview.status_code == 200
    data = overview.json()
    assert data["total_faults"] >= 100
    assert data["data_type"].startswith("Illustrative")
    equipment = client.get("/api/v1/equipment", headers=auth_headers(token)).json()[0]
    intelligence = client.get(f"/api/v1/intelligence/equipment/{equipment['id']}", headers=auth_headers(token))
    assert intelligence.status_code == 200


def test_hr_and_executive_visibility_boundaries():
    hr = auth_headers(login("hr"))
    assert client.get("/api/v1/users", headers=hr).status_code == 200
    workforce = client.get("/api/v1/users/summary", headers=hr)
    assert workforce.status_code == 200
    assert workforce.json()["personal_details_included"] is False
    assert client.get("/api/v1/faults", headers=hr).status_code == 403
    assert client.get("/api/v1/equipment", headers=hr).status_code == 403

    gm = auth_headers(login("gm-om"))
    assert client.get("/api/v1/faults", headers=gm).status_code == 200
    assert client.get("/api/v1/users/summary", headers=gm).status_code == 200
    assert client.get("/api/v1/users", headers=gm).status_code == 403

    ceo = auth_headers(login("ceo"))
    overview = client.get("/api/v1/analytics/overview", headers=ceo)
    assert overview.status_code == 200
    assert overview.json()["view_level"] == "Executive summary"
    assert "by_section" not in overview.json()
    assert client.get("/api/v1/faults", headers=ceo).status_code == 403


def test_section_roles_are_scoped_and_admin_manages_users():
    electrical = auth_headers(login("st-electrical"))
    equipment = client.get("/api/v1/equipment", headers=electrical)
    assert equipment.status_code == 200
    assert equipment.json()
    assert all(item["section"] == "Electrical" for item in equipment.json())

    scoped_faults = client.get("/api/v1/faults", headers=electrical)
    assert scoped_faults.status_code == 200
    equipment_by_id = {item["id"]: item for item in equipment.json()}
    for fault in scoped_faults.json():
        assert fault["assigned_section"] == "Electrical" or fault["equipment_id"] in equipment_by_id
    section_fault_id = scoped_faults.json()[0]["id"]
    chief_tech = auth_headers(login("ct-electrical"))
    own_section = client.post(f"/api/v1/faults/{section_fault_id}/triage", headers=chief_tech, json={"assigned_section": "Electrical"})
    assert own_section.status_code == 200
    cross_section = client.post(f"/api/v1/faults/{section_fault_id}/triage", headers=chief_tech, json={"assigned_section": "Mechanical"})
    assert cross_section.status_code == 403
    junior_close = client.post(f"/api/v1/faults/{section_fault_id}/action?action=close", headers=electrical)
    assert junior_close.status_code == 403

    hr = auth_headers(login("hr"))
    assert client.post("/api/v1/users", headers=hr, json={
        "username": "not-allowed",
        "display_name": "Not Allowed",
        "role": "technician_st",
        "section": "Electrical",
        "password": "prototype123",
    }).status_code == 403

    admin = auth_headers(login("admin"))
    roles = client.get("/api/v1/access/roles", headers=admin)
    assert roles.status_code == 200
    assert any(role["code"] == "technician_ct" for role in roles.json())
    username = f"test-user-{uuid.uuid4().hex[:8]}"
    created = client.post("/api/v1/users", headers=admin, json={
        "username": username,
        "display_name": "Synthetic Test Engineer",
        "role": "assistant_engineer",
        "section": "Instrumentation",
        "password": "prototype123",
    })
    assert created.status_code == 201
    assert created.json()["section"] == "Instrumentation"
    audit = client.get("/api/v1/users/audit", headers=admin)
    assert audit.status_code == 200
    assert any(item["action"] == "USER_CREATED" and item["target_user_id"] == created.json()["id"] for item in audit.json())

    pending = client.get("/api/v1/knowledge?status_filter=SUBMITTED", headers=admin).json()
    assert pending
    no_approval = client.post(
        f"/api/v1/knowledge/{pending[0]['id']}/status?target_status=APPROVED",
        headers=admin,
    )
    assert no_approval.status_code == 403


def test_seniority_grants_progressively_higher_fault_actions():
    operations = auth_headers(login("operations"))
    electrical_assets = client.get("/api/v1/equipment", headers=operations).json()
    asset = next(item for item in electrical_assets if item["section"] == "Electrical")
    reported = client.post("/api/v1/faults", headers=operations, json={
        "equipment_id": asset["id"],
        "category": "Electrical",
        "symptom": "Synthetic tier test",
        "description": "Synthetic permission test",
    })
    assert reported.status_code == 200
    fault_id = reported.json()["id"]

    engineer = auth_headers(login("engineer-electrical"))
    denied_restore = client.post(f"/api/v1/faults/{fault_id}/action?action=restore", headers=engineer)
    assert denied_restore.status_code == 403

    senior_engineer = auth_headers(login("senior-engineer-electrical"))
    restored = client.post(f"/api/v1/faults/{fault_id}/action?action=restore", headers=senior_engineer)
    assert restored.status_code == 200

    chief_engineer = auth_headers(login("chief-engineer-electrical"))
    closed = client.post(f"/api/v1/faults/{fault_id}/action?action=close", headers=chief_engineer)
    assert closed.status_code == 200


def test_investigation_review_revision_reuse_and_appraisal_cycle():
    operations = auth_headers(login("operations"))
    equipment = client.get("/api/v1/equipment", headers=operations).json()
    asset = next(item for item in equipment if item["section"] == "Electrical")
    report = client.post("/api/v1/faults", headers=operations, json={
        "equipment_id": asset["id"],
        "category": "Electrical",
        "symptom": "Appraisal workflow test",
        "severity": "High",
        "description": "Synthetic end-to-end work-procedure test",
    })
    assert report.status_code == 200
    fault_id = report.json()["id"]

    automation = auth_headers(login("automation"))
    assert client.post(f"/api/v1/faults/{fault_id}/triage", headers=automation, json={
        "assigned_section": "Electrical",
        "triage_comment": "Route to the equipment-owning section",
    }).status_code == 200

    principal = auth_headers(login("pt-electrical"))
    principal_user = client.get("/api/v1/auth/me", headers=principal).json()
    assert client.post(f"/api/v1/faults/{fault_id}/action?action=acknowledge", headers=principal).status_code == 200
    diagnosis = client.post(f"/api/v1/faults/{fault_id}/diagnoses", headers=principal, json={
        "possible_cause": "Loose connector",
        "diagnostic_method": "Compare event log with isolated continuity test",
        "observations": "Intermittent signal loss recorded",
        "test_results": "Signal stable after corrective work",
        "confidence": 0.8,
    })
    assert diagnosis.status_code == 200
    diagnosis_id = diagnosis.json()["id"]
    failed = client.post(f"/api/v1/faults/{fault_id}/interventions", headers=principal, json={
        "diagnosis_id": diagnosis_id,
        "corrective_action": "Initial adjustment did not remove the symptom",
        "outcome": "FAILED",
    })
    assert failed.status_code == 200
    successful = client.post(f"/api/v1/faults/{fault_id}/interventions", headers=principal, json={
        "diagnosis_id": diagnosis_id,
        "corrective_action": "Correct connector seating and verify stable signal",
        "outcome": "SUCCESS",
    })
    assert successful.status_code == 200
    assert client.post(f"/api/v1/faults/{fault_id}/action?action=restore", headers=principal).status_code == 200

    procedure = {
        "title": "Check intermittent connector signal",
        "observed_symptom": "Appraisal workflow test",
        "confirmed_cause": "Loose connector",
        "diagnostic_procedure": "Inspect the event log and record the approved continuity check result",
        "corrective_action": "Correct connector seating and verify stable signal",
        "safety": "Follow isolation and permit requirements",
    }
    submitted = client.post(f"/api/v1/faults/{fault_id}/procedure-updates", headers=principal, json=procedure)
    assert submitted.status_code == 200
    update_id = submitted.json()["id"]

    chief = auth_headers(login("ct-electrical"))
    clarification = client.post(f"/api/v1/procedure-updates/{update_id}/review", headers=chief, json={
        "decision": "REQUEST_CLARIFICATION",
        "comments": "Add the measured post-repair verification result",
    })
    assert clarification.status_code == 200
    assert clarification.json()["status"] == "CLARIFICATION_REQUESTED"
    revision = client.post(f"/api/v1/procedure-updates/{update_id}/revisions", headers=principal, json={
        **procedure,
        "diagnostic_procedure": "Inspect the event log, record the continuity value, and compare the post-repair value",
    })
    assert revision.status_code == 200
    assert revision.json()["version"] == 2
    revision_id = revision.json()["id"]
    approved_technically = client.post(f"/api/v1/procedure-updates/{revision_id}/review", headers=chief, json={
        "decision": "APPROVE",
        "comments": "Verification is documented",
    })
    assert approved_technically.status_code == 200
    assert approved_technically.json()["status"] == "CHIEF_APPROVED"
    supervisor = auth_headers(login("supervisor"))
    published = client.post(f"/api/v1/procedure-updates/{revision_id}/review", headers=supervisor, json={
        "decision": "APPROVE",
        "comments": "Published after technical review",
    })
    assert published.status_code == 200
    assert published.json()["status"] == "APPROVED"
    context = client.get(f"/api/v1/faults/{fault_id}/context", headers=principal)
    assert context.status_code == 200
    assert {item["status"] for item in context.json()["procedure_updates"]} == {"CLARIFICATION_REQUESTED", "APPROVED"}
    assert any(item["outcome"] == "FAILED" for item in context.json()["interventions"])

    second_report = client.post("/api/v1/faults", headers=operations, json={
        "equipment_id": asset["id"],
        "category": "Electrical",
        "symptom": "Repeat appraisal workflow test",
    })
    assert second_report.status_code == 200
    second_fault_id = second_report.json()["id"]
    assert client.post(f"/api/v1/faults/{second_fault_id}/triage", headers=automation, json={
        "assigned_section": "Electrical",
    }).status_code == 200
    technician = auth_headers(login("st-electrical"))
    reuse = client.post(f"/api/v1/faults/{second_fault_id}/procedure-reuse", headers=technician, json={
        "procedure_update_id": revision_id,
    })
    assert reuse.status_code == 200
    assert client.post(f"/api/v1/faults/{second_fault_id}/action?action=restore", headers=principal).status_code == 200
    confirmed = client.post(f"/api/v1/procedure-reuse/{reuse.json()['id']}/outcome", headers=technician, json={
        "outcome": "SUCCESS",
        "comments": "The check guided a verified restoration",
    })
    assert confirmed.status_code == 200
    assert client.post(f"/api/v1/procedure-reuse/{reuse.json()['id']}/outcome", headers=technician, json={
        "outcome": "SUCCESS",
    }).status_code == 409

    hr = auth_headers(login("hr"))
    appraisal = client.get("/api/v1/hr/appraisal", headers=hr)
    assert appraisal.status_code == 200
    principal_row = next(row for row in appraisal.json()["rows"] if row["employee_id"] == principal_user["id"])
    assert principal_row["procedure_updates_approved"] >= 1
    assert principal_row["colleague_reuses"] >= 1
    assert principal_row["failed_interventions"] >= 1
    assert client.get(f"/api/v1/faults/{fault_id}/context", headers=hr).status_code == 403

    gm = auth_headers(login("gm-om"))
    workflow = client.get("/api/v1/analytics/overview", headers=gm).json()["workflow"]
    assert workflow["stages"]["restored"] >= 1
    assert workflow["operations_reported_faults"] >= 1
    assert "handoffs_by_section" in workflow
    ceo = client.get("/api/v1/analytics/overview", headers=auth_headers(login("ceo"))).json()
    assert "workflow" not in ceo


def test_technical_review_is_section_scoped_and_publication_requires_chief_review():
    principal = auth_headers(login("pt-electrical"))
    equipment = client.get("/api/v1/equipment", headers=principal).json()[0]
    fault = client.post("/api/v1/faults", headers=principal, json={
        "equipment_id": equipment["id"],
        "category": equipment["category"],
        "symptom": "Review permission test",
    }).json()
    automation = auth_headers(login("automation"))
    client.post(f"/api/v1/faults/{fault['id']}/triage", headers=automation, json={"assigned_section": "Electrical"})
    client.post(f"/api/v1/faults/{fault['id']}/interventions", headers=principal, json={
        "corrective_action": "Test action",
        "outcome": "SUCCESS",
    })
    client.post(f"/api/v1/faults/{fault['id']}/action?action=restore", headers=principal)
    submitted = client.post(f"/api/v1/faults/{fault['id']}/procedure-updates", headers=principal, json={
        "title": "Review permission test",
        "observed_symptom": "Review permission test",
        "confirmed_cause": "Synthetic cause",
        "diagnostic_procedure": "Synthetic diagnostic check",
        "corrective_action": "Synthetic safe corrective action",
    }).json()
    assert client.post(f"/api/v1/procedure-updates/{submitted['id']}/review", headers=principal, json={
        "decision": "APPROVE",
    }).status_code == 403
    supervisor = auth_headers(login("supervisor"))
    premature = client.post(f"/api/v1/procedure-updates/{submitted['id']}/review", headers=supervisor, json={"decision": "APPROVE"})
    assert premature.status_code == 409
    other_section_chief = auth_headers(login("ct-mechanical"))
    assert client.post(f"/api/v1/procedure-updates/{submitted['id']}/review", headers=other_section_chief, json={
        "decision": "APPROVE",
    }).status_code == 404
    assert client.get("/api/v1/hr/appraisal", headers=auth_headers(login("gm-om"))).status_code == 403


def test_legacy_work_instructions_are_separate_from_fault_procedures():
    principal = auth_headers(login("pt-electrical"))
    created = client.post("/api/v1/knowledge", headers=principal, json={
        "title": "Legacy test bench startup",
        "symptom": "How to use the existing test bench",
        "confirmed_cause": "Existing equipment/tool operating instruction",
        "diagnostic_procedure": "Check indicators against the legacy normal range",
        "corrective_action": "Follow the operating sequence",
        "safety": "Use the current isolation procedure",
        "source_type": "LEGACY_PROCEDURE",
        "instruction_type": "Legacy operating work instruction",
        "usage_scope": "Test bench TB-01",
        "legacy_reference": "LEGACY-MANUAL-001",
        "step_by_step": "1. Verify permit.\n2. Inspect leads.\n3. Energise safely.\n4. Record readings.\n5. Return to safe state.",
    })
    assert created.status_code == 200
    assert created.json()["status"] == "SUBMITTED"
    approved = client.post(
        f"/api/v1/knowledge/{created.json()['id']}/status?target_status=APPROVED",
        headers=auth_headers(login("supervisor")),
    )
    assert approved.status_code == 200
    entries = client.get("/api/v1/knowledge?source_type=LEGACY_PROCEDURE", headers=principal)
    assert entries.status_code == 200
    assert any(item["legacy_reference"] == "LEGACY-MANUAL-001" for item in entries.json())

    seeded = client.get("/api/v1/knowledge?source_type=LEGACY_PROCEDURE", headers=principal).json()
    legacy = next(item for item in seeded if item["status"] == "APPROVED")
    assert legacy["step_by_step"]
    assert legacy["usage_scope"]


def test_repeat_fault_ranking_recognition_and_sap_status():
    operations = auth_headers(login("operations"))
    electrical_asset = next(
        item for item in client.get("/api/v1/equipment", headers=operations).json()
        if item["section"] == "Electrical"
    )
    first = client.post("/api/v1/faults", headers=operations, json={
        "equipment_id": electrical_asset["id"],
        "category": "Electrical",
        "symptom": "Repeat routing ranked cause test",
        "severity": "High",
    })
    assert first.status_code == 200
    first_id = first.json()["id"]

    principal = auth_headers(login("pt-electrical"))
    diagnosis = client.post(f"/api/v1/faults/{first_id}/diagnoses", headers=principal, json={
        "possible_cause": "Loose cable or terminal",
        "diagnostic_method": "Quick continuity and visual check",
        "quick_check": "Wiggle test",
        "fix_summary": "Re-terminate the affected conductor",
        "workaround": False,
        "risk_level": "Normal",
    })
    assert diagnosis.status_code == 200
    assert client.post(f"/api/v1/faults/{first_id}/interventions", headers=principal, json={
        "diagnosis_id": diagnosis.json()["id"],
        "corrective_action": "Re-terminate terminal",
        "outcome": "SUCCESS",
    }).status_code == 200
    assert client.post(f"/api/v1/faults/{first_id}/action?action=restore", headers=principal).status_code == 200

    repeat = client.post("/api/v1/faults", headers=operations, json={
        "equipment_id": electrical_asset["id"],
        "category": "Electrical",
        "symptom": "Repeat routing ranked cause test",
        "severity": "High",
    })
    assert repeat.status_code == 200
    assert repeat.json()["repeat_fault"] is True
    assert repeat.json()["triage_skipped"] is True
    assert repeat.json()["assigned_section"] == "Electrical"

    context = client.get(f"/api/v1/faults/{repeat.json()['id']}/context", headers=principal)
    assert context.status_code == 200
    repeat_context = context.json()
    assert repeat_context["repeat_routing"]["seen_before"] is True
    assert repeat_context["repeat_routing"]["triage_action"] == "DIRECT_TO_SECTION"
    assert any(cause["possible_cause"] == "Loose cable or terminal" for cause in repeat_context["ranked_causes"])

    gm = auth_headers(login("gm-om"))
    overview = client.get("/api/v1/analytics/overview", headers=gm)
    assert overview.status_code == 200
    workflow = overview.json()["workflow"]
    assert "critical_window_minutes" in workflow
    assert "resolution_comparison" in workflow
    assert workflow["resolution_comparison"]["repeat_target_reduction_percent"] == 60

    recognition = client.get("/api/v1/recognition/leaderboard", headers=gm)
    assert recognition.status_code == 200
    assert recognition.json()["platform"] == "SOCA-compatible recognition model"
    assert recognition.json()["integration_status"].startswith("Illustrative")

    sap = client.get("/api/v1/integrations/sap/status", headers=gm)
    assert sap.status_code == 200
    assert sap.json()["mode"] == "Read-only planned; write-back disabled"
    assert sap.json()["blocked_actions"]
