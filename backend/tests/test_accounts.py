"""Company-email accounts: enrolment, approval, sign-in rules, lockout and passwords."""
import re
import uuid

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from app.main import app
from app.services.accounts import check_password, normalize_email

client = TestClient(app)
GOOD_PASSWORD = "Valves2026x"


def demo_headers(username: str) -> dict:
    response = client.post("/api/v1/auth/login", json={"email": f"demo.{username}@kpc.co.ke", "password": "demo123"})
    assert response.status_code == 200, response.text
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


def new_email() -> str:
    return f"jane.wanjiru.{uuid.uuid4().hex[:6]}@kpc.co.ke"


def latest_code(email: str) -> str:
    messages = client.get("/api/v1/demo/mailbox", params={"email": email}).json()
    for message in messages:
        found = re.search(r"\b(\d{6})\b", message["subject"])
        if found:
            return found.group(1)
    raise AssertionError(f"No code in the mailbox for {email}")


def enrol(email: str, role="technician_st", section="Electrical") -> None:
    started = client.post("/api/v1/enrolment/start", json={
        "email": email, "display_name": "Jane Wanjiru", "staff_number": "KPC-10234",
        "requested_role": role, "requested_section": section, "requested_region": "Coast",
    })
    assert started.status_code == 202, started.text
    verified = client.post("/api/v1/enrolment/verify", json={"email": email, "code": latest_code(email), "password": GOOD_PASSWORD})
    assert verified.status_code == 200, verified.text


def approve(email: str, **decision) -> dict:
    admin = demo_headers("admin")
    request = next(item for item in client.get("/api/v1/enrolment/requests", headers=admin).json() if item["email"] == email)
    response = client.post(f"/api/v1/enrolment/requests/{request['id']}/approve", headers=admin, json=decision)
    assert response.status_code == 200, response.text
    return response.json()


def sign_in(email: str, password: str = GOOD_PASSWORD):
    return client.post("/api/v1/auth/login", json={"email": email, "password": password})


# --- address and password rules ----------------------------------------------------------------

@pytest.mark.parametrize("raw, expected", [
    ("Jane.Wanjiru@KPC.co.ke", "jane.wanjiru@kpc.co.ke"),
    ("  j_otieno-2@kpc.co.ke ", "j_otieno-2@kpc.co.ke"),
])
def test_company_addresses_are_accepted_and_lower_cased(raw, expected):
    assert normalize_email(raw) == expected


@pytest.mark.parametrize("raw", [
    "jane@gmail.com", "jane@kpc.co.ke.evil.com", "jane@mail.kpc.co.ke", "jane@kpc.co", "jane@kpcco.ke",
    "jane@@kpc.co.ke", "jane", "", ".jane@kpc.co.ke", "jane..w@kpc.co.ke", "jane+x@kpc.co.ke", "ja ne@kpc.co.ke",
])
def test_other_addresses_are_refused(raw):
    with pytest.raises(HTTPException) as refused:
        normalize_email(raw)
    assert refused.value.status_code == 422


def test_password_rules():
    # Demonstration rule: at least 4 characters, with both letters and numbers.
    for fine in (GOOD_PASSWORD, "ab12", "jane2026"):
        check_password(fine, "jane.wanjiru@kpc.co.ke", "Jane Wanjiru")
    for weak in ("a1", "abc", "onlyletters", "1234567890"):
        with pytest.raises(HTTPException):
            check_password(weak, "jane.wanjiru@kpc.co.ke", "Jane Wanjiru")


def test_one_step_sign_up_without_a_code_then_approval_or_at_once():
    def register(email: str, password: str = "abc1"):
        return client.post("/api/v1/enrolment/register", json={
            "email": email, "display_name": "Demo Visitor", "staff_number": "KPC-9001", "requested_role": "technician_st",
            "requested_section": "Electrical", "requested_region": "Nairobi", "password": password,
        })

    options = client.get("/api/v1/enrolment/options").json()
    assert options["email_code"] is False and options["password_min_length"] == 4
    assert register("visitor.one@kpc.co.ke", "abcd").status_code == 422  # letters only
    made = register("visitor.one@kpc.co.ke")
    assert made.status_code == 201 and made.json()["account_status"] == "PENDING_APPROVAL"
    assert sign_in("visitor.one@kpc.co.ke", "abc1").status_code == 403  # waiting for approval
    assert register("visitor.one@kpc.co.ke").status_code == 409  # already has an account

    # The demonstration switch: accounts work at once with the job asked for.
    admin = {"Authorization": f"Bearer {sign_in('demo.admin@kpc.co.ke', 'demo123').json()['access_token']}"}
    assert client.patch("/api/v1/admin/settings/enrolment_auto_approve", headers=admin, json={"value": True}).status_code == 200
    try:
        ready = register("visitor.two@kpc.co.ke")
        assert ready.status_code == 201 and ready.json()["account_status"] == "ACTIVE"
        signed_in = sign_in("visitor.two@kpc.co.ke", "abc1")
        assert signed_in.status_code == 200 and signed_in.json()["user"]["section"] == "Electrical"
    finally:
        client.patch("/api/v1/admin/settings/enrolment_auto_approve", headers=admin, json={"reset": True})
    # With the emailed code switched on, the one-step route is closed.
    assert client.patch("/api/v1/admin/settings/enrolment_email_code", headers=admin, json={"value": True}).status_code == 200
    try:
        assert register("visitor.three@kpc.co.ke").status_code == 409
    finally:
        client.patch("/api/v1/admin/settings/enrolment_email_code", headers=admin, json={"reset": True})


# --- enrolment ---------------------------------------------------------------------------------

def test_enrolment_needs_a_verified_company_email_and_administrator_approval():
    email = new_email()
    assert client.post("/api/v1/enrolment/start", json={
        "email": "jane@gmail.com", "display_name": "Jane", "staff_number": "KPC-1", "requested_role": "operations",
    }).status_code == 422

    enrol(email, role="technician_st", section="Electrical")
    # Verified, but not yet approved: correct password, clear reason, no session.
    waiting = sign_in(email)
    assert waiting.status_code == 403
    assert waiting.json()["detail"]["account_status"] == "PENDING_APPROVAL"
    assert "waiting for approval" in waiting.json()["detail"]["message"]
    # The administrators were told.
    assert any("Account request" in item["subject"] for item in client.get("/api/v1/demo/mailbox", params={"email": "demo.admin@kpc.co.ke"}).json())

    # The administrator decides the role and section; the request is only a request.
    approved = approve(email, role="technician_pt", section="Mechanical")
    assert (approved["role"], approved["section"]) == ("technician_pt", "Mechanical")
    assert "differs from what you asked for" in client.get("/api/v1/demo/mailbox", params={"email": email}).json()[0]["body"]

    signed_in = sign_in(email)
    assert signed_in.status_code == 200
    token = {"Authorization": f"Bearer {signed_in.json()['access_token']}"}
    account = client.get("/api/v1/account", headers=token).json()
    assert account["email"] == email
    assert account["role_label"] == "Principal Technician (PT)"
    assert account["staff_number"] == "KPC-10234"
    assert account["approved_by"] and account["last_login_at"]
    assert "Record visits, findings and what was tried" in account["can_do"]
    # Enrolled people are never offered as demonstration accounts.
    assert email not in {item["email"] for item in client.get("/api/v1/auth/demo-accounts").json()}


def test_nobody_can_request_administrator_rights_or_skip_verification():
    email = new_email()
    assert client.post("/api/v1/enrolment/start", json={
        "email": email, "display_name": "Jane Wanjiru", "staff_number": "KPC-2", "requested_role": "system_administrator",
    }).status_code == 422
    assert client.post("/api/v1/enrolment/start", json={
        "email": email, "display_name": "Jane Wanjiru", "staff_number": "KPC-2", "requested_role": "technician_st",
    }).status_code == 422  # section required
    client.post("/api/v1/enrolment/start", json={
        "email": email, "display_name": "Jane Wanjiru", "staff_number": "KPC-2", "requested_role": "operations",
    })
    assert sign_in(email).status_code == 401  # no password yet
    admin = demo_headers("admin")
    assert email not in {item["email"] for item in client.get("/api/v1/enrolment/requests", headers=admin).json()}
    assert client.get("/api/v1/enrolment/requests", headers=demo_headers("hr")).status_code == 403


def test_wrong_codes_are_limited_and_a_new_code_replaces_the_old():
    email = new_email()
    payload = {"email": email, "display_name": "Jane Wanjiru", "staff_number": "KPC-3", "requested_role": "operations"}
    client.post("/api/v1/enrolment/start", json=payload)
    first = latest_code(email)
    client.post("/api/v1/enrolment/start", json=payload)
    second = latest_code(email)
    if first != second:
        assert client.post("/api/v1/enrolment/verify", json={"email": email, "code": first, "password": GOOD_PASSWORD}).status_code == 400
    wrong = "000000" if second != "000000" else "111111"
    for _ in range(5):
        client.post("/api/v1/enrolment/verify", json={"email": email, "code": wrong, "password": GOOD_PASSWORD})
    assert client.post("/api/v1/enrolment/verify", json={"email": email, "code": second, "password": GOOD_PASSWORD}).status_code == 400


def test_existing_address_gets_the_same_answer_and_a_warning_email():
    response = client.post("/api/v1/enrolment/start", json={
        "email": "demo.operations@kpc.co.ke", "display_name": "Someone Else", "staff_number": "KPC-4", "requested_role": "operations",
    })
    assert response.status_code == 202
    assert "If this address can be used" in response.json()["message"]
    assert client.get("/api/v1/demo/mailbox", params={"email": "demo.operations@kpc.co.ke"}).json()[0]["subject"] == "You already have a KPC Maintenance account"
    assert sign_in("demo.operations@kpc.co.ke", "demo123").status_code == 200  # untouched


def test_rejected_request_shows_the_reason():
    email = new_email()
    enrol(email, role="operations", section="")
    admin = demo_headers("admin")
    request = next(item for item in client.get("/api/v1/enrolment/requests", headers=admin).json() if item["email"] == email)
    assert client.post(f"/api/v1/enrolment/requests/{request['id']}/reject", headers=admin, json={"reason": ""}).status_code == 422
    assert client.post(f"/api/v1/enrolment/requests/{request['id']}/reject", headers=admin,
                       json={"reason": "Not on the Operations staff list"}).status_code == 200
    refused = sign_in(email)
    assert refused.status_code == 403
    assert "Not on the Operations staff list" in refused.json()["detail"]["message"]
    assert client.post(f"/api/v1/enrolment/requests/{request['id']}/approve", headers=admin, json={}).status_code == 409


# --- sign-in -----------------------------------------------------------------------------------

def test_sign_in_needs_a_company_email_and_does_not_reveal_which_addresses_exist():
    assert client.post("/api/v1/auth/login", json={"email": "operations", "password": "demo123"}).status_code == 422
    unknown = sign_in("nobody.here@kpc.co.ke", "whatever1")
    wrong = sign_in("demo.operations@kpc.co.ke", "wrong-password1")
    assert unknown.status_code == wrong.status_code == 401
    assert unknown.json()["detail"] == wrong.json()["detail"]


def test_repeated_wrong_passwords_lock_the_account():
    email = new_email()
    enrol(email, role="operations", section="")
    approve(email)
    for _ in range(5):
        assert sign_in(email, "Wrong-password1").status_code == 401
    assert sign_in(email).status_code == 429  # locked even with the right password


def test_password_reset_and_change_end_older_sessions():
    email = new_email()
    enrol(email, role="operations", section="")
    approve(email)
    old_token = {"Authorization": f"Bearer {sign_in(email).json()['access_token']}"}
    assert client.get("/api/v1/auth/me", headers=old_token).status_code == 200

    assert client.post("/api/v1/auth/password-reset/start", json={"email": "nobody.here@kpc.co.ke"}).status_code == 202
    assert client.post("/api/v1/auth/password-reset/start", json={"email": email}).status_code == 202
    reset = client.post("/api/v1/auth/password-reset/complete", json={"email": email, "code": latest_code(email), "password": "Pumps2027yy"})
    assert reset.status_code == 200, reset.text
    assert client.get("/api/v1/auth/me", headers=old_token).status_code == 401
    assert sign_in(email).status_code == 401
    signed_in = sign_in(email, "Pumps2027yy")
    assert signed_in.status_code == 200

    token = {"Authorization": f"Bearer {signed_in.json()['access_token']}"}
    assert client.post("/api/v1/account/password", headers=token, json={"current_password": "nope", "new_password": "Tanks2028zz"}).status_code == 400
    changed = client.post("/api/v1/account/password", headers=token, json={"current_password": "Pumps2027yy", "new_password": "Tanks2028zz"})
    assert changed.status_code == 200
    assert client.get("/api/v1/auth/me", headers=token).status_code == 401
    assert client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {changed.json()['access_token']}"}).status_code == 200


def test_administrator_created_accounts_follow_the_same_rules():
    admin = demo_headers("admin")
    base = {"display_name": "Peter Ochieng", "role": "operations", "section": "", "password": GOOD_PASSWORD}
    assert client.post("/api/v1/users", headers=admin, json={**base, "email": "peter@gmail.com"}).status_code == 422
    assert client.post("/api/v1/users", headers=admin, json={**base, "email": new_email(), "password": "short"}).status_code == 422
    assert client.post("/api/v1/users", headers=admin, json={**base, "email": "demo.operations@kpc.co.ke"}).status_code == 409
    email = f"peter.ochieng.{uuid.uuid4().hex[:6]}@kpc.co.ke"
    assert client.post("/api/v1/users", headers=admin, json={**base, "email": email}).status_code == 201
    assert sign_in(email).status_code == 200
