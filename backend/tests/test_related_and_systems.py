"""Pillar C: shorthand-aware similar faults, related equipment, the offline case index.
Pillar B: system pages (legacy systems), tools and parts on procedures."""
from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def headers(username: str) -> dict:
    response = client.post("/api/v1/auth/login", json={"email": f"demo.{username}@kpc.co.ke", "password": "demo123"})
    assert response.status_code == 200, response.text
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


def asset(tag: str) -> dict:
    rows = client.get(f"/api/v1/equipment?search={tag}", headers=headers("operations")).json()
    return next(row for row in rows if row["tag"] == tag)


def report(tag: str, symptom: str, description: str) -> str:
    response = client.post("/api/v1/faults", headers=headers("operations"), json={
        "equipment_id": asset(tag)["id"], "symptom": symptom, "description": description,
        "operational_impact": "Stopped: Operation stopped or at risk"})
    assert response.status_code == 200, response.text
    return response.json()["id"]


def similar(fault_id: str, username: str = "automation") -> list[dict]:
    body = client.get(f"/api/v1/intelligence/similar-faults?fault_id={fault_id}&limit=10", headers=headers(username)).json()
    return body["similar"]


def test_similar_faults_understand_shorthand_and_word_forms():
    rows = similar(report("11-VFD-401", "Stopped / tripped", "VFD hot trip again this afternoon"))
    drive = [row for row in rows if "overtemperature" in row["symptom"].lower() or any("overtemperature" in cause.lower() or "fan" in cause.lower() for cause in row["causes"])]
    assert drive, "the drive that tripped on overtemperature should be found from 'VFD hot trip'"
    assert any(reason in ("Same problem described", "Similar problem description") for reason in drive[0]["reasons"])


def test_related_equipment_counts_and_shows_on_the_fault():
    fault_id = report("11-P-401", "Won't start", "Pump 401 refuses to start from the panel")
    related = [row for row in similar(fault_id) if any(reason.startswith("Related equipment") for reason in row["reasons"])]
    assert related and "Line 4 pump A unit" in next(reason for reason in related[0]["reasons"] if reason.startswith("Related"))
    context = client.get(f"/api/v1/faults/{fault_id}/context", headers=headers("automation")).json()
    assert context["system"]["name"] == "Line 4 pump A unit" and context["system"]["legacy"] is True
    assert context["related_faults"] and all(row["equipment_tag"] != "11-P-401" for row in context["related_faults"])


def test_pump_tags_with_different_letters_are_the_same_type():
    rows = similar(report("PUMP-101", "Leaking", "Product dripping from the pump seal"))
    assert any(reason == "Same type of equipment (PUMP)" for row in rows for reason in row["reasons"])


def test_the_offline_case_index_carries_the_same_rules_and_respects_scope():
    index = client.get("/api/v1/intelligence/case-index", headers=headers("st-mechanical")).json()
    assert index["weights"] == [0.4, 0.25, 0.2, 0.15] and index["related_equipment"] == 0.6
    assert "drive" in index["vocabulary"]["synonyms"]["vfd"]
    sections = {case["equipment_tag"] for case in index["cases"]}
    assert "11-P-401" in sections and "11-VFD-401" not in sections  # Mechanical only (the drive is Electrical)
    assert client.get("/api/v1/intelligence/case-index", headers=headers("operations")).status_code == 403


def test_system_pages_hold_how_it_connects_limitations_and_changes():
    listed = client.get("/api/v1/library/systems", headers=headers("st-electrical")).json()["systems"]
    line4 = next(row for row in listed if row["name"] == "Line 4 pump A unit")
    assert line4["legacy"] is True and line4["equipment_count"] == 5 and listed[0]["legacy"] is True

    page = client.get(f"/api/v1/library/systems/{line4['id']}", headers=headers("st-electrical")).json()
    assert "run-permit" in page["how_it_connects"] and page["known_limitations"]
    assert len(page["changes"]) >= 2 and {row["tag"] for row in page["equipment"]} >= {"11-P-401", "11-VFD-401"}
    assert page["can_edit"] is False and page["can_record_change"] is True

    added = client.post(f"/api/v1/library/systems/{line4['id']}/changes", headers=headers("st-electrical"),
                        json={"what_changed": "Replaced the drive cooling fan with a higher-flow model", "changed_on": "2026-11-20"})
    assert added.status_code == 200 and added.json()["changes"][0]["what_changed"].startswith("Replaced the drive cooling fan")
    assert client.post(f"/api/v1/library/systems/{line4['id']}/changes", headers=headers("st-electrical"),
                       json={"what_changed": "In the future", "changed_on": "2099-01-01"}).status_code == 422
    assert client.patch(f"/api/v1/library/systems/{line4['id']}", headers=headers("st-electrical"),
                        json={"known_limitations": "x"}).status_code == 403
    edited = client.patch(f"/api/v1/library/systems/{line4['id']}", headers=headers("ct-electrical"),
                          json={"known_limitations": page["known_limitations"] + " Drive panel 4 fan must be checked monthly."})
    assert edited.status_code == 200 and "monthly" in edited.json()["known_limitations"]
    assert edited.json()["updated_by"].startswith("Demo Chief Technician")
    assert client.get("/api/v1/library/systems", headers=headers("operations")).status_code == 403


def test_procedures_carry_tools_and_parts_and_they_are_compared():
    pumps = client.get("/api/v1/library/types/PUMP", headers=headers("st-mechanical")).json()
    # The seeded pump procedure (it may since have been improved by another test: look through its versions).
    card = next(card for group in pumps["symptoms"] for card in group["procedures"]
                if any(row["reference"].startswith("PU-LIB") for row in card["history"]))
    assert any(row["system"] and row["system"]["name"] == "Line 4 pump A unit" for row in pumps["equipment"])
    versions = client.get(f"/api/v1/procedure-updates/{card['id']}/versions", headers=headers("st-mechanical")).json()
    assert versions["field_labels"]["tools_materials"] == "Tools and parts"
    seeded = next(row for row in versions["versions"] if row["reference"].startswith("PU-LIB"))
    assert "vibration monitor key" in seeded["fields"]["tools_materials"].lower()


def test_problem_words_alone_do_not_bring_other_equipment_types_procedures():
    from sqlalchemy import select

    from app.db import SessionLocal
    from app.models import Equipment, Fault, KnowledgeEntry, ProcedureUpdate
    from app.services.catalogue import type_of

    with SessionLocal() as db:
        def other_type(equipment_id):
            equipment = db.get(Equipment, equipment_id) if equipment_id else None
            return bool(equipment) and type_of(equipment.tag) != "VFD"
        instructions = {item.id for item in db.scalars(select(KnowledgeEntry).where(
            KnowledgeEntry.status == "APPROVED", KnowledgeEntry.symptom.ilike("%Stopped / tripped%"))) if other_type(item.equipment_id)}
        procedures = {item.id for item in db.scalars(select(ProcedureUpdate).where(
            ProcedureUpdate.status == "APPROVED", ProcedureUpdate.observed_symptom.ilike("%Stopped / tripped%")))
            if other_type(db.get(Fault, item.fault_id).equipment_id)}
    assert instructions, "the demo data has 'Stopped / tripped' instructions for other equipment types"

    fault_id = report("11-VFD-401", "Stopped / tripped", "Drive tripped again")
    context = client.get(f"/api/v1/faults/{fault_id}/context", headers=headers("automation")).json()
    assert not {item["id"] for item in context["legacy_knowledge"]} & instructions
    assert not {item["id"] for item in context["approved_procedures"]} & procedures