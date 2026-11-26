from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field


class SyncEventIn(BaseModel):
    """An event queued on a device while offline (see OFFLINE_SYNC_DESIGN.md)."""
    event_id: str = Field(min_length=8, max_length=100)
    fault_id: str | None = Field(default=None, max_length=100)
    event_type: str = Field(max_length=60)
    actor_id: str | None = None
    device_id: str = Field(default="", max_length=100)
    client_timestamp: str = Field(max_length=40)
    sequence_number: int = 0
    # The fault status the device saw when the user acted; used to detect
    # workflow changes made by someone else while the device was offline.
    base_status: str | None = Field(default=None, max_length=40)
    payload: dict = Field(default_factory=dict)


class ConflictResolution(BaseModel):
    decision: Literal["APPLY", "DISCARD"]
    note: str = ""


class LoginRequest(BaseModel):
    email: str
    password: str


class EnrolmentStart(BaseModel):
    email: str
    display_name: str
    staff_number: str
    job_title: str = ""
    requested_role: str
    requested_section: str = ""
    requested_region: str = ""


class EnrolmentVerify(BaseModel):
    email: str
    code: str
    password: str


class EnrolmentDecision(BaseModel):
    role: str = ""
    section: str = ""
    region: str = ""
    reason: str = ""


class EmailOnly(BaseModel):
    email: str


class PasswordResetComplete(BaseModel):
    email: str
    code: str
    password: str


class PasswordChange(BaseModel):
    current_password: str
    new_password: str


class FaultCreate(BaseModel):
    equipment_id: str | None = None
    equipment_confirmed: bool = True
    reported_equipment_text: str = ""
    reported_location: str = ""
    reported_on_behalf_of: str = ""
    category: str = "Unconfirmed"
    symptom: str
    severity: str = "Medium"
    description: str = ""
    operational_impact: str = ""
    operating_conditions: str = ""
    event_id: str | None = None
    # How and when the reporter saw it ("SCADA" or "SITE_WALK"); defaults to now.
    seen_via: Literal["", "SCADA", "SITE_WALK"] = ""
    observed_at: datetime | None = None
    # Someone or something at risk (product leak, smoke, spill): Critical priority.
    safety_hazard: bool = False
    # Answers to the follow-up questions (problem details, state now, actions taken), kept as given.
    report_details: dict = Field(default_factory=dict)
    callback: str = Field(default="", max_length=80)


class VisitAttempt(BaseModel):
    action: str = Field(max_length=2000)
    result: Literal["worked", "failed", "partly"]
    action_type: str = ""  # services/catalogue.ACTION_TYPES


class DrawingDifferenceIn(BaseModel):
    """Something on site that differs from the drawing (cable moved, relay swapped, link fitted…)."""
    description: str = Field(max_length=2000)
    drawing_number: str = Field(default="", max_length=120)
    permanence: Literal["PERMANENT", "TEMPORARY"] = "PERMANENT"


class VisitCreate(BaseModel):
    """One site visit, written up afterwards from the technician's notes."""
    on_site_at: datetime
    back_in_service_at: datetime | None = None
    found: str = Field(max_length=2000)
    cause_category: str = ""  # services/catalogue.CAUSE_CATEGORIES
    drawing_difference: DrawingDifferenceIn | None = None
    attempts: list[VisitAttempt] = Field(min_length=1, max_length=20)
    parts: str = Field(default="", max_length=2000)
    notes: str = Field(default="", max_length=4000)
    workaround: bool = False
    request_signoff: bool = False


class KnowledgeCreate(BaseModel):
    equipment_id: str | None = None
    title: str
    symptom: str
    confirmed_cause: str
    diagnostic_procedure: str
    corrective_action: str
    safety: str = ""
    source_type: str = "FAULT_DERIVED"
    instruction_type: str = "Work procedure"
    usage_scope: str = ""
    legacy_reference: str = ""
    step_by_step: str = ""


class TriageRequest(BaseModel):
    assigned_section: str
    triage_comment: str = ""
    confirmed_equipment_id: str | None = None


class SectionEscalationCreate(BaseModel):
    next_section: str
    findings: str
    recommendation: str


class AssignmentAllocationRequest(BaseModel):
    assigned_user_id: str | None = None
    severity: str
    response_due_at: datetime | None = None
    instructions: str = ""


class AssignmentReviewRequest(BaseModel):
    decision: str
    comments: str = ""


class AvailabilityUpdate(BaseModel):
    availability_status: str


class CompetenciesUpdate(BaseModel):
    competencies: list[str]


class OperatorUpdateCreate(BaseModel):
    note: str


class OperatorConfirmationCreate(BaseModel):
    confirmed: bool
    comments: str = ""


class UserCreate(BaseModel):
    email: str
    display_name: str
    staff_number: str = ""
    job_title: str = ""
    role: str
    section: str = ""
    region: str = ""
    password: str


class UserAccessUpdate(BaseModel):
    role: str
    section: str = ""
    region: str = ""


class UserStatusUpdate(BaseModel):
    active: bool


class DiagnosisCreate(BaseModel):
    possible_cause: str
    diagnostic_method: str
    observations: str = ""
    test_results: str = ""
    confidence: float | None = None
    quick_check: str = ""
    fix_summary: str = ""
    workaround: bool = False
    risk_level: str = "Normal"


class InterventionCreate(BaseModel):
    diagnosis_id: str | None = None
    corrective_action: str
    tools_materials: str = ""
    outcome: str
    notes: str = ""


class ProcedureUpdateCreate(BaseModel):
    title: str
    observed_symptom: str
    confirmed_cause: str
    diagnostic_procedure: str
    corrective_action: str
    safety: str = ""
    tools_materials: str = ""
    # Adds to an existing approved procedure (a new version credited to this author) instead of starting a new one.
    builds_on_id: str = ""
    # What changed and why (required for a revision or an improvement to an existing procedure).
    change_reason: str = ""


class ProcedureReviewRequest(BaseModel):
    decision: str
    comments: str = ""


class KnowledgeReuseOutcomeCreate(BaseModel):
    outcome: str
    comments: str = ""


class KnowledgeReuseCreate(BaseModel):
    procedure_update_id: str
