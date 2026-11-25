from __future__ import annotations

from fastapi import HTTPException
from typing import Optional
import json

from app.models import Equipment, Fault, FaultAssignment, User

SECTIONS = ("Systems Automation", "Electrical", "Instrumentation", "Mechanical")
REGIONS = ("Western", "Nairobi", "Coast")
# Illustrative: the region each demonstration pump station belongs to.
STATION_REGIONS = {"PS01": "Coast", "PS02": "Nairobi", "PS04": "Nairobi", "DEPOT01": "Western"}
# Staff who work in one region of their section. The Chief Engineer covers the whole section.
REGIONAL_ROLES = ("technician_st", "technician_pt", "technician_ct", "assistant_engineer", "engineer", "senior_engineer")


def user_region(user: User) -> str | None:
    """The region this person is limited to, or None (whole section or company-wide)."""
    return user.region if role_key(user) in REGIONAL_ROLES and user.region else None


def check_region(role: str, section: str, region: str) -> str:
    """Regional staff (ST to SE) belong to one region; everyone else has none."""
    from fastapi import HTTPException
    if role in REGIONAL_ROLES and section:
        if region not in REGIONS:
            raise HTTPException(status_code=422, detail="Choose the region: " + ", ".join(REGIONS))
        return region
    return ""


def region_allows(user: User, equipment_region: str | None) -> bool:
    """Unidentified assets (no region yet) stay visible to the whole section until identified."""
    region = user_region(user)
    return region is None or not equipment_region or equipment_region == region


def region_filter(user: User):
    """SQL condition on Equipment.region for this person, or None."""
    region = user_region(user)
    if region is None:
        return None
    return (Equipment.region == region) | (Equipment.region == "")


ACTIVE_ASSIGNMENT_STATUSES = ("OPEN", "ACKNOWLEDGED", "IN_PROGRESS")


ROLE_DEFINITIONS = {
    "operations": {"label": "Operations", "scope": "fault reporting, progress, evidence and restoration confirmation", "permissions": ["faults.read", "faults.report", "faults.confirm", "equipment.read"]},
    "systems_automation": {"label": "Systems Automation", "scope": "all fault triage; Systems Automation section work", "permissions": ["faults.read", "faults.triage", "faults.update", "faults.restore", "equipment.read", "knowledge.read", "knowledge.contribute"]},
    "technician_st": {"label": "Senior Technician (ST)", "scope": "assigned section; shared technician work pool", "section_required": True, "permissions": ["faults.read", "faults.report", "faults.update", "faults.restore", "equipment.read", "knowledge.read", "knowledge.contribute"]},
    "technician_pt": {"label": "Principal Technician (PT)", "scope": "assigned section", "section_required": True, "permissions": ["faults.read", "faults.report", "faults.update", "faults.restore", "equipment.read", "knowledge.read", "knowledge.contribute"]},
    "technician_ct": {"label": "Chief Technician (CT)", "scope": "assigned section; technical supervision, work allocation and review", "section_required": True, "permissions": ["faults.read", "faults.report", "faults.triage.section", "faults.assign", "faults.review", "team.read", "team.manage", "equipment.read", "knowledge.read", "knowledge.contribute"]},
    "assistant_engineer": {"label": "Assistant Engineer", "scope": "assigned section", "section_required": True, "permissions": ["faults.read", "faults.report", "faults.update", "equipment.read", "knowledge.read", "knowledge.contribute"]},
    "engineer": {"label": "Engineer", "scope": "assigned section", "section_required": True, "permissions": ["faults.read", "faults.report", "faults.update", "equipment.read", "knowledge.read", "knowledge.contribute"]},
    "senior_engineer": {"label": "Senior Engineer", "scope": "assigned section; restoration authority", "section_required": True, "permissions": ["faults.read", "faults.report", "faults.update", "faults.restore", "equipment.read", "knowledge.read", "knowledge.contribute"]},
    "chief_engineer": {"label": "Chief Engineer", "scope": "assigned section; section technical oversight", "section_required": True, "permissions": ["faults.read", "faults.report", "faults.update", "faults.restore", "faults.close", "faults.triage.section", "equipment.read", "knowledge.read", "knowledge.contribute"]},
    "maintenance_manager": {"label": "Maintenance Manager", "scope": "all maintenance sections and detailed maintenance dashboards", "permissions": ["faults.read", "faults.report", "faults.triage", "faults.update", "equipment.read", "knowledge.read", "knowledge.contribute", "knowledge.approve", "analytics.detail"]},
    "hr_officer": {"label": "HR Officer", "scope": "user roster and role/section status only; no fault or equipment details", "permissions": ["people.read"]},
    "general_manager_om": {"label": "General Manager, Operations & Maintenance", "scope": "all maintenance and operations records and detailed dashboards", "permissions": ["faults.read", "faults.report", "faults.triage", "faults.update", "equipment.read", "knowledge.read", "analytics.detail", "people.summary"]},
    "managing_director": {"label": "Managing Director / CEO", "scope": "enterprise-level summary KPIs only; no individual fault or employee records", "permissions": ["analytics.executive"]},
    "supervisor": {"label": "Supervisor", "scope": "all maintenance records and knowledge review", "permissions": ["faults.read", "faults.triage", "faults.update", "equipment.read", "knowledge.read", "knowledge.approve", "analytics.detail"]},
    "system_administrator": {"label": "System Administrator", "scope": "system configuration and demo data; operational approvals remain separate", "permissions": ["people.read", "people.manage", "faults.read", "faults.report", "faults.triage", "faults.update", "equipment.read", "knowledge.read", "analytics.detail"]},
}


# What each permission lets a person do, in the words shown on "My account".
PERMISSION_TEXT = {
    "faults.read": "See faults and their history within your scope",
    "faults.report": "Report a fault",
    "faults.confirm": "Confirm that equipment is working again after a repair",
    "faults.triage": "Sort new faults and send them to the right section",
    "faults.triage.section": "Pass faults on between sections",
    "faults.update": "Record visits, findings and what was tried",
    "faults.restore": "Mark equipment as back in service",
    "faults.close": "Close finished faults",
    "faults.assign": "Give jobs to technicians in your section",
    "faults.review": "Sign off your section's completed work",
    "team.read": "See your section's team and who is available",
    "team.manage": "Change your team members' availability",
    "equipment.read": "Look up equipment",
    "knowledge.read": "Read approved procedures",
    "knowledge.contribute": "Draft procedures from your work",
    "knowledge.approve": "Approve procedures for publication",
    "analytics.detail": "See detailed analytics and trends",
    "analytics.executive": "See the headline figures and trends",
    "people.read": "See the staff directory (names, roles, sections)",
    "people.manage": "Approve account requests and manage accounts",
    "people.summary": "See workforce counts",
}


def permission_descriptions(permissions: list[str]) -> list[str]:
    return [PERMISSION_TEXT.get(item, item) for item in permissions]


LEGACY_ROLE_ALIASES = {
    "Operations": "operations",
    "Systems Automation": "systems_automation",
    "Electrical": "technician_st",
    "Instrumentation": "technician_st",
    "Mechanical": "technician_st",
    "Supervisor": "supervisor",
    "System Administrator": "system_administrator",
    "Management": "general_manager_om",
    "management": "managing_director",
}


def role_key(user: User) -> str:
    return LEGACY_ROLE_ALIASES.get(user.role, user.role)


def role_definition(user: User) -> dict:
    return ROLE_DEFINITIONS.get(role_key(user), {"label": user.role, "scope": "no access", "permissions": []})


def require_roles(user: User, *roles: str) -> None:
    if role_key(user) not in roles:
        raise HTTPException(status_code=403, detail="This role does not have permission for this action")


def current_assignment(fault: Fault) -> Optional[FaultAssignment]:
    return next(
        (item for item in reversed(fault.assignments) if item.status in ACTIVE_ASSIGNMENT_STATUSES),
        None,
    )


def require_current_assignment(user: User, fault: Fault) -> Optional[FaultAssignment]:
    assignment = current_assignment(fault)
    if assignment is None:
        return None
    key = role_key(user)
    if key == "systems_automation" and assignment.section != "Systems Automation":
        raise HTTPException(status_code=404, detail="Fault not found")
    if key in (
        "technician_st", "technician_pt", "technician_ct", "assistant_engineer",
        "engineer", "senior_engineer", "chief_engineer",
    ) and assignment.section != user.section:
        raise HTTPException(status_code=404, detail="Fault not found")
    if key in ASSIGNABLE_TECHNICIAN_ROLES and not assignment.assigned_user_id:
        raise HTTPException(status_code=409, detail="This section assignment is awaiting Chief Technician allocation")
    if assignment.assigned_user_id and assignment.assigned_user_id != user.id and (
        key == "systems_automation" or key in TECHNICAL_ROLES
    ):
        raise HTTPException(status_code=409, detail="This section assignment is owned by another employee")
    return assignment


def require_fault_scope(user: User, fault: Fault) -> None:
    key = role_key(user)
    if key in ("hr_officer", "managing_director", "management"):
        raise HTTPException(status_code=403, detail="This role cannot view individual fault records")
    if key in ("technician_st", "technician_pt", "technician_ct", "assistant_engineer", "engineer", "senior_engineer", "chief_engineer"):
        equipment = fault.equipment or None
        has_section_assignment = any(item.section == user.section for item in fault.assignments)
        if fault.assigned_section != user.section and (not equipment or equipment.section != user.section) and not has_section_assignment:
            raise HTTPException(status_code=404, detail="Fault not found")
        if not region_allows(user, equipment.region if equipment else ""):
            raise HTTPException(status_code=404, detail="Fault not found")


def require_equipment_scope(user: User, equipment: Equipment) -> None:
    key = role_key(user)
    if key in ("hr_officer", "managing_director", "management"):
        raise HTTPException(status_code=403, detail="This role cannot view equipment records")
    if key in ("technician_st", "technician_pt", "technician_ct", "assistant_engineer", "engineer", "senior_engineer", "chief_engineer"):
        if equipment.section != user.section or not region_allows(user, equipment.region):
            raise HTTPException(status_code=404, detail="Equipment not found")


def user_payload(user: User) -> dict:
    return {
        "id": user.id,
        "username": user.username,
        "email": user.email,
        "display_name": user.display_name,
        "role": role_key(user),
        "role_label": role_definition(user)["label"],
        "section": user.section,
        "region": user.region,
        "active": bool(user.active),
        "availability_status": user.availability_status,
        "competencies": json.loads(user.competencies or "[]"),
        "permissions": role_definition(user)["permissions"],
        "visibility_scope": role_definition(user)["scope"],
        # Home, menu and abilities for this account's level (services/workspace.py).
        "access": _access_profile(user),
    }


def _access_profile(user: User) -> dict:
    from app.services.workspace import access_profile  # workspace builds on this module

    return access_profile(user)


TECHNICAL_ROLES = (
    "systems_automation", "technician_st", "technician_pt", "technician_ct", "assistant_engineer",
    "engineer", "senior_engineer", "chief_engineer",
)


INVESTIGATION_ROLES = (
    "systems_automation", "technician_st", "technician_pt", "assistant_engineer",
    "engineer", "senior_engineer", "chief_engineer",
)


ASSIGNABLE_TECHNICIAN_ROLES = ("technician_st", "technician_pt")


PROCEDURE_AUTHOR_ROLES = TECHNICAL_ROLES + ("maintenance_manager", "supervisor")
