"""Search (ranked, shorthand-aware) and the reporter's follow-up answers as queryable data."""
from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def headers(username: str) -> dict:
    response = client.post("/api/v1/auth/login", json={"email": f"demo.{username}@kpc.co.ke", "password": "demo123"})
    assert response.status_code == 200, response.text
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


def test_library_search_understands_shorthand_and_ranks_the_best_match_first():
    body = client.get("/api/v1/library/search?q=drive hot trip", headers=headers("st-electrical")).json()
    assert body["results"], "shorthand: drive = VFD, hot = overtemperature, trip = tripped"
    top = body["results"][0]
    assert top["type_code"] == "VFD" and top["matched_words"] == 3
    assert {"case"} <= {row["kind"] for row in body["results"]}

    pump = client.get("/api/v1/library/search?q=pmp seal leak", headers=headers("st-mechanical")).json()["results"]
    assert pump and pump[0]["type_code"] == "PUMP"
    assert "seal" in pump[0]["snippet"].lower()


def test_one_shared_word_is_not_a_match():
    results = client.get("/api/v1/library/search?q=transformer valve stem sediment", headers=headers("st-mechanical")).json()["results"]
    assert all(row["matched_words"] >= 2 for row in results)
    assert client.get("/api/v1/library/search?q=x", headers=headers("st-mechanical")).json()["results"] == []
    assert client.get("/api/v1/library/search?q=pump", headers=headers("operations")).status_code == 403


def test_history_search_is_ranked_and_exact_references_stay_exact():
    automation = headers("automation")
    rows = client.get("/api/v1/faults?search=valve stuck part way", headers=automation).json()
    assert rows and "Won't open / close" in [row["symptom"] for row in rows[:3]]
    reference = rows[0]["reference"]
    exact = client.get(f"/api/v1/faults?search={reference}", headers=automation).json()
    assert [row["reference"] for row in exact] == [reference]


def test_follow_up_answers_are_queryable_and_show_what_usually_fixed_it():
    automation = headers("automation")
    rows = client.get("/api/v1/faults?answer=position:Stuck part-way", headers=automation).json()
    assert rows
    for row in rows[:5]:
        detail = client.get(f"/api/v1/faults/{row['id']}", headers=automation).json()
        assert detail["report_details"]["answers"]["position"] == "Stuck part-way"

    mov = client.get("/api/v1/library/types/MOV", headers=headers("ct-electrical")).json()
    group = next(item for item in mov["symptoms"] if item["symptom"] == "Won't open / close")
    stuck = next(item for item in group["from_reports"] if item["answer"] == "Stuck part-way")
    assert stuck["question"] == "Position" and stuck["times"] >= 1
    assert "stem" in stuck["usually_fixed_by"].lower()


def test_new_reports_store_clean_structured_answers():
    operations = headers("operations")
    valve = next(row for row in client.get("/api/v1/equipment?search=11-MOV-602", headers=operations).json() if row["tag"] == "11-MOV-602")
    report = client.post("/api/v1/faults", headers=operations, json={
        "equipment_id": valve["id"], "symptom": "Won't open / close", "operational_impact": "Running reduced: Working, but limited",
        "report_details": {"problem": "Won't open / close", "answers": {"from": "From SCADA", "position": "Stuck part-way", "junk": {"nested": 1}}},
    })
    assert report.status_code == 200, report.text
    detail = client.get(f"/api/v1/faults/{report.json()['id']}", headers=operations).json()
    assert detail["report_details"]["answers"] == {"from": "From SCADA", "position": "Stuck part-way"}


def test_typos_are_tolerated_on_postgresql():
    import pytest
    from app.db import engine

    if engine.dialect.name != "postgresql":
        pytest.skip("fuzzy matching (pg_trgm) is PostgreSQL only")
    results = client.get("/api/v1/library/search?q=overtemprature", headers=headers("st-electrical")).json()["results"]
    assert results and results[0]["type_code"] == "VFD"