"""Each level's view comes from the account: home, menu, scope and abilities, carried in the session."""
import uuid

import pytest
from fastapi.testclient import TestClient
from jose import jwt

from app.core.config import settings
from app.main import app

client = TestClient(app)


def sign_in(username: str) -> dict:
    response = client.post("/api/v1/auth/login", json={"email": f"demo.{username}@kpc.co.ke", "password": "demo123"})
    assert response.status_code == 200, response.text
    return response.json()


# username, level, home, menu that must be there, menu that must not, scope
LEVELS = [
    ("operations", "OPS", "my_reports", {"report", "home", "faults", "account"}, {"analytics", "people", "approvals"}, "All equipment"),
    ("automation", "SA", "my_jobs", {"home", "faults", "knowledge", "sync"}, {"analytics", "people", "report"}, "Systems Automation section"),
    ("st-electrical", "ST", "my_jobs", {"home", "faults", "equipment", "knowledge"}, {"analytics", "approvals", "people"}, "Electrical section"),
    ("pt-mechanical", "PT", "my_jobs", {"home", "faults"}, {"analytics", "approvals"}, "Mechanical section"),
    ("ct-electrical", "CT", "section_oversight", {"home", "analytics", "approvals"}, {"people"}, "Electrical section"),
    ("assistant-engineer-systems-automation", "AE", "my_jobs", {"home", "faults"}, {"analytics", "approvals"}, "Systems Automation section"),
    ("engineer-electrical", "E", "my_jobs", {"home", "faults"}, {"analytics", "approvals"}, "Electrical section"),
    ("senior-engineer-electrical", "SE", "my_jobs", {"home", "faults"}, {"analytics", "approvals"}, "Electrical section"),
    ("chief-engineer-electrical", "CE", "section_engineering", {"home", "analytics", "approvals", "faults"}, {"people"}, "Electrical section"),
    ("maintenance-manager", "MM", "maintenance_overview", {"home", "analytics", "faults"}, {"people", "report"}, "All sections"),
    ("gm-om", "GM", "om_overview", {"home", "analytics", "faults"}, {"people"}, "All sections"),
    ("hr", "HR", "workforce", {"home", "people", "account"}, {"faults", "equipment", "analytics", "sync"}, "Staff records"),
    ("ceo", "MD", "executive", {"home", "analytics", "account"}, {"faults", "equipment", "people", "sync"}, "Headline figures"),
    ("supervisor", "SUP", "supervision", {"home", "analytics", "approvals"}, {"people"}, "All sections"),
    ("admin", "ADMIN", "administration", {"home", "people", "analytics"}, {"approvals"}, "All sections"),
]


@pytest.mark.parametrize("username, level, home, has, lacks, scope", LEVELS)
def test_each_level_gets_its_own_home_menu_and_scope(username, level, home, has, lacks, scope):
    result = sign_in(username)
    access = result["user"]["access"]
    assert access["level"] == level
    assert access["home"] == home
    keys = {item["key"] for item in access["menu"]}
    assert has <= keys, f"{username} is missing {has - keys}"
    assert not (lacks & keys), f"{username} should not see {lacks & keys}"
    assert access["scope"].startswith(scope)
    # The same profile comes back from /me, from the server's copy of the account.
    me = client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {result['access_token']}"}).json()
    assert me["access"] == access


def test_abilities_follow_the_level():
    def can(username):
        return set(sign_in(username)["user"]["access"]["can"])
    assert {"jobs.allocate", "work.signoff", "procedures.review", "analytics.section"} <= can("ct-electrical")
    assert "jobs.allocate" not in can("pt-electrical") and "jobs.work" in can("pt-electrical")
    # Whoever is on the job can say it works again; Operations confirm it.
    assert "faults.restore" in can("senior-engineer-electrical") and "faults.restore" in can("engineer-electrical")
    assert {"analytics.section", "procedures.review", "jobs.work"} <= can("chief-engineer-electrical")
    assert "analytics.org" in can("maintenance-manager")
    assert can("ceo") & {"faults.read", "analytics.org", "similar.view"} == set()
    assert {"people.evidence", "people.read"} <= can("hr") and "faults.read" not in can("hr")
    assert {"people.manage", "network.simulator"} <= can("admin")


def test_the_session_token_carries_the_account_level_and_section():
    token = sign_in("ct-electrical")["access_token"]
    claims = jwt.decode(token, settings.jwt_secret, algorithms=["HS256"])
    assert (claims["email"], claims["role"], claims["level"], claims["section"]) == (
        "demo.ct-electrical@kpc.co.ke", "technician_ct", "CT", "Electrical")
    assert claims["av"] and "pv" in claims


def test_a_forged_token_is_refused():
    token = sign_in("st-electrical")["access_token"]
    claims = jwt.decode(token, settings.jwt_secret, algorithms=["HS256"])
    forged = jwt.encode({**claims, "role": "system_administrator", "level": "ADMIN"}, "not-the-secret", algorithm="HS256")
    assert client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {forged}"}).status_code == 401


def test_changing_someones_level_ends_their_session_and_changes_their_view():
    admin = {"Authorization": f"Bearer {sign_in('admin')['access_token']}"}
    email = f"promoted.{uuid.uuid4().hex[:6]}@kpc.co.ke"
    created = client.post("/api/v1/users", headers=admin, json={
        "email": email, "display_name": "Brian Kiprop", "role": "technician_st", "section": "Electrical", "region": "Nairobi", "password": "Valves2026x",
    }).json()
    first = client.post("/api/v1/auth/login", json={"email": email, "password": "Valves2026x"}).json()
    old = {"Authorization": f"Bearer {first['access_token']}"}
    assert first["user"]["access"]["level"] == "ST"

    st_user = {"Authorization": f"Bearer {sign_in('st-electrical')['access_token']}"}
    assert client.patch(f"/api/v1/users/{created['id']}/access", headers=st_user, json={"role": "technician_ct", "section": "Electrical"}).status_code == 403
    assert client.patch(f"/api/v1/users/{created['id']}/access", headers=admin, json={"role": "technician_ct", "section": ""}).status_code == 422

    changed = client.patch(f"/api/v1/users/{created['id']}/access", headers=admin, json={"role": "technician_ct", "section": "Electrical"})
    assert changed.status_code == 200
    stopped = client.get("/api/v1/auth/me", headers=old)
    assert stopped.status_code == 401 and "access was changed" in stopped.json()["detail"]

    again = client.post("/api/v1/auth/login", json={"email": email, "password": "Valves2026x"}).json()
    assert (again["user"]["access"]["level"], again["user"]["access"]["home"]) == ("CT", "section_oversight")
    audit = client.get("/api/v1/users/audit", headers=admin).json()
    assert any(item["action"] == "USER_ACCESS_CHANGED" and item["target_user_id"] == created["id"] for item in audit)
    me = client.get("/api/v1/auth/me", headers=admin).json()
    assert client.patch(f"/api/v1/users/{me['id']}/access", headers=admin, json={"role": "hr_officer"}).status_code == 409
