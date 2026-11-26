from fastapi.testclient import TestClient
import uuid

from app.main import app


client = TestClient(app)


def login(username="operations"):
    response = client.post("/api/v1/auth/login", json={"email": f"demo.{username}@kpc.co.ke", "password": "demo123"})
    assert response.status_code == 200
    return response.json()["access_token"]


def auth_headers(token):
    return {"Authorization": f"Bearer {token}"}


def handoff_from_automation(fault_id, next_section):
    automation = auth_headers(login("automation"))
    acknowledged = client.post(
        f"/api/v1/faults/{fault_id}/action?action=acknowledge",
        headers=automation,
    )
    assert acknowledged.status_code == 200
    requested = client.post(
        f"/api/v1/faults/{fault_id}/assignments/escalate",
        headers=automation,
        json={
            "next_section": next_section,
            "findings": "Systems Automation recorded the communication and control checks.",
            "recommendation": f"Continue physical troubleshooting in {next_section}.",
        },
    )
    if requested.status_code != 200:
        return requested
    return review_section_assignment(
        fault_id,
        "Systems Automation",
        requested.json()["assignment_id"],
        "APPROVE_ESCALATION",
    )


def review_section_assignment(fault_id, section, assignment_id, decision, comments=""):
    chief = auth_headers(login(f"ct-{section.lower().replace(' ', '-')}"))
    return client.post(
        f"/api/v1/faults/{fault_id}/assignments/{assignment_id}/review",
        headers=chief,
        json={"decision": decision, "comments": comments},
    )


def review_current_assignment(fault_id, section, decision, comments=""):
    chief = auth_headers(login(f"ct-{section.lower().replace(' ', '-')}"))
    context = client.get(f"/api/v1/faults/{fault_id}/context", headers=chief)
    assert context.status_code == 200
    assignment = next(item for item in context.json()["assignments"] if item["is_active"])
    return review_section_assignment(fault_id, section, assignment["id"], decision, comments)


def allocate_current_assignment(fault_id, section, technician_username):
    chief = auth_headers(login(f"ct-{section.lower().replace(' ', '-')}"))
    technician = auth_headers(login(technician_username))
    technician_id = client.get("/api/v1/auth/me", headers=technician).json()["id"]
    context = client.get(f"/api/v1/faults/{fault_id}/context", headers=chief)
    assert context.status_code == 200
    assignment = next(item for item in context.json()["assignments"] if item["is_active"])
    return client.post(
        f"/api/v1/faults/{fault_id}/assignments/{assignment['id']}/allocate",
        headers=chief,
        json={
            "assigned_user_id": technician_id,
            "severity": "High",
            "instructions": "Review inherited findings and record the tests performed.",
        },
    )


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
        "operational_impact": "Test production effect",
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


def test_descriptive_asset_search_and_unknown_asset_confirmation():
    operations = auth_headers(login("operations"))
    candidates = client.get("/api/v1/equipment?search=PUMP", headers=operations).json()
    assert candidates
    assert any("PUMP" in item["tag"] for item in candidates)

    report = client.post("/api/v1/faults", headers=operations, json={
        "reported_equipment_text": "11-TK-601 inlet valve is not opening",
        "reported_location": "Tank farm, near 11-TK-601",
        "symptom": "Inlet valve is not opening",
        "operational_impact": "Tank filling is delayed",
    })
    assert report.status_code == 200
    result = report.json()
    assert result["asset_confirmation_required"] is True
    assert result["triage_skipped"] is False
    fault_id = result["id"]

    detail = client.get(f"/api/v1/faults/{fault_id}", headers=operations).json()
    assert detail["equipment_confirmed"] is False
    assert detail["equipment_tag"] == "11-TK-601 inlet valve is not opening"
    assert detail["reported_location"] == "Tank farm, near 11-TK-601"
    premature_work = client.post(
        f"/api/v1/faults/{fault_id}/action?action=acknowledge",
        headers=auth_headers(login("st-systems-automation")),
    )
    assert premature_work.status_code == 409

    candidate = next(item for item in candidates if item["region"] == "Nairobi")
    uncertain_candidate_report = client.post("/api/v1/faults", headers=operations, json={
        "equipment_id": candidate["id"],
        "equipment_confirmed": False,
        "reported_equipment_text": "The valve near the tank is not opening",
        "reported_location": "Tank farm",
        "symptom": "Valve will not open",
        "operational_impact": "Tank filling is delayed",
    })
    assert uncertain_candidate_report.status_code == 200
    uncertain_candidate = client.get(
        f"/api/v1/faults/{uncertain_candidate_report.json()['id']}",
        headers=operations,
    ).json()
    assert uncertain_candidate["equipment_confirmed"] is False
    assert uncertain_candidate["equipment_id"] != candidate["id"]

    triaged = client.post(f"/api/v1/faults/{fault_id}/triage", headers=auth_headers(login("automation")), json={
        "assigned_section": "Systems Automation",
        "confirmed_equipment_id": candidate["id"],
        "triage_comment": "Physical equipment confirmed by standby.",
    })
    assert triaged.status_code == 200
    confirmed = client.get(f"/api/v1/faults/{fault_id}", headers=operations).json()
    assert confirmed["equipment_confirmed"] is True
    assert confirmed["equipment_id"] == candidate["id"]
    assert confirmed["assigned_section"] == "Systems Automation"
    handed_off = handoff_from_automation(fault_id, candidate["section"])
    assert handed_off.status_code == 200
    assert handed_off.json()["assigned_section"] == candidate["section"]


def test_technician_can_claim_section_job():
    technician = auth_headers(login("st-electrical"))
    equipment = client.get("/api/v1/equipment", headers=technician).json()[0]
    report = client.post("/api/v1/faults", headers=technician, json={
        "equipment_id": equipment["id"],
        "equipment_confirmed": True,
        "symptom": "Test technician ownership",
        "operational_impact": "Test impact",
    })
    assert report.status_code == 200
    fault_id = report.json()["id"]

    handoff = handoff_from_automation(fault_id, "Electrical")
    assert handoff.status_code == 200
    assert client.post(f"/api/v1/faults/{fault_id}/action?action=acknowledge", headers=technician).status_code == 409
    assert allocate_current_assignment(fault_id, "Electrical", "st-electrical").status_code == 200
    claim = client.post(f"/api/v1/faults/{fault_id}/action?action=acknowledge", headers=technician)
    assert claim.status_code == 200
    mine = client.get("/api/v1/faults?queue=mine", headers=technician).json()
    section_open = client.get("/api/v1/faults?queue=section_open", headers=technician).json()
    assert any(item["id"] == fault_id for item in mine)
    assert any(item["id"] == fault_id for item in section_open)


def test_chief_controls_section_allocation_and_unavailable_technicians():
    operations = auth_headers(login("operations"))
    asset = next(
        item for item in client.get("/api/v1/equipment", headers=operations).json()
        if item.get("region") in ("Nairobi", "") and item["section"] == "Electrical"
    )
    report = client.post("/api/v1/faults", headers=operations, json={
        "equipment_id": asset["id"],
        "symptom": "Chief allocation workflow test",
        "operational_impact": "Test production effect",
    })
    fault_id = report.json()["id"]
    assert handoff_from_automation(fault_id, "Electrical").status_code == 200

    technician = auth_headers(login("st-electrical"))
    technician_id = client.get("/api/v1/auth/me", headers=technician).json()["id"]
    chief = auth_headers(login("ct-electrical"))
    team = client.get("/api/v1/chief/team", headers=chief)
    assert team.status_code == 200
    person = next(item for item in team.json() if item["id"] == technician_id)
    assert person["active"] is True
    assert person["availability_status"] == "AVAILABLE"
    initial_workload = person["active_workload"]
    competency_update = client.patch(
        f"/api/v1/chief/team/{technician_id}/competencies",
        headers=chief,
        json={"competencies": ["SCADA", "Actuator controls"]},
    )
    assert competency_update.status_code == 200
    assert competency_update.json()["competencies"] == ["SCADA", "Actuator controls"]

    context = client.get(f"/api/v1/faults/{fault_id}/context", headers=chief).json()
    assignment = next(item for item in context["assignments"] if item["is_active"])
    assignment_url = f"/api/v1/faults/{fault_id}/assignments/{assignment['id']}/allocate"
    allocation = {
        "assigned_user_id": technician_id,
        "severity": "Critical",
        "instructions": "Review the inherited evidence first.",
    }

    assert client.patch("/api/v1/me/availability", headers=technician, json={
        "availability_status": "UNAVAILABLE",
    }).status_code == 200
    assert client.post(assignment_url, headers=chief, json=allocation).status_code == 409
    assert client.patch("/api/v1/me/availability", headers=technician, json={
        "availability_status": "AVAILABLE",
    }).status_code == 200
    assert client.post(assignment_url, headers=auth_headers(login("pt-electrical")), json=allocation).status_code == 403
    assert client.post(assignment_url, headers=auth_headers(login("ct-mechanical")), json=allocation).status_code == 404

    allocated = client.post(assignment_url, headers=chief, json=allocation)
    assert allocated.status_code == 200
    assert allocated.json()["assigned_user_id"] == technician_id
    assert allocated.json()["priority"] == "Critical"
    chief_view = client.get("/api/v1/chief/workspace", headers=chief).json()
    assert next(item for item in chief_view["faults"] if item["id"] == fault_id)["assigned_user_id"] == technician_id
    refreshed_team = client.get("/api/v1/chief/team", headers=chief).json()
    assert next(item for item in refreshed_team if item["id"] == technician_id)["active_workload"] == initial_workload + 1


def test_chief_can_return_and_then_approve_an_escalation():
    operations = auth_headers(login("operations"))
    asset = next(
        item for item in client.get("/api/v1/equipment", headers=operations).json()
        if item.get("region") in ("Nairobi", "") and item["section"] == "Electrical"
    )
    report = client.post("/api/v1/faults", headers=operations, json={
        "equipment_id": asset["id"],
        "symptom": "Escalation clarification workflow test",
        "operational_impact": "Test production effect",
    })
    fault_id = report.json()["id"]
    automation = auth_headers(login("automation"))
    assert client.post(f"/api/v1/faults/{fault_id}/action?action=acknowledge", headers=automation).status_code == 200
    escalation = client.post(f"/api/v1/faults/{fault_id}/assignments/escalate", headers=automation, json={
        "next_section": "Electrical",
        "findings": "SCADA communication is available.",
        "recommendation": "Inspect the actuator supply.",
    })
    assert escalation.status_code == 200
    assignment_id = escalation.json()["assignment_id"]
    assert review_section_assignment(
        fault_id, "Systems Automation", assignment_id, "RETURN_ESCALATION",
    ).status_code == 422
    returned = review_section_assignment(
        fault_id,
        "Systems Automation",
        assignment_id,
        "RETURN_ESCALATION",
        "Add the actuator feedback test result before handoff.",
    )
    assert returned.status_code == 200
    assert returned.json()["status"] == "ACKNOWLEDGED"
    context = client.get(f"/api/v1/faults/{fault_id}/context", headers=automation).json()
    current = next(item for item in context["assignments"] if item["is_active"])
    assert current["section"] == "Systems Automation"
    assert current["escalation_status"] == "RETURNED"
    assert current["escalation_review_comments"]

    resubmitted = client.post(f"/api/v1/faults/{fault_id}/assignments/escalate", headers=automation, json={
        "next_section": "Electrical",
        "findings": "SCADA communication and actuator feedback checks are complete.",
        "recommendation": "Inspect the actuator supply.",
    })
    assert resubmitted.status_code == 200
    approved = review_section_assignment(
        fault_id, "Systems Automation", assignment_id, "APPROVE_ESCALATION",
    )
    assert approved.status_code == 200
    assert approved.json()["assigned_section"] == "Electrical"


def test_triage_and_workflow():
    chief = auth_headers(login("ct-electrical"))
    faults = client.get("/api/v1/faults", headers=chief).json()
    equipment = client.get("/api/v1/equipment", headers=chief).json()
    electrical_equipment = {item["id"] for item in equipment if item.get("region") in ("Nairobi", "") and item["section"] == "Electrical"}
    fault_id = next(
        item["id"] for item in faults
        if item["status"] not in ("RESTORED", "CLOSED")
        and item["active_assignment_id"]
        and not item["assigned_user_id"]
        and item["assigned_section"] == "Electrical"
        and item["equipment_id"] in electrical_equipment
    )
    triage = client.post(f"/api/v1/faults/{fault_id}/triage", headers=chief, json={
        "assigned_section": "Electrical",
        "triage_comment": "Test triage",
    })
    assert triage.status_code == 200
    assert allocate_current_assignment(fault_id, "Electrical", "electrical").status_code == 200
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
    # The reporter sees the repeat warning while filling in the report.
    operations = client.get(f"/api/v1/intelligence/equipment/{equipment['id']}", headers=auth_headers(login("operations")))
    assert operations.status_code == 200
    assert operations.json()["repeat_count"] == intelligence.json()["repeat_count"]
    assert client.get(f"/api/v1/intelligence/equipment/{equipment['id']}", headers=auth_headers(login("hr"))).status_code == 403


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
    section_fault_id = next(
        item["id"] for item in scoped_faults.json()
        if item["active_assignment_id"]
        and not item["assigned_user_id"]
        and item["equipment_id"] in equipment_by_id
        and item["assigned_section"] == "Electrical"
        and item["status"] not in ("RESTORED", "CLOSED")
    )
    chief_tech = auth_headers(login("ct-electrical"))
    own_section = client.post(f"/api/v1/faults/{section_fault_id}/triage", headers=chief_tech, json={"assigned_section": "Electrical"})
    assert own_section.status_code == 200
    cross_section = client.post(f"/api/v1/faults/{section_fault_id}/triage", headers=chief_tech, json={"assigned_section": "Mechanical"})
    assert cross_section.status_code == 403
    junior_close = client.post(f"/api/v1/faults/{section_fault_id}/action?action=close", headers=electrical)
    assert junior_close.status_code == 403

    hr = auth_headers(login("hr"))
    assert client.post("/api/v1/users", headers=hr, json={
        "email": "not.allowed@kpc.co.ke",
        "display_name": "Not Allowed",
        "role": "technician_st",
        "section": "Electrical",
        "password": "prototype123",
    }).status_code == 403

    admin = auth_headers(login("admin"))
    roles = client.get("/api/v1/access/roles", headers=admin)
    assert roles.status_code == 200
    assert any(role["code"] == "technician_ct" for role in roles.json())
    created = client.post("/api/v1/users", headers=admin, json={
        "email": f"test.user.{uuid.uuid4().hex[:8]}@kpc.co.ke",
        "display_name": "Synthetic Test Engineer",
        "role": "assistant_engineer",
        "section": "Instrumentation",
        "region": "Western",
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
    asset = next(item for item in electrical_assets if item.get("region") in ("Nairobi", "") and item["section"] == "Electrical")
    reported = client.post("/api/v1/faults", headers=operations, json={
        "equipment_id": asset["id"],
        "category": "Electrical",
        "symptom": "Synthetic tier test",
        "description": "Synthetic permission test",
        "operational_impact": "Test production effect",
    })
    assert reported.status_code == 200
    fault_id = reported.json()["id"]

    handoff = handoff_from_automation(fault_id, "Electrical")
    assert handoff.status_code == 200
    engineer = auth_headers(login("engineer-electrical"))
    denied_restore = client.post(f"/api/v1/faults/{fault_id}/action?action=restore", headers=engineer)
    assert denied_restore.status_code == 403

    senior_engineer = auth_headers(login("senior-engineer-electrical"))
    assert client.post(f"/api/v1/faults/{fault_id}/action?action=acknowledge", headers=senior_engineer).status_code == 200
    assert client.post(f"/api/v1/faults/{fault_id}/interventions", headers=senior_engineer, json={
        "corrective_action": "Synthetic successful restoration work",
        "outcome": "SUCCESS",
    }).status_code == 200
    restored = client.post(f"/api/v1/faults/{fault_id}/action?action=restore", headers=senior_engineer)
    assert restored.status_code == 200
    assert restored.json()["status"] == "AWAITING_CHIEF_REVIEW"
    approved_completion = review_current_assignment(fault_id, "Electrical", "APPROVE_COMPLETION")
    assert approved_completion.status_code == 200
    assert approved_completion.json()["status"] == "RESTORED"

    chief_engineer = auth_headers(login("chief-engineer-electrical"))
    closed = client.post(f"/api/v1/faults/{fault_id}/action?action=close", headers=chief_engineer)
    assert closed.status_code == 409
    confirmed = client.post(f"/api/v1/faults/{fault_id}/operator-confirmation", headers=operations, json={
        "confirmed": True,
        "comments": "Operations verified stable service.",
    })
    assert confirmed.status_code == 200
    assert confirmed.json()["status"] == "CLOSED"


def test_investigation_review_revision_reuse_and_appraisal_cycle():
    operations = auth_headers(login("operations"))
    equipment = client.get("/api/v1/equipment", headers=operations).json()
    asset = next(item for item in equipment if item.get("region") in ("Nairobi", "") and item["section"] == "Electrical")
    report = client.post("/api/v1/faults", headers=operations, json={
        "equipment_id": asset["id"],
        "category": "Electrical",
        "symptom": "Appraisal workflow test",
        "severity": "High",
        "description": "Synthetic end-to-end work-procedure test",
        "operational_impact": "Test production effect",
    })
    assert report.status_code == 200
    fault_id = report.json()["id"]

    handoff = handoff_from_automation(fault_id, "Electrical")
    assert handoff.status_code == 200

    principal = auth_headers(login("pt-electrical"))
    assert allocate_current_assignment(fault_id, "Electrical", "pt-electrical").status_code == 200
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
    requested_completion = client.post(f"/api/v1/faults/{fault_id}/action?action=restore", headers=principal)
    assert requested_completion.status_code == 200
    assert requested_completion.json()["status"] == "AWAITING_CHIEF_REVIEW"
    assert review_current_assignment(fault_id, "Electrical", "APPROVE_COMPLETION").status_code == 200
    assert client.post(f"/api/v1/faults/{fault_id}/operator-confirmation", headers=operations, json={
        "confirmed": True,
        "comments": "Operations confirmed stable service.",
    }).status_code == 200

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
        "change_reason": "Added the measured continuity value, as the chief asked",
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
        "operational_impact": "Test production effect",
    })
    assert second_report.status_code == 200
    second_fault_id = second_report.json()["id"]
    assert handoff_from_automation(second_fault_id, "Electrical").status_code == 200
    assert allocate_current_assignment(second_fault_id, "Electrical", "pt-electrical").status_code == 200
    technician = auth_headers(login("st-electrical"))
    reuse = client.post(f"/api/v1/faults/{second_fault_id}/procedure-reuse", headers=technician, json={
        "procedure_update_id": revision_id,
    })
    assert reuse.status_code == 200
    assert client.post(f"/api/v1/faults/{second_fault_id}/action?action=acknowledge", headers=principal).status_code == 200
    assert client.post(f"/api/v1/faults/{second_fault_id}/interventions", headers=principal, json={
        "corrective_action": "Synthetic successful repeated-fault restoration",
        "outcome": "SUCCESS",
    }).status_code == 200
    assert client.post(f"/api/v1/faults/{second_fault_id}/action?action=restore", headers=principal).status_code == 200
    assert review_current_assignment(second_fault_id, "Electrical", "APPROVE_COMPLETION").status_code == 200
    assert client.post(f"/api/v1/faults/{second_fault_id}/operator-confirmation", headers=operations, json={
        "confirmed": True,
    }).status_code == 200
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
        "operational_impact": "Test production effect",
    }).json()
    assert handoff_from_automation(fault["id"], "Electrical").status_code == 200
    assert allocate_current_assignment(fault["id"], "Electrical", "pt-electrical").status_code == 200
    assert client.post(f"/api/v1/faults/{fault['id']}/action?action=acknowledge", headers=principal).status_code == 200
    client.post(f"/api/v1/faults/{fault['id']}/interventions", headers=principal, json={
        "corrective_action": "Test action",
        "outcome": "SUCCESS",
    })
    assert client.post(f"/api/v1/faults/{fault['id']}/action?action=restore", headers=principal).status_code == 200
    assert review_current_assignment(fault["id"], "Electrical", "APPROVE_COMPLETION").status_code == 200
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


def test_sa_to_electrical_to_mechanical_handoffs_operator_confirmation_and_evidence(tmp_path, monkeypatch):
    monkeypatch.setattr("app.services.storage.attachment_storage.root", tmp_path)
    operations = auth_headers(login("operations"))
    electrical_asset = next(
        item for item in client.get("/api/v1/equipment", headers=operations).json()
        if item.get("region") in ("Nairobi", "") and item["section"] == "Electrical"
    )
    reported = client.post("/api/v1/faults", headers=operations, json={
        "equipment_id": electrical_asset["id"],
        "equipment_confirmed": True,
        "reported_equipment_text": "Pumpover boundary valve not responding to OPEN",
        "reported_location": "Pumpover station",
        "symptom": "Valve does not open on SCADA command",
        "operating_conditions": "Pumpover transfer requested",
        "operational_impact": "Transfer is delayed",
    })
    assert reported.status_code == 200
    fault_id = reported.json()["id"]
    assert reported.json()["assigned_section"] == "Systems Automation"
    assert client.post(f"/api/v1/faults/{fault_id}/action?action=acknowledge", headers=auth_headers(login("st-electrical"))).status_code == 404

    automation = auth_headers(login("automation"))
    first_evidence = client.post(
        f"/api/v1/faults/{fault_id}/attachments",
        headers=automation,
        files={"file": ("scada.log", b"synthetic command and feedback evidence", "text/plain")},
    )
    assert first_evidence.status_code == 200
    assert first_evidence.json()["assignment_id"] == reported.json()["active_assignment_id"]
    monkeypatch.setattr("app.core.config.settings.max_attachment_bytes", 4)
    assert client.post(
        f"/api/v1/faults/{fault_id}/attachments",
        headers=automation,
        files={"file": ("large.txt", b"12345", "text/plain")},
    ).status_code == 413
    assert client.post(
        f"/api/v1/faults/{fault_id}/attachments",
        headers=automation,
        files={"file": ("unsafe.exe", b"not allowed", "application/octet-stream")},
    ).status_code == 415

    assert client.post(f"/api/v1/faults/{fault_id}/action?action=acknowledge", headers=automation).status_code == 200
    electrical_handoff = client.post(
        f"/api/v1/faults/{fault_id}/assignments/escalate",
        headers=automation,
        json={
            "next_section": "Electrical",
            "findings": "SCADA communication is available and the OPEN command reaches the control system.",
            "recommendation": "Inspect actuator supply and protection circuits.",
        },
    )
    assert electrical_handoff.status_code == 200
    assert electrical_handoff.json()["status"] == "AWAITING_CHIEF_REVIEW"
    assert electrical_handoff.json()["requested_section"] == "Electrical"
    assert review_section_assignment(
        fault_id,
        "Systems Automation",
        electrical_handoff.json()["assignment_id"],
        "APPROVE_ESCALATION",
    ).status_code == 200
    assert allocate_current_assignment(fault_id, "Electrical", "st-electrical").status_code == 200

    electrical = auth_headers(login("st-electrical"))
    assert client.post(f"/api/v1/faults/{fault_id}/action?action=acknowledge", headers=electrical).status_code == 200
    diagnosis = client.post(f"/api/v1/faults/{fault_id}/diagnoses", headers=electrical, json={
        "possible_cause": "Actuator circuit fault",
        "diagnostic_method": "Check supply, protection and feedback under the approved procedure",
        "test_results": "Control output is present; actuator does not operate",
    })
    assert diagnosis.status_code == 200
    assert client.post(f"/api/v1/faults/{fault_id}/interventions", headers=electrical, json={
        "diagnosis_id": diagnosis.json()["id"],
        "corrective_action": "Electrical checks completed; mechanism requires inspection",
        "outcome": "FAILED",
    }).status_code == 200
    mechanical_handoff = client.post(
        f"/api/v1/faults/{fault_id}/assignments/escalate",
        headers=electrical,
        json={
            "next_section": "Mechanical",
            "findings": "Electrical supply and control checks do not explain the failure to move.",
            "recommendation": "Inspect the valve mechanism and report the restoration test.",
        },
    )
    assert mechanical_handoff.status_code == 200
    assert mechanical_handoff.json()["status"] == "AWAITING_CHIEF_REVIEW"
    assert review_section_assignment(
        fault_id,
        "Electrical",
        mechanical_handoff.json()["assignment_id"],
        "APPROVE_ESCALATION",
    ).status_code == 200
    assert allocate_current_assignment(fault_id, "Mechanical", "pt-mechanical").status_code == 200

    mechanical = auth_headers(login("pt-mechanical"))
    assert client.post(f"/api/v1/faults/{fault_id}/action?action=acknowledge", headers=mechanical).status_code == 200
    intervention = client.post(f"/api/v1/faults/{fault_id}/interventions", headers=mechanical, json={
        "corrective_action": "Mechanical inspection and approved corrective work completed",
        "outcome": "SUCCESS",
    })
    assert intervention.status_code == 200
    assert client.post(f"/api/v1/faults/{fault_id}/action?action=restore", headers=mechanical).status_code == 200
    premature_confirmation = client.post(f"/api/v1/faults/{fault_id}/operator-confirmation", headers=operations, json={
        "confirmed": False,
        "comments": "Operations cannot confirm before technical review.",
    })
    assert premature_confirmation.status_code == 409
    returned_completion = review_current_assignment(
        fault_id,
        "Mechanical",
        "RETURN_COMPLETION",
        "Record the functional test under operating conditions.",
    )
    assert returned_completion.status_code == 200
    assert client.post(f"/api/v1/faults/{fault_id}/interventions", headers=mechanical, json={
        "corrective_action": "Functional test repeated and valve response verified",
        "outcome": "SUCCESS",
    }).status_code == 200
    assert client.post(f"/api/v1/faults/{fault_id}/action?action=restore", headers=mechanical).status_code == 200
    assert review_current_assignment(fault_id, "Mechanical", "APPROVE_COMPLETION").status_code == 200

    assert client.post(f"/api/v1/faults/{fault_id}/operator-updates", headers=operations, json={
        "note": "Operations reports the transfer remains delayed pending confirmation.",
    }).status_code == 200
    not_confirmed = client.post(f"/api/v1/faults/{fault_id}/operator-confirmation", headers=operations, json={
        "confirmed": False,
        "comments": "Valve still does not complete the OPEN command.",
    })
    assert not_confirmed.status_code == 200
    assert not_confirmed.json()["status"] == "ASSIGNED"
    assert allocate_current_assignment(fault_id, "Mechanical", "pt-mechanical").status_code == 200
    assert client.post(f"/api/v1/faults/{fault_id}/action?action=acknowledge", headers=mechanical).status_code == 200
    assert client.post(f"/api/v1/faults/{fault_id}/interventions", headers=mechanical, json={
        "corrective_action": "Repeat mechanical check and restore valve response",
        "outcome": "SUCCESS",
    }).status_code == 200
    assert client.post(f"/api/v1/faults/{fault_id}/action?action=restore", headers=mechanical).status_code == 200
    assert review_current_assignment(fault_id, "Mechanical", "APPROVE_COMPLETION").status_code == 200
    confirmed = client.post(f"/api/v1/faults/{fault_id}/operator-confirmation", headers=operations, json={
        "confirmed": True,
        "comments": "Operations verified valve response and resumed transfer.",
    })
    assert confirmed.status_code == 200
    assert confirmed.json()["status"] == "CLOSED"

    context = client.get(f"/api/v1/faults/{fault_id}/context", headers=operations)
    assert context.status_code == 200
    data = context.json()
    assert [item["section"] for item in data["assignments"]] == [
        "Systems Automation", "Electrical", "Mechanical", "Mechanical",
    ]
    assert data["assignments"][0]["findings"]
    assert data["assignments"][1]["findings"]
    assert data["fault"]["operating_conditions"] == "Pumpover transfer requested"
    assert any(item["assignment_section"] == "Electrical" for item in data["diagnoses"])
    assert any(item["assignment_section"] == "Mechanical" for item in data["interventions"])
    assert any(item["event_type"] == "OPERATOR_UPDATE" for item in data["operator_updates"])
    attachment = data["attachments"][0]
    downloaded = client.get(attachment["download_url"], headers=mechanical)
    assert downloaded.status_code == 200
    assert downloaded.content == b"synthetic command and feedback evidence"
    workflow = client.get(
        "/api/v1/analytics/overview",
        headers=auth_headers(login("gm-om")),
    ).json()["workflow"]["handoffs_by_section"]
    assert workflow["Systems Automation"]["section_handoffs_sent"] >= 1
    assert workflow["Electrical"]["section_handoffs_received"] >= 1
    assert workflow["Mechanical"]["section_handoffs_received"] >= 1
    assert workflow["Systems Automation"]["section_acknowledgements"] >= 1
    assert workflow["Electrical"]["section_acknowledgements"] >= 1
    assert workflow["Mechanical"]["restorations"] >= 2


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
        if item.get("region") in ("Nairobi", "") and item["section"] == "Electrical"
    )
    first = client.post("/api/v1/faults", headers=operations, json={
        "equipment_id": electrical_asset["id"],
        "category": "Electrical",
        "symptom": "Repeat routing ranked cause test",
        "severity": "High",
        "operational_impact": "Test production effect",
    })
    assert first.status_code == 200
    first_id = first.json()["id"]

    principal = auth_headers(login("pt-electrical"))
    assert handoff_from_automation(first_id, "Electrical").status_code == 200
    assert allocate_current_assignment(first_id, "Electrical", "pt-electrical").status_code == 200
    assert client.post(f"/api/v1/faults/{first_id}/action?action=acknowledge", headers=principal).status_code == 200
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
    assert review_current_assignment(first_id, "Electrical", "APPROVE_COMPLETION").status_code == 200
    assert client.post(f"/api/v1/faults/{first_id}/operator-confirmation", headers=operations, json={
        "confirmed": True,
    }).status_code == 200

    repeat = client.post("/api/v1/faults", headers=operations, json={
        "equipment_id": electrical_asset["id"],
        "category": "Electrical",
        "symptom": "Repeat routing ranked cause test",
        "severity": "High",
        "operational_impact": "Test production effect",
    })
    assert repeat.status_code == 200
    assert repeat.json()["repeat_fault"] is True
    assert repeat.json()["triage_skipped"] is False
    assert repeat.json()["assigned_section"] == "Systems Automation"
    assert repeat.json()["seen_before_message"]

    context = client.get(f"/api/v1/faults/{repeat.json()['id']}/context", headers=principal)
    assert context.status_code == 200
    repeat_context = context.json()
    assert repeat_context["repeat_routing"]["seen_before"] is True
    assert repeat_context["repeat_routing"]["triage_action"] == "SA_FIRST_WITH_REPEAT_CONTEXT"
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
