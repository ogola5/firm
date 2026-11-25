"""Knowledge library by equipment type: causes, what worked and failed, evidence, freshness, owners, versions."""
from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def headers(username: str) -> dict:
    response = client.post("/api/v1/auth/login", json={"email": f"demo.{username}@kpc.co.ke", "password": "demo123"})
    assert response.status_code == 200, response.text
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


def test_types_are_listed_with_owner_and_most_troublesome_first():
    body = client.get("/api/v1/library/types", headers=headers("st-mechanical")).json()
    types = {row["code"]: row for row in body["types"]}
    assert types["PUMP"]["owner"]["name"].startswith("Demo Senior Engineer (Mechanical")
    assert types["PUMP"]["procedures"] >= 1 and types["MOV"]["fading_procedures"] >= 1
    years = [row["faults_last_year"] for row in body["types"]]
    assert years == sorted(years, reverse=True)
    assert client.get("/api/v1/library/types", headers=headers("operations")).status_code == 403


def test_a_type_page_leads_with_the_problem_then_causes_fixes_failures_and_proof():
    page = client.get("/api/v1/library/types/PUMP", headers=headers("st-mechanical")).json()
    wont_start = next(item for item in page["symptoms"] if item["symptom"] == "Won't start")
    # Different wordings of the same kind of cause are merged, and the wordings kept.
    top = wont_start["causes"][0]
    assert top["category"] == "Protection trip latched / alarms would not reset" and top["confirmed"] >= 2
    assert "Latched trip in the vibration monitor" in [top["cause"], *top["also_recorded_as"]]
    assert len([item for item in wont_start["causes"] if item["category"] == top["category"]]) == 1
    # No generic causes left over from the old demo data.
    assert all(item["cause"] not in ("Sensor drift", "Blocked filter", "Loose terminal connection", "Incorrect controller parameter")
               for group in page["symptoms"] for item in group["causes"])
    assert top["first_check"]
    assert any("SCADA" in item["action"] and "latch" in item["note"] for item in wont_start["did_not_work"])
    card = next(item for item in wont_start["procedures"] if item["reference"].startswith("PU-LIB"))
    assert card["evidence"]["worked"] >= 2 and card["evidence"]["fading"] is False
    assert card["evidence"]["last_confirmed_working"]
    assert wont_start["cases"] and wont_start["cases"][0]["reference"]
    assert page["owner"] and page["can_withdraw"] is False  # an ST cannot withdraw


def test_old_unconfirmed_procedures_fade_and_improvements_supersede():
    mov = client.get("/api/v1/library/types/MOV", headers=headers("ct-electrical")).json()
    cards = [card for group in mov["symptoms"] for card in group["procedures"]]
    assert any(card["evidence"]["fading"] for card in cards)

    lt = client.get("/api/v1/library/types/LT", headers=headers("st-instrumentation")).json()
    cards = [card for group in lt["symptoms"] for card in group["procedures"] if card["reference"].startswith("PU-LIB")]
    assert len(cards) == 1 and cards[0]["version"] == 2  # only the newest version is current guidance
    assert [row["status"] for row in cards[0]["history"]] == ["SUPERSEDED", "APPROVED"]
    assert len(cards[0]["contributors"]) == 2  # both authors credited


def test_the_owner_is_named_by_the_chief_engineer_and_can_withdraw():
    candidates = client.get("/api/v1/library/owner-candidates", headers=headers("chief-engineer-electrical")).json()
    assert candidates and all(item["section"] == "Electrical" for item in candidates)
    st = next(item for item in client.get("/api/v1/users", headers=headers("admin")).json() if item["username"] == "st-electrical")
    assert client.put("/api/v1/library/types/VFD/owner", headers=headers("chief-engineer-electrical"),
                      json={"user_id": st["id"]}).status_code == 422  # owners are CTs or SEs
    assert client.put("/api/v1/library/types/VFD/owner", headers=headers("st-electrical"),
                      json={"user_id": candidates[0]["id"]}).status_code == 403
    assigned = client.put("/api/v1/library/types/VFD/owner", headers=headers("chief-engineer-electrical"),
                          json={"user_id": candidates[0]["id"]})
    assert assigned.status_code == 200 and assigned.json()["id"] == candidates[0]["id"]

    rtu = client.get("/api/v1/library/types/RTU", headers=headers("ct-systems-automation")).json()
    assert rtu["can_withdraw"] is True
    card = next(card for group in rtu["symptoms"] for card in group["procedures"] if card["reference"].startswith("PU-LIB"))
    assert client.post(f"/api/v1/procedure-updates/{card['id']}/withdraw", headers=headers("st-systems-automation"),
                       json={"reason": "Module replaced by a new type"}).status_code == 403
    withdrawn = client.post(f"/api/v1/procedure-updates/{card['id']}/withdraw", headers=headers("ct-systems-automation"),
                            json={"reason": "The RTU was replaced in the upgrade; this no longer applies"})
    assert withdrawn.status_code == 200 and withdrawn.json()["status"] == "WITHDRAWN"
    rtu = client.get("/api/v1/library/types/RTU", headers=headers("ct-systems-automation")).json()
    assert card["id"] not in {item["id"] for group in rtu["symptoms"] for item in group["procedures"]}


def test_my_impact_shows_colleagues_helped():
    impact = client.get("/api/v1/me/knowledge-impact", headers=headers("pt-mechanical")).json()
    assert impact["helped_total"] >= 1
    assert any(item["colleague"].startswith("Demo Senior Technician") for item in impact["helped"])
    owner = client.get("/api/v1/me/knowledge-impact", headers=headers("ct-electrical")).json()
    assert {"code": "MOV", "name": "Motor-operated valves"} in owner["owned_types"]
    assert owner["needs_attention"]  # the fading MOV procedure


def test_appraisal_shows_knowledge_contribution_as_proposed():
    body = client.get("/api/v1/hr/appraisal", headers=headers("hr")).json()
    assert body["knowledge_in_appraisal"]["status"] == "PROPOSED"
    assert "management approval" in body["knowledge_in_appraisal"]["note"]
    row = next(item for item in body["rows"] if item["employee_name"].startswith("Demo Engineer (Instrumentation"))
    assert row["improved_colleagues_procedures"] >= 1


def test_a_write_up_can_add_to_an_existing_procedure_which_then_supersedes_it():
    pump = client.get("/api/v1/library/types/PUMP", headers=headers("pt-mechanical")).json()
    vibration_case = next(item for item in pump["symptoms"] if item["symptom"] == "Noise, vibration or heat")["cases"][0]
    matches = client.get(f"/api/v1/faults/{vibration_case['id']}/procedure-matches", headers=headers("pt-mechanical")).json()
    assert matches and "same equipment" in matches[0]["reasons"]
    base = matches[0]

    pt = headers("pt-mechanical")
    submitted = client.post(f"/api/v1/faults/{vibration_case['id']}/procedure-updates", headers=pt, json={
        "title": base["title"] + " (and check alignment after seal work)", "observed_symptom": "Won't start",
        "confirmed_cause": base["cause"], "diagnostic_procedure": base["checks"] + "\n4. After seal work, check coupling alignment.",
        "corrective_action": base["fix"], "safety": "", "builds_on_id": base["id"],
    })
    assert submitted.status_code == 200, submitted.text
    new = submitted.json()
    assert new["version"] == base["version"] + 1 and new["lineage_id"] != new["id"]
    assert client.post(f"/api/v1/procedure-updates/{new['id']}/review", headers=headers("ct-mechanical"),
                       json={"decision": "APPROVE"}).status_code == 200
    assert client.post(f"/api/v1/procedure-updates/{new['id']}/review", headers=headers("supervisor"),
                       json={"decision": "APPROVE"}).status_code == 200
    pump = client.get("/api/v1/library/types/PUMP", headers=headers("pt-mechanical")).json()
    cards = [card for group in pump["symptoms"] for card in group["procedures"] if card["id"] in (new["id"], base["id"])]
    assert [card["id"] for card in cards] == [new["id"]]
    assert [row["status"] for row in cards[0]["history"]][:2] == ["SUPERSEDED", "APPROVED"]
