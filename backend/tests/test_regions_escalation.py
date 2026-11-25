"""Regions (Western, Nairobi, Coast) and escalation CT -> regional SE -> section CE."""
from datetime import timedelta

from fastapi.testclient import TestClient
from sqlalchemy import select

from app.db import SessionLocal
from app.main import app
from app.models import Fault, MailOutbox, utcnow
from app.services import escalation

client = TestClient(app)


def headers(username: str) -> dict:
    response = client.post("/api/v1/auth/login", json={"email": f"demo.{username}@kpc.co.ke", "password": "demo123"})
    assert response.status_code == 200, response.text
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


def asset(tag: str) -> dict:
    rows = client.get(f"/api/v1/equipment?search={tag}", headers=headers("operations")).json()
    return next(row for row in rows if row["tag"] == tag)


def report(tag: str, **extra) -> str:
    response = client.post("/api/v1/faults", headers=headers("operations"), json={
        "equipment_id": asset(tag)["id"], "symptom": "Failure to start", "severity": "High",
        "operational_impact": "Stopped: Operation stopped or at risk", **extra,
    })
    assert response.status_code == 200, response.text
    return response.json()["id"]


def mail_to(username: str, subject_part: str) -> bool:
    with SessionLocal() as db:
        return bool(db.scalar(select(MailOutbox.id).where(
            MailOutbox.recipient == f"demo.{username}@kpc.co.ke", MailOutbox.subject.contains(subject_part))))


def test_regional_staff_see_their_region_and_the_chief_engineer_sees_the_whole_section():
    nairobi_pump, coast_pump = asset("11-P-401"), asset("PUMP-101")
    assert (nairobi_pump["region"], coast_pump["region"]) == ("Nairobi", "Coast")
    assert nairobi_pump["section"] == coast_pump["section"] == "Mechanical"

    def tags(username):
        return {row["tag"] for row in client.get("/api/v1/equipment", headers=headers(username)).json()}

    assert "11-P-401" in tags("st-mechanical") and "PUMP-101" not in tags("st-mechanical")
    assert "PUMP-101" in tags("st-mechanical-coast") and "11-P-401" not in tags("st-mechanical-coast")
    assert {"PUMP-101", "11-P-401"} <= tags("chief-engineer-mechanical")

    fault_id = report("PUMP-101")
    assert client.get(f"/api/v1/faults/{fault_id}", headers=headers("ct-mechanical")).status_code == 404
    assert client.get(f"/api/v1/faults/{fault_id}", headers=headers("ct-mechanical-coast")).status_code == 200
    assert client.get(f"/api/v1/faults/{fault_id}", headers=headers("chief-engineer-mechanical")).status_code == 200

    me = client.get("/api/v1/auth/me", headers=headers("ct-mechanical-coast")).json()
    assert me["region"] == "Coast" and me["access"]["scope"] == "Mechanical section, Coast region"
    chief = client.get("/api/v1/auth/me", headers=headers("chief-engineer-mechanical")).json()
    assert chief["access"]["scope"] == "Mechanical section, all regions"
    assert "escalations" in {item["key"] for item in chief["access"]["menu"]}


def test_a_safety_report_goes_straight_to_the_regional_senior_engineer_only():
    fault_id = report("PUMP-101", safety_hazard=True, description="Smoke from the motor terminal box")
    detail = client.get(f"/api/v1/faults/{fault_id}", headers=headers("operations")).json()
    assert detail["escalation_level"] == 1 and detail["escalated_to"] == "Senior Engineer"
    assert detail["escalation_reason"] == "Safety or environment hazard reported"
    assert mail_to("senior-engineer-mechanical-coast", "Escalated to you")

    coast_se = client.get("/api/v1/escalations", headers=headers("senior-engineer-mechanical-coast")).json()
    assert fault_id in {row["id"] for row in coast_se["faults"]}
    nairobi_se = client.get("/api/v1/escalations", headers=headers("senior-engineer-mechanical")).json()
    assert fault_id not in {row["id"] for row in nairobi_se["faults"]}
    # The Chief Engineer only sees what persists.
    ce = client.get("/api/v1/escalations", headers=headers("chief-engineer-mechanical")).json()
    assert fault_id not in {row["id"] for row in ce["faults"]}
    # Technicians do not have an escalations queue.
    assert client.get("/api/v1/escalations", headers=headers("st-mechanical-coast")).status_code == 403


def test_ct_asks_the_senior_engineer_who_takes_it_to_the_chief_engineer_with_guidance():
    fault_id = report("11-P-401")
    ask = {"to": "SE", "reason": "Alarms will not reset after two attempts"}
    assert client.post(f"/api/v1/faults/{fault_id}/escalate", headers=headers("st-mechanical"), json=ask).status_code == 403
    assert client.post(f"/api/v1/faults/{fault_id}/escalate", headers=headers("ct-mechanical"),
                       json={"to": "CE", "reason": "Skip the SE please"}).status_code == 403
    first = client.post(f"/api/v1/faults/{fault_id}/escalate", headers=headers("ct-mechanical"), json=ask)
    assert first.status_code == 200 and first.json()["escalation_level"] == 1
    assert client.post(f"/api/v1/faults/{fault_id}/escalate", headers=headers("ct-mechanical"), json=ask).status_code == 403
    assert mail_to("senior-engineer-mechanical", "Escalated to you")
    assert not mail_to("senior-engineer-mechanical-coast", fault_ref(fault_id))

    se = headers("senior-engineer-mechanical")
    assert client.post(f"/api/v1/faults/{fault_id}/escalation-guidance", headers=se,
                       json={"note": "Check the VFD trip latch at panel 4 before restarting"}).status_code == 200
    up = client.post(f"/api/v1/faults/{fault_id}/escalate", headers=se,
                     json={"to": "CE", "reason": "Needs a design change"})
    assert up.status_code == 200 and up.json()["escalation_level"] == 2
    assert mail_to("chief-engineer-mechanical", "Escalated to you")

    ce = headers("chief-engineer-mechanical")
    assert fault_id in {row["id"] for row in client.get("/api/v1/escalations", headers=ce).json()["faults"]}
    guided = client.post(f"/api/v1/faults/{fault_id}/escalation-guidance", headers=ce,
                         json={"note": "Raise a design change; run pump B meanwhile"})
    assert guided.status_code == 200 and guided.json()["escalation_guidance"].startswith("Raise a design change")
    assert mail_to("ct-mechanical", "Guidance from the Chief Engineer")
    events = [row["event_type"] for row in client.get(f"/api/v1/faults/{fault_id}/timeline", headers=ce).json()]
    assert events.count("FAULT_ESCALATED") == 2 and events.count("ESCALATION_GUIDANCE") == 2


def fault_ref(fault_id: str) -> str:
    with SessionLocal() as db:
        return db.get(Fault, fault_id).reference


def test_not_back_in_service_after_eight_hours_goes_to_the_senior_engineer():
    fault_id = report("11-VFD-401")
    with SessionLocal() as db:
        assert escalation.run(db, utcnow()) >= 0
        assert db.get(Fault, fault_id).escalation_level == 0
        escalation.run(db, utcnow() + timedelta(hours=8, minutes=5))
        fault = db.get(Fault, fault_id)
        assert fault.escalation_level == 1 and fault.escalation_reason == "Not back in service after 8 hours"


def test_the_same_equipment_failing_again_within_30_days_of_a_fix_goes_to_the_chief_engineer():
    first = report("11-VMS-401")
    with SessionLocal() as db:
        fault = db.get(Fault, first)
        fault.status, fault.restored_at = "RESTORED", utcnow() - timedelta(days=5)
        db.commit()
    again = report("11-VMS-401")
    detail = client.get(f"/api/v1/faults/{again}", headers=headers("operations")).json()
    assert detail["escalation_level"] == 2 and "Came back within 30 days" in detail["escalation_reason"]
    ce = client.get("/api/v1/escalations", headers=headers("chief-engineer-instrumentation")).json()
    assert again in {row["id"] for row in ce["faults"]}
