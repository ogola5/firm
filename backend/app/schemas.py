from __future__ import annotations

from datetime import datetime
from pydantic import BaseModel


class LoginRequest(BaseModel):
    username: str
    password: str


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
    username: str
    display_name: str
    role: str
    section: str = ""
    password: str


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


class ProcedureReviewRequest(BaseModel):
    decision: str
    comments: str = ""


class KnowledgeReuseOutcomeCreate(BaseModel):
    outcome: str
    comments: str = ""


class KnowledgeReuseCreate(BaseModel):
    procedure_update_id: str
