"""What each level sees once signed in: one definition, sent with the account.

The approved role (and section) on a person's account decides their home page,
menu, scope and the things they can do. The browser draws exactly this; it
keeps no role lists of its own. Every API still checks permissions itself, so
editing what the browser holds changes nothing on the server.
"""
from __future__ import annotations

import hashlib

from app.models import User
from app.services.access import role_definition, role_key, user_region

# Short level codes as used at KPC.
LEVELS = {
    "operations": "OPS",
    "systems_automation": "SA",
    "technician_st": "ST",
    "technician_pt": "PT",
    "technician_ct": "CT",
    "assistant_engineer": "AE",
    "engineer": "E",
    "senior_engineer": "SE",
    "chief_engineer": "CE",
    "maintenance_manager": "MM",
    "general_manager_om": "GM",
    "hr_officer": "HR",
    "managing_director": "MD",
    "supervisor": "SUP",
    "system_administrator": "ADMIN",
}

# Groups used by the analytics and intelligence endpoints too (routers/insights.py).
ANALYTICS_ORG_WIDE = ("maintenance_manager", "general_manager_om", "supervisor", "system_administrator")
ANALYTICS_SECTION_LEADS = ("technician_ct", "chief_engineer")
ANALYTICS_HEADLINE_ONLY = ("managing_director",)
INVESTIGATORS = ("systems_automation", "technician_st", "technician_pt", "assistant_engineer", "engineer",
                 "senior_engineer", "chief_engineer")
SECTION_TECHNICAL = ("systems_automation", "technician_st", "technician_pt", "technician_ct", "assistant_engineer",
                     "engineer", "senior_engineer", "chief_engineer")

# Home page per level: (home key, title, one line on what it is for).
HOMES = {
    "operations": ("my_reports", "My reports", "Faults you reported and where each one is."),
    "systems_automation": ("my_jobs", "My jobs", "New faults to sort first, then your own jobs."),
    "technician_st": ("my_jobs", "My jobs", "Jobs given to you: print the card, go, write it up."),
    "technician_pt": ("my_jobs", "My jobs", "Jobs given to you: print the card, go, write it up."),
    "technician_ct": ("section_oversight", "Section oversight", "Allocate your section's work, review it and sign it off."),
    "assistant_engineer": ("my_jobs", "My jobs", "Jobs in your section that need an engineer."),
    "engineer": ("my_jobs", "My jobs", "Jobs in your section that need an engineer."),
    "senior_engineer": ("my_jobs", "My jobs", "Faults escalated to you from your region first, then your section's jobs."),
    "chief_engineer": ("section_engineering", "Section engineering", "Faults that persist and need you first, then how your section is going across all regions."),
    "maintenance_manager": ("maintenance_overview", "Maintenance overview", "All sections: workload, response and restoration, and recurring problems."),
    "general_manager_om": ("om_overview", "Operations & Maintenance", "How faults move from Operations through each section, and where they wait."),
    "hr_officer": ("workforce", "Workforce overview", "Staff, roles and contribution evidence. No fault details."),
    "managing_director": ("executive", "Executive summary", "Headline figures and trends only."),
    "supervisor": ("supervision", "Supervision", "Procedures waiting for publication and the overall picture."),
    "system_administrator": ("administration", "Administration", "Account requests, accounts and access."),
}


def capabilities(key: str, permissions: list[str]) -> list[str]:
    """What the screens may offer. Each one is also enforced by the matching API."""
    can = set(permissions)
    if key in INVESTIGATORS:
        can.add("jobs.work")
    if key == "technician_ct":
        can.update({"jobs.allocate", "work.signoff"})
    if key in ("technician_ct", "chief_engineer", "supervisor"):
        can.add("procedures.review")
    if key == "supervisor":
        can.add("procedures.publish")
    if key in ANALYTICS_ORG_WIDE:
        can.add("analytics.org")
    if key in ANALYTICS_SECTION_LEADS:
        can.add("analytics.section")
    if key in ANALYTICS_HEADLINE_ONLY:
        can.add("analytics.headline")
    if key in ANALYTICS_ORG_WIDE or key in ANALYTICS_SECTION_LEADS or key in ANALYTICS_HEADLINE_ONLY:
        can.add("reports.view")
    if key in SECTION_TECHNICAL or key in ANALYTICS_ORG_WIDE:
        can.add("similar.view")
    if key == "hr_officer":
        can.add("people.evidence")
    if key == "system_administrator":
        can.add("network.simulator")
    if key in ("maintenance_manager", "general_manager_om", "system_administrator"):
        can.add("people.counts")
    if key in ("maintenance_manager", "general_manager_om", "supervisor", "system_administrator", "hr_officer"):
        can.add("recognition.view")
    if key == "operations":
        can.add("faults.confirm")
    # Knowledge, drawings, recognition and the watch list.
    if key in SECTION_TECHNICAL or key in ANALYTICS_ORG_WIDE or key == "general_manager_om":
        can.update({"watch.view", "expertise.view"})
    if key in SECTION_TECHNICAL:
        can.update({"expertise.contribute", "drawings.report"})
    if key in ("technician_ct", "chief_engineer"):
        can.update({"expertise.review", "drawings.verify"})
    if key == "technician_ct":
        can.add("jobs.adviser")
    if key in ("system_administrator", "maintenance_manager"):
        can.add("drawings.incorporate")
    if key == "system_administrator":
        can.add("drawings.register")
    if key in ("technician_ct", "chief_engineer", "system_administrator", "maintenance_manager", "general_manager_om", "supervisor"):
        can.add("drawings.queue")
    if key == "hr_officer":
        can.update({"points.manage", "expertise.view", "people.retirement"})
    if key in ("hr_officer", "maintenance_manager", "general_manager_om", "supervisor", "system_administrator"):
        can.add("points.view_all")
    if key == "system_administrator":
        can.add("people.retirement")
    # Escalation: CT -> regional Senior Engineer -> section Chief Engineer (services/escalation.py).
    if key in ("senior_engineer", "chief_engineer", "maintenance_manager", "general_manager_om", "supervisor", "system_administrator"):
        can.add("escalations.view")
    # Knowledge library by equipment type (shared across sections and regions).
    if key in SECTION_TECHNICAL or key in ANALYTICS_ORG_WIDE or key == "general_manager_om":
        can.add("library.view")
    if key in ("chief_engineer", "maintenance_manager", "system_administrator"):
        can.add("library.assign_owner")
    if key == "technician_ct":
        can.add("escalate.to_se")
    if key == "senior_engineer":
        can.add("escalate.to_ce")
    if key in ("senior_engineer", "chief_engineer"):
        can.add("escalation.guide")
    return sorted(can)


def menu(key: str, can: set[str]) -> list[dict]:
    """The side menu, in order, with the words each level uses."""
    field = key in INVESTIGATORS
    operator = key == "operations"
    maintenance = key not in ("hr_officer", "managing_director")
    items: list[tuple[str, str]] = []
    if operator and "faults.report" in can:
        items.append(("report", "Report a fault"))
    items.append(("home", HOMES.get(key, ("", "Home", ""))[1]))
    if "escalations.view" in can:
        items.append(("escalations", "Escalations"))
    if can & {"analytics.org", "analytics.section", "analytics.headline"}:
        items.append(("analytics", "Analytics"))
    if "reports.view" in can:
        items.append(("reports", "Reports"))
    if maintenance and "faults.read" in can:
        items.append(("faults", "Find previous work" if field or operator or key == "technician_ct" else "Faults"))
    if maintenance and "equipment.read" in can:
        items.append(("equipment", "Equipment"))
    if "library.view" in can:
        items.append(("library", "Library"))
    if maintenance and "knowledge.read" in can:
        items.append(("knowledge", "Procedures" if field else "Knowledge"))
    if "watch.view" in can:
        items.append(("watch", "Likely to fail"))
    if "expertise.view" in can:
        items.append(("expertise", "Expert knowledge"))
    if "drawings.queue" in can:
        items.append(("drawings", "Drawing differences"))
    if "procedures.review" in can:
        items.append(("approvals", "Procedure review"))
    if "people.manage" in can:
        items.append(("people", "User management"))
    elif "people.read" in can:
        items.append(("people", "People directory"))
    if maintenance:
        items.append(("sync", "Sync"))
    items.append(("recognition", "Recognition" if "points.view_all" in can else "My points & awards"))
    items.append(("account", "My account"))
    return [{"key": item_key, "label": label} for item_key, label in items]


def access_version(user: User) -> str:
    """Changes when the role, section, region or status changes, so the old session stops and the new view loads."""
    basis = f"{role_key(user)}|{user.section}|{user.region or ''}|{user.account_status}|{user.active}"
    return hashlib.sha256(basis.encode()).hexdigest()[:16]


def access_profile(user: User) -> dict:
    key = role_key(user)
    definition = role_definition(user)
    can = capabilities(key, definition["permissions"])
    home, title, purpose = HOMES.get(key, ("none", "Home", "No access has been granted yet."))
    region = user_region(user)
    if region:
        scope = f"{user.section} section, {region} region"
    elif key == "chief_engineer":
        scope = f"{user.section} section, all regions"
    elif definition.get("section_required") or key == "systems_automation":
        scope = f"{user.section or 'Systems Automation'} section"
    elif key == "managing_director":
        scope = "Headline figures for the whole company"
    elif key == "hr_officer":
        scope = "Staff records and contribution evidence"
    elif key == "operations":
        scope = "All equipment (reporting); your own reports"
    else:
        scope = "All sections"
    return {
        "level": LEVELS.get(key, "—"),
        "level_label": definition["label"],
        "home": home,
        "home_title": title,
        "home_purpose": purpose,
        "scope": scope,
        "region": region or "",
        "menu": menu(key, set(can)),
        "can": can,
        "version": access_version(user),
    }
