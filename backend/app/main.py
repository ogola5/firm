from __future__ import annotations

import os
import json
import uuid
from statistics import median
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Optional

import bcrypt
from fastapi import Depends, FastAPI, File, Header, HTTPException, Query, UploadFile, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from jose import JWTError, jwt
from pydantic import BaseModel
from sqlalchemy import Column, DateTime, Float, ForeignKey, Integer, String, Text, create_engine, select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column, relationship, sessionmaker

DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./kpc.db")
SECRET = os.getenv("DEMO_JWT_SECRET", "synthetic-demo-only-change-in-production")
ATTACHMENT_STORAGE_DIR = Path(__file__).resolve().parents[1] / "storage" / "attachments"
MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024
ALLOWED_ATTACHMENT_TYPES = {
    ".csv": "text/csv",
    ".jpeg": "image/jpeg",
    ".jpg": "image/jpeg",
    ".json": "application/json",
    ".log": "text/plain",
    ".pdf": "application/pdf",
    ".png": "image/png",
    ".txt": "text/plain",
    ".webp": "image/webp",
}
engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {})
SessionLocal = sessionmaker(bind=engine, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def utc_datetime(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


class User(Base):
    __tablename__ = "users"
    id: Mapped[str] = mapped_column(String, primary_key=True)
    username: Mapped[str] = mapped_column(String, unique=True)
    display_name: Mapped[str] = mapped_column(String)
    role: Mapped[str] = mapped_column(String)
    section: Mapped[str] = mapped_column(String, default="")
    password_hash: Mapped[str] = mapped_column(String)
    active: Mapped[int] = mapped_column(Integer, default=1)
    availability_status: Mapped[str] = mapped_column(String, default="AVAILABLE")
    competencies: Mapped[str] = mapped_column(Text, default="[]")


class UserAudit(Base):
    __tablename__ = "user_audit"
    id: Mapped[str] = mapped_column(String, primary_key=True)
    actor_id: Mapped[str] = mapped_column(String)
    action: Mapped[str] = mapped_column(String)
    target_user_id: Mapped[str] = mapped_column(String)
    details: Mapped[str] = mapped_column(Text, default="{}")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


SECTIONS = ("Systems Automation", "Electrical", "Instrumentation", "Mechanical")
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


def require_equipment_scope(user: User, equipment: Equipment) -> None:
    key = role_key(user)
    if key in ("hr_officer", "managing_director", "management"):
        raise HTTPException(status_code=403, detail="This role cannot view equipment records")
    if key in ("technician_st", "technician_pt", "technician_ct", "assistant_engineer", "engineer", "senior_engineer", "chief_engineer"):
        if equipment.section != user.section:
            raise HTTPException(status_code=404, detail="Equipment not found")


def user_payload(user: User) -> dict:
    return {
        "id": user.id,
        "username": user.username,
        "display_name": user.display_name,
        "role": role_key(user),
        "role_label": role_definition(user)["label"],
        "section": user.section,
        "active": bool(user.active),
        "availability_status": user.availability_status,
        "competencies": json.loads(user.competencies or "[]"),
        "permissions": role_definition(user)["permissions"],
        "visibility_scope": role_definition(user)["scope"],
    }


class Equipment(Base):
    __tablename__ = "equipment"
    id: Mapped[str] = mapped_column(String, primary_key=True)
    tag: Mapped[str] = mapped_column(String, unique=True)
    name: Mapped[str] = mapped_column(String)
    category: Mapped[str] = mapped_column(String)
    station: Mapped[str] = mapped_column(String)
    location: Mapped[str] = mapped_column(String)
    section: Mapped[str] = mapped_column(String)
    criticality: Mapped[str] = mapped_column(String)
    operational_status: Mapped[str] = mapped_column(String, default="Operational")
    manufacturer: Mapped[str] = mapped_column(String, default="Illustrative OEM")
    model: Mapped[str] = mapped_column(String, default="Demo Model")
    description: Mapped[str] = mapped_column(Text, default="")


class Fault(Base):
    __tablename__ = "faults"
    id: Mapped[str] = mapped_column(String, primary_key=True)
    reference: Mapped[str] = mapped_column(String, unique=True)
    equipment_id: Mapped[str] = mapped_column(ForeignKey("equipment.id"))
    reporter_id: Mapped[str] = mapped_column(ForeignKey("users.id"))
    category: Mapped[str] = mapped_column(String)
    symptom: Mapped[str] = mapped_column(String)
    severity: Mapped[str] = mapped_column(String)
    description: Mapped[str] = mapped_column(Text)
    operational_impact: Mapped[str] = mapped_column(String, default="")
    operating_conditions: Mapped[str] = mapped_column(Text, default="")
    status: Mapped[str] = mapped_column(String, default="REPORTED")
    assigned_section: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    acknowledged_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    restored_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    equipment_confirmed: Mapped[int] = mapped_column(Integer, default=1)
    reported_equipment_text: Mapped[str] = mapped_column(Text, default="")
    reported_location: Mapped[str] = mapped_column(Text, default="")
    raised_by_text: Mapped[str] = mapped_column(String, default="")
    suggested_equipment_id: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    assigned_user_id: Mapped[Optional[str]] = mapped_column(ForeignKey("users.id"), nullable=True)
    closure_remarks: Mapped[str] = mapped_column(Text, default="")
    equipment = relationship("Equipment")
    reporter = relationship("User", foreign_keys=[reporter_id])
    assigned_user = relationship("User", foreign_keys=[assigned_user_id])
    assignments = relationship("FaultAssignment", back_populates="fault", order_by="FaultAssignment.created_at")
    attachments = relationship("FaultAttachment", back_populates="fault", order_by="FaultAttachment.created_at")


class FaultEvent(Base):
    __tablename__ = "fault_events"
    id: Mapped[str] = mapped_column(String, primary_key=True)
    fault_id: Mapped[str] = mapped_column(ForeignKey("faults.id"))
    event_type: Mapped[str] = mapped_column(String)
    actor_id: Mapped[str] = mapped_column(String)
    payload: Mapped[str] = mapped_column(Text, default="{}")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class FaultAssignment(Base):
    __tablename__ = "fault_assignments"
    id: Mapped[str] = mapped_column(String, primary_key=True)
    fault_id: Mapped[str] = mapped_column(ForeignKey("faults.id"))
    section: Mapped[str] = mapped_column(String)
    assigned_by_id: Mapped[str] = mapped_column(ForeignKey("users.id"))
    assigned_user_id: Mapped[Optional[str]] = mapped_column(ForeignKey("users.id"), nullable=True)
    previous_assignment_id: Mapped[Optional[str]] = mapped_column(ForeignKey("fault_assignments.id"), nullable=True)
    reason: Mapped[str] = mapped_column(Text, default="")
    findings: Mapped[str] = mapped_column(Text, default="")
    recommendation: Mapped[str] = mapped_column(Text, default="")
    instructions: Mapped[str] = mapped_column(Text, default="")
    response_due_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    escalation_status: Mapped[str] = mapped_column(String, default="NONE")
    requested_next_section: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    escalation_review_comments: Mapped[str] = mapped_column(Text, default="")
    completion_review_status: Mapped[str] = mapped_column(String, default="NONE")
    completion_review_comments: Mapped[str] = mapped_column(Text, default="")
    review_previous_fault_status: Mapped[str] = mapped_column(String, default="")
    status: Mapped[str] = mapped_column(String, default="OPEN")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    acknowledged_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    completed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    fault = relationship("Fault", back_populates="assignments")
    assigned_by = relationship("User", foreign_keys=[assigned_by_id])
    assigned_user = relationship("User", foreign_keys=[assigned_user_id])


class FaultAttachment(Base):
    __tablename__ = "fault_attachments"
    id: Mapped[str] = mapped_column(String, primary_key=True)
    fault_id: Mapped[str] = mapped_column(ForeignKey("faults.id"))
    assignment_id: Mapped[Optional[str]] = mapped_column(ForeignKey("fault_assignments.id"), nullable=True)
    uploader_id: Mapped[str] = mapped_column(ForeignKey("users.id"))
    original_filename: Mapped[str] = mapped_column(String)
    storage_key: Mapped[str] = mapped_column(String, unique=True)
    content_type: Mapped[str] = mapped_column(String)
    size_bytes: Mapped[int] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    fault = relationship("Fault", back_populates="attachments")
    uploader = relationship("User")


class Diagnosis(Base):
    __tablename__ = "diagnoses"
    id: Mapped[str] = mapped_column(String, primary_key=True)
    fault_id: Mapped[str] = mapped_column(ForeignKey("faults.id"))
    assignment_id: Mapped[Optional[str]] = mapped_column(ForeignKey("fault_assignments.id"), nullable=True)
    author_id: Mapped[str] = mapped_column(ForeignKey("users.id"))
    possible_cause: Mapped[str] = mapped_column(Text)
    diagnostic_method: Mapped[str] = mapped_column(Text)
    observations: Mapped[str] = mapped_column(Text)
    test_results: Mapped[str] = mapped_column(Text)
    confidence: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    verification_status: Mapped[str] = mapped_column(String, default="UNVERIFIED")
    quick_check: Mapped[str] = mapped_column(Text, default="")
    fix_summary: Mapped[str] = mapped_column(Text, default="")
    workaround: Mapped[int] = mapped_column(Integer, default=0)
    risk_level: Mapped[str] = mapped_column(String, default="Normal")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class Intervention(Base):
    __tablename__ = "interventions"
    id: Mapped[str] = mapped_column(String, primary_key=True)
    fault_id: Mapped[str] = mapped_column(ForeignKey("faults.id"))
    assignment_id: Mapped[Optional[str]] = mapped_column(ForeignKey("fault_assignments.id"), nullable=True)
    diagnosis_id: Mapped[Optional[str]] = mapped_column(ForeignKey("diagnoses.id"), nullable=True)
    actor_id: Mapped[str] = mapped_column(ForeignKey("users.id"))
    corrective_action: Mapped[str] = mapped_column(Text)
    tools_materials: Mapped[str] = mapped_column(Text, default="")
    outcome: Mapped[str] = mapped_column(String)
    notes: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class KnowledgeEntry(Base):
    __tablename__ = "knowledge_entries"
    id: Mapped[str] = mapped_column(String, primary_key=True)
    reference: Mapped[str] = mapped_column(String, unique=True)
    equipment_id: Mapped[Optional[str]] = mapped_column(ForeignKey("equipment.id"), nullable=True)
    title: Mapped[str] = mapped_column(String)
    symptom: Mapped[str] = mapped_column(String)
    confirmed_cause: Mapped[str] = mapped_column(Text)
    diagnostic_procedure: Mapped[str] = mapped_column(Text)
    corrective_action: Mapped[str] = mapped_column(Text)
    safety: Mapped[str] = mapped_column(Text, default="")
    status: Mapped[str] = mapped_column(String, default="DRAFT")
    author_id: Mapped[str] = mapped_column(String)
    version: Mapped[int] = mapped_column(Integer, default=1)
    source_type: Mapped[str] = mapped_column(String, default="FAULT_DERIVED")
    instruction_type: Mapped[str] = mapped_column(String, default="Work procedure")
    usage_scope: Mapped[str] = mapped_column(String, default="")
    legacy_reference: Mapped[str] = mapped_column(String, default="")
    step_by_step: Mapped[str] = mapped_column(Text, default="")
    review_status: Mapped[str] = mapped_column(String, default="LEGACY_APPROVED")
    superseded_by_id: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class ProcedureUpdate(Base):
    __tablename__ = "procedure_updates"
    id: Mapped[str] = mapped_column(String, primary_key=True)
    reference: Mapped[str] = mapped_column(String, unique=True)
    fault_id: Mapped[str] = mapped_column(ForeignKey("faults.id"))
    author_id: Mapped[str] = mapped_column(ForeignKey("users.id"))
    section: Mapped[str] = mapped_column(String)
    title: Mapped[str] = mapped_column(String)
    observed_symptom: Mapped[str] = mapped_column(Text)
    confirmed_cause: Mapped[str] = mapped_column(Text)
    diagnostic_procedure: Mapped[str] = mapped_column(Text)
    corrective_action: Mapped[str] = mapped_column(Text)
    safety: Mapped[str] = mapped_column(Text, default="")
    version: Mapped[int] = mapped_column(Integer, default=1)
    lineage_id: Mapped[str] = mapped_column(String)
    previous_update_id: Mapped[Optional[str]] = mapped_column(ForeignKey("procedure_updates.id"), nullable=True)
    status: Mapped[str] = mapped_column(String, default="SUBMITTED")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class ProcedureReview(Base):
    __tablename__ = "procedure_reviews"
    id: Mapped[str] = mapped_column(String, primary_key=True)
    procedure_update_id: Mapped[str] = mapped_column(ForeignKey("procedure_updates.id"))
    reviewer_id: Mapped[str] = mapped_column(ForeignKey("users.id"))
    decision: Mapped[str] = mapped_column(String)
    comments: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    reviewer = relationship("User")


class KnowledgeReuse(Base):
    __tablename__ = "knowledge_reuse"
    id: Mapped[str] = mapped_column(String, primary_key=True)
    procedure_update_id: Mapped[str] = mapped_column(ForeignKey("procedure_updates.id"))
    fault_id: Mapped[str] = mapped_column(ForeignKey("faults.id"))
    actor_id: Mapped[str] = mapped_column(ForeignKey("users.id"))
    used_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class KnowledgeReuseOutcome(Base):
    __tablename__ = "knowledge_reuse_outcomes"
    reuse_id: Mapped[str] = mapped_column(ForeignKey("knowledge_reuse.id"), primary_key=True)
    actor_id: Mapped[str] = mapped_column(ForeignKey("users.id"))
    outcome: Mapped[str] = mapped_column(String)
    comments: Mapped[str] = mapped_column(Text, default="")
    confirmed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class SyncEvent(Base):
    __tablename__ = "sync_events"
    event_id: Mapped[str] = mapped_column(String, primary_key=True)
    fault_id: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    event_type: Mapped[str] = mapped_column(String)
    actor_id: Mapped[str] = mapped_column(String)
    payload: Mapped[str] = mapped_column(Text)
    client_timestamp: Mapped[str] = mapped_column(String)
    received_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


Base.metadata.create_all(engine)


def ensure_fault_workbench_columns() -> None:
    if not DATABASE_URL.startswith("sqlite"):
        return
    with engine.begin() as connection:
        table_additions = {
            "faults": {
                "equipment_confirmed": "INTEGER DEFAULT 1",
                "reported_equipment_text": "TEXT DEFAULT ''",
                "reported_location": "TEXT DEFAULT ''",
                "raised_by_text": "VARCHAR DEFAULT ''",
                "suggested_equipment_id": "VARCHAR",
                "assigned_user_id": "VARCHAR",
                "operating_conditions": "TEXT DEFAULT ''",
                "closure_remarks": "TEXT DEFAULT ''",
            },
            "users": {
                "availability_status": "VARCHAR DEFAULT 'AVAILABLE'",
                "competencies": "TEXT DEFAULT '[]'",
            },
            "fault_assignments": {
                "instructions": "TEXT DEFAULT ''",
                "response_due_at": "DATETIME",
                "escalation_status": "VARCHAR DEFAULT 'NONE'",
                "requested_next_section": "VARCHAR",
                "escalation_review_comments": "TEXT DEFAULT ''",
                "completion_review_status": "VARCHAR DEFAULT 'NONE'",
                "completion_review_comments": "TEXT DEFAULT ''",
                "review_previous_fault_status": "VARCHAR DEFAULT ''",
            },
            "diagnoses": {"assignment_id": "VARCHAR"},
            "interventions": {"assignment_id": "VARCHAR"},
        }
        for table, additions in table_additions.items():
            columns = {row[1] for row in connection.exec_driver_sql(f"PRAGMA table_info({table})").fetchall()}
            for name, definition in additions.items():
                if name not in columns:
                    connection.exec_driver_sql(f"ALTER TABLE {table} ADD COLUMN {name} {definition}")


ensure_fault_workbench_columns()


def ensure_knowledge_legacy_columns() -> None:
    if not DATABASE_URL.startswith("sqlite"):
        return
    with engine.begin() as connection:
        columns = {row[1] for row in connection.exec_driver_sql("PRAGMA table_info(knowledge_entries)").fetchall()}
        additions = {
            "source_type": "VARCHAR DEFAULT 'FAULT_DERIVED'",
            "instruction_type": "VARCHAR DEFAULT 'Work procedure'",
            "usage_scope": "VARCHAR DEFAULT ''",
            "legacy_reference": "VARCHAR DEFAULT ''",
            "step_by_step": "TEXT DEFAULT ''",
            "review_status": "VARCHAR DEFAULT 'LEGACY_APPROVED'",
            "superseded_by_id": "VARCHAR",
        }
        for name, definition in additions.items():
            if name not in columns:
                connection.exec_driver_sql(
                    f"ALTER TABLE knowledge_entries ADD COLUMN {name} {definition}"
                )
        # Backfill the prototype's original approved library entries as legacy
        # operating instructions. The existing database predates source_type.
        legacy_steps = "\n".join([
            "1. Verify the applicable work permit and isolate the equipment or tool.",
            "2. Inspect the external indicators and compare them with the approved normal setting.",
            "3. Follow the fault-specific test sequence and record each result.",
            "4. Apply the approved corrective action without bypassing interlocks.",
            "5. Return the equipment to service and verify stable operation.",
        ])
        connection.exec_driver_sql(
            """
            UPDATE knowledge_entries
            SET source_type = 'LEGACY_PROCEDURE',
                instruction_type = 'Legacy operating work instruction',
                usage_scope = COALESCE(usage_scope, ''),
                legacy_reference = CASE
                    WHEN legacy_reference IS NULL OR legacy_reference = ''
                    THEN 'LEGACY-REF-' || substr('0000' || substr(id, 6, 4), -4)
                    ELSE legacy_reference
                END,
                step_by_step = CASE
                    WHEN step_by_step IS NULL OR step_by_step = ''
                    THEN :legacy_steps
                    ELSE step_by_step
                END,
                review_status = CASE
                    WHEN status = 'APPROVED' THEN 'LEGACY_APPROVED'
                    WHEN status = 'REJECTED' THEN 'LEGACY_REJECTED'
                    ELSE 'LEGACY_SUBMITTED'
                END
            WHERE id LIKE 'KNOW-%' AND CAST(substr(id, 6) AS INTEGER) <= 24
            """,
            {"legacy_steps": legacy_steps},
        )


ensure_knowledge_legacy_columns()


def ensure_troubleshooting_columns() -> None:
    if not DATABASE_URL.startswith("sqlite"):
        return
    with engine.begin() as connection:
        columns = {row[1] for row in connection.exec_driver_sql("PRAGMA table_info(diagnoses)").fetchall()}
        additions = {
            "quick_check": "TEXT DEFAULT ''",
            "fix_summary": "TEXT DEFAULT ''",
            "workaround": "INTEGER DEFAULT 0",
            "risk_level": "VARCHAR DEFAULT 'Normal'",
        }
        for name, definition in additions.items():
            if name not in columns:
                connection.exec_driver_sql(f"ALTER TABLE diagnoses ADD COLUMN {name} {definition}")


ensure_troubleshooting_columns()


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


app = FastAPI(title="KPC Maintenance Prototype", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def db_dep():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def current_user(authorization: str = Header(default=""), db: Session = Depends(db_dep)):
    if not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing demo session")
    token = authorization[7:]
    try:
        payload = jwt.decode(token, SECRET, algorithms=["HS256"])
        user = db.get(User, payload["sub"])
        if not user or not user.active:
            raise HTTPException(status_code=401, detail="Inactive or invalid demo session")
        return user
    except JWTError as exc:
        raise HTTPException(status_code=401, detail="Invalid demo session") from exc


def add_event(db: Session, fault_id: str, event_type: str, actor_id: str, payload: dict, created_at: datetime | None = None):
    db.add(FaultEvent(
        id=str(uuid.uuid4()),
        fault_id=fault_id,
        event_type=event_type,
        actor_id=actor_id,
        payload=json.dumps(payload),
        created_at=created_at or utcnow(),
    ))


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


def procedure_update_payload(item: ProcedureUpdate, author: User | None = None, reviews: list[ProcedureReview] | None = None) -> dict:
    return {
        "id": item.id,
        "reference": item.reference,
        "fault_id": item.fault_id,
        "section": item.section,
        "author_id": item.author_id,
        "author_name": author.display_name if author else "",
        "title": item.title,
        "observed_symptom": item.observed_symptom,
        "confirmed_cause": item.confirmed_cause,
        "diagnostic_procedure": item.diagnostic_procedure,
        "corrective_action": item.corrective_action,
        "safety": item.safety,
        "version": item.version,
        "lineage_id": item.lineage_id,
        "previous_update_id": item.previous_update_id,
        "status": item.status,
        "created_at": item.created_at.isoformat(),
        "reviews": [
            {
                "decision": review.decision,
                "comments": review.comments,
                "reviewer_id": review.reviewer_id,
                "reviewer_name": review.reviewer.display_name if hasattr(review, "reviewer") and review.reviewer else review.reviewer_id,
                "created_at": review.created_at.isoformat(),
            }
            for review in (reviews or [])
        ],
    }


def audit_user_change(db: Session, actor_id: str, action: str, target: User, details: dict) -> None:
    db.add(UserAudit(
        id=str(uuid.uuid4()),
        actor_id=actor_id,
        action=action,
        target_user_id=target.id,
        details=json.dumps(details),
    ))


@app.on_event("startup")
def seed_database():
    db = SessionLocal()
    if db.query(User).count() == 0:
        roles = [
            ("operations", "Operations"),
            ("automation", "Systems Automation"),
            ("electrical", "Electrical"),
            ("instrumentation", "Instrumentation"),
            ("mechanical", "Mechanical"),
            ("supervisor", "Supervisor"),
            ("management", "Management"),
            ("admin", "System Administrator"),
        ]
        for username, role in roles:
            db.add(User(
                id=f"USER-{username}",
                username=username,
                display_name=f"Demo {role} User",
                role=role,
                section=role if role in ("Electrical", "Instrumentation", "Mechanical") else "",
                password_hash=bcrypt.hashpw(b"demo123", bcrypt.gensalt()).decode(),
            ))

        stations = ["PS01", "PS02", "DEPOT01"]
        tags = ["10A-MOV-201", "PUMP-101", "VFD-101", "PLC-101", "RTU-201", "LT-301", "TX-201"]
        categories = ["Automation", "Mechanical", "Electrical", "Instrumentation"]
        sections = ["Systems Automation", "Mechanical", "Electrical", "Instrumentation"]
        for i in range(30):
            tag = tags[i] if i < len(tags) else f"DEMO-{i + 1:03d}"
            category = categories[i % len(categories)]
            db.add(Equipment(
                id=f"EQ-{i + 1:03d}",
                tag=tag,
                name=f"Synthetic {category} asset {i + 1}",
                category=category,
                station=stations[i % len(stations)],
                location=f"Area {chr(65 + i % 5)}-{i % 10 + 1}",
                section=sections[i % len(sections)],
                criticality=["Low", "Medium", "High", "Critical"][i % 4],
                description="Illustrative demonstration asset; not a real KPC operational record.",
            ))
        db.commit()

        first_equipment = db.query(Equipment).all()[0]
        for i in range(105):
            equipment = db.query(Equipment).filter(Equipment.id == f"EQ-{(i % 30) + 1:03d}").one()
            status_name = ["REPORTED", "TRIAGED", "ASSIGNED", "ACKNOWLEDGED", "ON_SITE", "DIAGNOSED", "RESTORED", "CLOSED"][i % 8]
            date = utcnow() - timedelta(days=i % 180)
            fault = Fault(
                id=f"FAULT-{i + 1:05d}",
                reference=f"KPC-DMO-{i + 1:05d}",
                equipment_id=equipment.id,
                reporter_id="USER-operations",
                category=equipment.category,
                symptom=["Intermittent alarm", "Unexpected trip", "Unstable reading", "Failure to start"][i % 4],
                severity=["Low", "Medium", "High", "Critical"][i % 4],
                description="Synthetic demonstration fault record.",
                status=status_name,
                assigned_section=equipment.section,
                created_at=date,
                acknowledged_at=date + timedelta(minutes=35) if i % 3 else None,
                restored_at=date + timedelta(hours=4) if status_name in ("RESTORED", "CLOSED") else None,
            )
            db.add(fault)
            state_rank = {
                "REPORTED": 0, "TRIAGED": 1, "ASSIGNED": 2, "ACKNOWLEDGED": 3,
                "ON_SITE": 4, "DIAGNOSED": 5, "RESTORED": 6, "CLOSED": 7,
            }[status_name]
            section_slug = equipment.section.lower().replace(" ", "-")
            add_event(db, fault.id, "FAULT_REPORTED", "USER-operations", {"severity": fault.severity}, date)
            if state_rank >= 1:
                add_event(db, fault.id, "FAULT_TRIAGED", "USER-automation", {}, date + timedelta(minutes=10))
            if state_rank >= 2:
                add_event(db, fault.id, "FAULT_ASSIGNED", "USER-automation", {
                    "assigned_section": equipment.section,
                    "suggested_section": equipment.section,
                    "repeat_routed_to_owner": i >= 30,
                }, date + timedelta(minutes=20))
            if state_rank >= 3:
                add_event(db, fault.id, "FAULT_ACKNOWLEDGE", f"USER-st-{section_slug}", {}, date + timedelta(minutes=35))
            if state_rank >= 4:
                add_event(db, fault.id, "FAULT_ON_SITE", f"USER-st-{section_slug}", {}, date + timedelta(hours=1))
            if state_rank >= 5:
                add_event(db, fault.id, "FAULT_DIAGNOSE", f"USER-pt-{section_slug}", {}, date + timedelta(hours=2))
            if state_rank >= 6:
                add_event(db, fault.id, "FAULT_RESTORE", f"USER-pt-{section_slug}", {}, date + timedelta(hours=4))
            if state_rank >= 7:
                add_event(db, fault.id, "FAULT_CLOSE", f"USER-ct-{section_slug}", {}, date + timedelta(hours=5))
        db.commit()

        for i in range(30):
            equipment = db.query(Equipment).filter(Equipment.id == f"EQ-{(i % 30) + 1:03d}").one()
            db.add(KnowledgeEntry(
                id=f"KNOW-{i + 1:04d}",
                reference=f"KN-DMO-{i + 1:04d}",
                equipment_id=equipment.id if i < 24 else None,
                title=f"Synthetic diagnostic procedure {i + 1}",
                symptom=["Intermittent alarm", "Unexpected trip", "Unstable reading", "Failure to start"][i % 4],
                confirmed_cause=["Loose terminal", "Sensor drift", "Blocked filter", "Incorrect parameter"][i % 4],
                diagnostic_procedure="Isolate the equipment under approved procedure, inspect relevant indicators and record test results.",
                corrective_action="Restore connections or replace the affected approved component.",
                safety="Follow applicable work permits, isolation and lockout procedures.",
                status="APPROVED" if i < 24 else ("SUBMITTED" if i < 28 else "REJECTED"),
                author_id="USER-electrical" if i % 2 else "USER-instrumentation",
                version=1,
                source_type="LEGACY_PROCEDURE" if i < 24 else "FAULT_DERIVED",
                instruction_type="Legacy operating work instruction" if i < 24 else "Fault-derived work procedure",
                usage_scope=f"{equipment.tag} and approved equivalent equipment" if i < 24 else "",
                legacy_reference=f"LEGACY-REF-{i + 1:03d}" if i < 24 else "",
                step_by_step="\n".join([
                    "1. Verify the applicable work permit and isolate the equipment or tool.",
                    "2. Inspect the external indicators and compare them with the approved normal setting.",
                    "3. Follow the fault-specific test sequence and record each result.",
                    "4. Apply the approved corrective action without bypassing interlocks.",
                    "5. Return the equipment to service and verify stable operation.",
                ]) if i < 24 else "",
                review_status="LEGACY_APPROVED" if i < 24 else "DIGITAL_REVIEW",
            ))
        db.commit()

    legacy_accounts = {
        "operations": ("operations", "Operations"),
        "automation": ("systems_automation", "Systems Automation"),
        "electrical": ("technician_st", "Electrical"),
        "instrumentation": ("technician_st", "Instrumentation"),
        "mechanical": ("technician_st", "Mechanical"),
        "supervisor": ("supervisor", ""),
        "management": ("general_manager_om", ""),
        "admin": ("system_administrator", ""),
    }
    for username, (role, section) in legacy_accounts.items():
        existing = db.scalar(select(User).where(User.username == username))
        if existing:
            existing.role = role
            existing.section = section

    demo_accounts = [
        ("hr", "hr_officer", ""),
        ("gm-om", "general_manager_om", ""),
        ("ceo", "managing_director", ""),
        ("maintenance-manager", "maintenance_manager", ""),
    ]
    for section in SECTIONS:
        section_slug = section.lower().replace(" ", "-")
        for short, role in (
            ("st", "technician_st"),
            ("pt", "technician_pt"),
            ("ct", "technician_ct"),
            ("assistant-engineer", "assistant_engineer"),
            ("engineer", "engineer"),
            ("senior-engineer", "senior_engineer"),
            ("chief-engineer", "chief_engineer"),
        ):
            demo_accounts.append((f"{short}-{section_slug}", role, section))

    for username, role, section in demo_accounts:
        if not db.scalar(select(User).where(User.username == username)):
            db.add(User(
                id=f"USER-{username}",
                username=username,
                display_name=f"Demo {ROLE_DEFINITIONS[role]['label']} ({section})" if section else f"Demo {ROLE_DEFINITIONS[role]['label']}",
                role=role,
                section=section,
                password_hash=bcrypt.hashpw(b"demo123", bcrypt.gensalt()).decode(),
            ))
    for section in SECTIONS:
        section_slug = section.lower().replace(" ", "-")
        placeholder_id = f"EQ-UNCONFIRMED-{section_slug}"
        if not db.get(Equipment, placeholder_id):
            db.add(Equipment(
                id=placeholder_id,
                tag=f"UNCONFIRMED-{section_slug.upper()}",
                name="Asset not yet identified",
                category="Unconfirmed",
                station="Unknown",
                location="Unknown",
                section=section,
                criticality="Unknown",
                description="Routing placeholder only; this is not an identified physical asset.",
            ))
    db.commit()

    for fault in db.scalars(select(Fault).where(Fault.id.like("FAULT-%"))).all():
        has_workflow_history = db.scalar(
            select(FaultEvent.id)
            .where(FaultEvent.fault_id == fault.id, FaultEvent.event_type != "FAULT_REPORTED")
            .limit(1)
        )
        if has_workflow_history:
            continue
        rank_by_status = {
            "REPORTED": 0, "TRIAGED": 1, "ASSIGNED": 2, "ACKNOWLEDGED": 3,
            "ON_SITE": 4, "DIAGNOSED": 5, "RESTORED": 6, "CLOSED": 7,
        }
        rank = rank_by_status.get(fault.status, 0)
        section_slug = fault.equipment.section.lower().replace(" ", "-")
        repeat_count = db.query(Fault).filter(
            Fault.equipment_id == fault.equipment_id,
            Fault.id != fault.id,
            Fault.created_at < fault.created_at,
        ).count()
        if rank >= 1:
            add_event(db, fault.id, "FAULT_TRIAGED", "USER-automation", {}, fault.created_at + timedelta(minutes=10))
        if rank >= 2:
            add_event(db, fault.id, "FAULT_ASSIGNED", "USER-automation", {
                "assigned_section": fault.assigned_section or fault.equipment.section,
                "suggested_section": fault.equipment.section,
                "repeat_count": repeat_count,
                "repeat_routed_to_owner": bool(repeat_count and fault.assigned_section == fault.equipment.section),
            }, fault.created_at + timedelta(minutes=20))
        if rank >= 3:
            add_event(db, fault.id, "FAULT_ACKNOWLEDGE", f"USER-st-{section_slug}", {}, fault.created_at + timedelta(minutes=35))
        if rank >= 4:
            add_event(db, fault.id, "FAULT_ON_SITE", f"USER-st-{section_slug}", {}, fault.created_at + timedelta(hours=1))
        if rank >= 5:
            add_event(db, fault.id, "FAULT_DIAGNOSE", f"USER-pt-{section_slug}", {}, fault.created_at + timedelta(hours=2))
        if rank >= 6:
            add_event(db, fault.id, "FAULT_RESTORE", f"USER-pt-{section_slug}", {}, fault.created_at + timedelta(hours=4))
        if rank >= 7:
            add_event(db, fault.id, "FAULT_CLOSE", f"USER-ct-{section_slug}", {}, fault.created_at + timedelta(hours=5))
    db.commit()

    if db.query(ProcedureUpdate).count() == 0:
        resolved_faults = db.scalars(
            select(Fault)
            .where(Fault.status.in_(("RESTORED", "CLOSED")))
            .order_by(Fault.created_at.desc())
            .limit(18)
        ).all()
        causes = ["Loose terminal connection", "Sensor drift", "Blocked filter", "Incorrect controller parameter"]
        authors = ("pt", "senior-engineer", "engineer", "assistant-engineer")
        for index, fault in enumerate(resolved_faults):
            section_slug = fault.equipment.section.lower().replace(" ", "-")
            author_id = f"USER-{authors[index % len(authors)]}-{section_slug}"
            cause = causes[index % len(causes)]
            diagnosis = Diagnosis(
                id=f"DIAG-DEMO-{index + 1:04d}",
                fault_id=fault.id,
                author_id=author_id,
                possible_cause=cause,
                diagnostic_method="Compare the alarm history with safe-to-check field indications and record the measured values.",
                observations="Synthetic observation recorded during the demonstration investigation.",
                test_results="Illustrative test result; verify against site procedures before use.",
                confidence=0.8,
                verification_status="CONFIRMED",
                created_at=fault.created_at + timedelta(hours=2),
            )
            db.add(diagnosis)
            if index % 4 == 0:
                db.add(Intervention(
                    id=f"INT-DEMO-FAILED-{index + 1:04d}",
                    fault_id=fault.id,
                    diagnosis_id=diagnosis.id,
                    actor_id=author_id,
                    corrective_action="Initial adjustment did not resolve the reported symptom.",
                    tools_materials="Approved test equipment",
                    outcome="FAILED",
                    notes="Failed attempt retained in the history to prevent repeating an ineffective workaround.",
                    created_at=fault.created_at + timedelta(hours=2, minutes=20),
                ))
            db.add(Intervention(
                id=f"INT-DEMO-SUCCESS-{index + 1:04d}",
                fault_id=fault.id,
                diagnosis_id=diagnosis.id,
                actor_id=author_id,
                corrective_action="Correct the confirmed cause using the approved maintenance procedure and verify operation.",
                tools_materials="Approved tools and replacement materials, where required",
                outcome="SUCCESS",
                notes="Synthetic successful intervention; illustrative only.",
                created_at=fault.created_at + timedelta(hours=2, minutes=45),
            ))

            update_id = f"PROC-DEMO-{index + 1:04d}"
            if index < 9:
                update_status = "APPROVED"
            elif index < 12:
                update_status = "CHIEF_APPROVED"
            elif index < 15:
                update_status = "SUBMITTED"
            else:
                update_status = "CLARIFICATION_REQUESTED"
            update = ProcedureUpdate(
                id=update_id,
                reference=f"PU-DMO-{index + 1:04d}",
                fault_id=fault.id,
                author_id=author_id,
                section=fault.equipment.section,
                title=f"Response to {fault.symptom.lower()} on {fault.equipment.tag}",
                observed_symptom=fault.symptom,
                confirmed_cause=cause,
                diagnostic_procedure=diagnosis.diagnostic_method,
                corrective_action="Address the confirmed cause, record before-and-after checks, and verify stable operation.",
                safety="Follow the current permit, isolation and equipment-specific safety procedures.",
                version=1,
                lineage_id=update_id,
                status=update_status,
                created_at=fault.created_at + timedelta(hours=4, minutes=30),
                updated_at=fault.created_at + timedelta(hours=4, minutes=30),
            )
            db.add(update)
            chief_id = f"USER-ct-{section_slug}"
            if update_status in ("CHIEF_APPROVED", "APPROVED", "CLARIFICATION_REQUESTED"):
                decision = "CLARIFICATION_REQUESTED" if update_status == "CLARIFICATION_REQUESTED" else "TECHNICAL_APPROVED"
                db.add(ProcedureReview(
                    id=f"PROC-REVIEW-CHIEF-{index + 1:04d}",
                    procedure_update_id=update_id,
                    reviewer_id=chief_id,
                    decision=decision,
                    comments="Please include the measured verification result." if decision == "CLARIFICATION_REQUESTED" else "Technical review complete.",
                    created_at=update.created_at + timedelta(minutes=10),
                ))
            if update_status == "APPROVED":
                db.add(ProcedureReview(
                    id=f"PROC-REVIEW-SUPERVISOR-{index + 1:04d}",
                    procedure_update_id=update_id,
                    reviewer_id="USER-supervisor",
                    decision="SUPERVISOR_APPROVED",
                    comments="Published after technical review.",
                    created_at=update.created_at + timedelta(minutes=20),
                ))

            if update_status == "APPROVED":
                reuse_fault = db.scalar(
                    select(Fault)
                    .where(Fault.equipment_id == fault.equipment_id, Fault.id != fault.id)
                    .order_by(Fault.created_at.desc())
                )
                if reuse_fault:
                    reuse_id = f"REUSE-DEMO-{index + 1:04d}"
                    db.add(KnowledgeReuse(
                        id=reuse_id,
                        procedure_update_id=update_id,
                        fault_id=reuse_fault.id,
                        actor_id=f"USER-st-{section_slug}",
                        used_at=reuse_fault.created_at + timedelta(minutes=30),
                    ))
                    if index % 3 != 0:
                        db.add(KnowledgeReuseOutcome(
                            reuse_id=reuse_id,
                            actor_id=f"USER-st-{section_slug}",
                            outcome="SUCCESS",
                            comments="The documented check helped resolve the repeat fault.",
                            confirmed_at=reuse_fault.created_at + timedelta(hours=4),
                        ))
        db.commit()
    migration_actor_id = db.scalar(select(User.id).where(User.username == "admin").limit(1))
    for fault in db.scalars(select(Fault).where(Fault.status.notin_(("RESTORED", "CLOSED")))).all():
        if fault.assignments or not fault.assigned_section and not fault.equipment:
            continue
        equipment_section = fault.equipment.section if fault.equipment else ""
        section = fault.assigned_section if fault.assigned_section in SECTIONS else equipment_section
        if section not in SECTIONS:
            continue
        db.add(FaultAssignment(
            id=str(uuid.uuid4()),
            fault_id=fault.id,
            section=section,
            assigned_by_id=migration_actor_id or fault.reporter_id,
            reason="Migrated active breakdown to section assignment",
        ))
        fault.assigned_section = section
    db.commit()
    db.close()


seed_database()


@app.post("/api/v1/auth/login")
def login(req: LoginRequest, db: Session = Depends(db_dep)):
    user = db.scalar(select(User).where(User.username == req.username))
    if not user or not user.active or not bcrypt.checkpw(req.password.encode(), user.password_hash.encode()):
        raise HTTPException(status_code=401, detail="Invalid username or password")
    token = jwt.encode({"sub": user.id, "exp": datetime.now(timezone.utc) + timedelta(hours=12)}, SECRET, algorithm="HS256")
    return {"access_token": token, "token_type": "Bearer", "user": user_payload(user)}


@app.get("/api/v1/auth/demo-accounts")
def demo_accounts(db: Session = Depends(db_dep)):
    users = db.scalars(select(User).where(User.username.like("%"), User.id.like("USER-%")).order_by(User.role, User.section, User.username)).all()
    return [{"username": user.username, "role_label": role_definition(user)["label"], "section": user.section} for user in users if user.active]


@app.get("/api/v1/auth/me")
def me(user: User = Depends(current_user)):
    return user_payload(user)


@app.get("/api/v1/access/roles")
def access_roles(user: User = Depends(current_user)):
    require_roles(user, "system_administrator")
    return [
        {"code": code, "label": definition["label"], "scope": definition["scope"], "section_required": definition.get("section_required", False), "permissions": definition["permissions"]}
        for code, definition in ROLE_DEFINITIONS.items()
    ]


@app.get("/api/v1/users")
def list_users(user: User = Depends(current_user), db: Session = Depends(db_dep)):
    require_roles(user, "hr_officer", "system_administrator")
    users = db.scalars(select(User).order_by(User.section, User.role, User.display_name)).all()
    return [
        {"id": item.id, "username": item.username, "display_name": item.display_name, "role": role_key(item), "role_label": role_definition(item)["label"], "section": item.section, "active": bool(item.active)}
        for item in users
    ]


@app.get("/api/v1/users/summary")
def users_summary(user: User = Depends(current_user), db: Session = Depends(db_dep)):
    require_roles(user, "hr_officer", "maintenance_manager", "general_manager_om", "system_administrator")
    users = db.scalars(select(User)).all()
    by_section: dict[str, int] = {}
    by_role: dict[str, int] = {}
    active_count = 0
    for item in users:
        section = item.section or "Management / cross-section"
        by_section[section] = by_section.get(section, 0) + 1
        role = role_definition(item)["label"]
        by_role[role] = by_role.get(role, 0) + 1
        active_count += int(bool(item.active))
    return {
        "total_accounts": len(users),
        "active_accounts": active_count,
        "inactive_accounts": len(users) - active_count,
        "by_section": by_section,
        "by_role": by_role,
        "personal_details_included": False,
        "data_type": "Synthetic demonstration workforce counts",
    }


def contribution_rows(db: Session, start_date: date | None, end_date: date | None) -> list[dict]:
    start = datetime.combine(start_date, datetime.min.time(), timezone.utc) if start_date else None
    end = datetime.combine(end_date + timedelta(days=1), datetime.min.time(), timezone.utc) if end_date else None

    def in_period(value: datetime) -> bool:
        normalized = utc_datetime(value)
        return (start is None or normalized >= start) and (end is None or normalized < end)

    users = db.scalars(select(User).where(User.active == 1)).all()
    contributors = [item for item in users if role_key(item) in TECHNICAL_ROLES or role_key(item) == "systems_automation"]
    user_by_id = {item.id: item for item in users}
    faults = db.scalars(select(Fault)).all()
    fault_by_id = {item.id: item for item in faults}
    events = db.scalars(select(FaultEvent)).all()
    diagnoses = db.scalars(select(Diagnosis)).all()
    interventions = db.scalars(select(Intervention)).all()
    updates = db.scalars(select(ProcedureUpdate)).all()
    reuse_rows = db.execute(
        select(KnowledgeReuse, KnowledgeReuseOutcome, ProcedureUpdate)
        .join(ProcedureUpdate, KnowledgeReuse.procedure_update_id == ProcedureUpdate.id)
        .outerjoin(KnowledgeReuseOutcome, KnowledgeReuseOutcome.reuse_id == KnowledgeReuse.id)
    ).all()
    rows = []
    for employee in contributors:
        employee_events = [
            item for item in events
            if item.actor_id == employee.id and item.event_type in ("FAULT_ACKNOWLEDGE", "FAULT_RESTORE") and in_period(item.created_at)
        ]
        acknowledged = []
        restored = []
        for event in employee_events:
            fault = fault_by_id.get(event.fault_id)
            if not fault:
                continue
            minutes = (utc_datetime(event.created_at) - utc_datetime(fault.created_at)).total_seconds() / 60
            if event.event_type == "FAULT_ACKNOWLEDGE":
                acknowledged.append(minutes)
            else:
                restored.append(minutes / 60)
        authored = [item for item in updates if item.author_id == employee.id and in_period(item.created_at)]
        approved = [item for item in authored if item.status == "APPROVED"]
        approved_revisions = [item for item in approved if item.version > 1]
        authored_ids = {item.id for item in authored}
        verified_peer_reuse = [
            (reuse, outcome, update)
            for reuse, outcome, update in reuse_rows
            if update.id in authored_ids and outcome and outcome.outcome == "SUCCESS"
            and reuse.actor_id != employee.id and in_period(outcome.confirmed_at)
        ]
        own_reuses = [
            (reuse, outcome, update)
            for reuse, outcome, update in reuse_rows
            if reuse.actor_id == employee.id and in_period(reuse.used_at)
        ]
        authored_interventions = [
            item for item in interventions if item.actor_id == employee.id and in_period(item.created_at)
        ]
        authored_diagnoses = [
            item for item in diagnoses if item.author_id == employee.id and in_period(item.created_at)
        ]
        reported_count = sum(
            1 for fault in faults if fault.reporter_id == employee.id and in_period(fault.created_at)
        )
        approved_count = len(approved)
        peer_success_count = len(verified_peer_reuse)
        rows.append({
            "employee_id": employee.id,
            "employee_name": employee.display_name,
            "role": role_definition(employee)["label"],
            "section": employee.section,
            "faults_reported_context_only": reported_count,
            "faults_acknowledged": len(acknowledged),
            "mean_acknowledgement_minutes": round(sum(acknowledged) / len(acknowledged), 1) if acknowledged else None,
            "faults_restored": len(restored),
            "mean_report_to_restore_hours": round(sum(restored) / len(restored), 1) if restored else None,
            "diagnoses_recorded": len(authored_diagnoses),
            "successful_interventions": sum(item.outcome == "SUCCESS" for item in authored_interventions),
            "failed_interventions": sum(item.outcome == "FAILED" for item in authored_interventions),
            "procedure_updates_authored": len(authored),
            "procedure_updates_approved": approved_count,
            "approved_revisions": len(approved_revisions),
            "colleague_reuses": len(verified_peer_reuse),
            "reuses_recorded_by_employee": len(own_reuses),
            "reuses_confirmed_successful_by_employee": sum(
                bool(outcome and outcome.outcome == "SUCCESS") for _, outcome, _ in own_reuses
            ),
            "illustrative_recognition_points": approved_count * 10 + len(approved_revisions) * 2 + peer_success_count * 5,
        })
    return sorted(rows, key=lambda row: (row["section"], row["employee_name"]))


@app.get("/api/v1/hr/appraisal")
def hr_appraisal(
    start_date: date | None = None,
    end_date: date | None = None,
    user: User = Depends(current_user),
    db: Session = Depends(db_dep),
):
    require_roles(user, "hr_officer")
    if start_date and end_date and start_date > end_date:
        raise HTTPException(status_code=422, detail="Start date must not be after end date")
    return {
        "period": {"from": start_date.isoformat() if start_date else None, "to": end_date.isoformat() if end_date else None},
        "data_type": "Illustrative synthetic contribution evidence; not an approved appraisal score",
        "point_definition": "10 per approved procedure, 2 additional per approved revision, and 5 per colleague-confirmed successful reuse",
        "rows": contribution_rows(db, start_date, end_date),
    }


@app.get("/api/v1/recognition/leaderboard")
def recognition_leaderboard(user: User = Depends(current_user), db: Session = Depends(db_dep)):
    require_roles(user, "maintenance_manager", "general_manager_om", "hr_officer", "supervisor", "system_administrator")
    rows = contribution_rows(db, None, None)
    leaderboard = [
        {
            "rank": index,
            "employee_name": row["employee_name"],
            "role": row["role"],
            "section": row["section"],
            "points": row["illustrative_recognition_points"],
            "verified_reuses": row["colleague_reuses"],
            "approved_procedures": row["procedure_updates_approved"],
            "approved_revisions": row["approved_revisions"],
        }
        for index, row in enumerate(
            sorted(rows, key=lambda item: (
                -item["illustrative_recognition_points"],
                -item["colleague_reuses"],
                item["employee_name"],
            )),
            start=1,
        )
        if row["illustrative_recognition_points"] > 0
    ]
    return {
        "platform": "SOCA-compatible recognition model",
        "integration_status": "Illustrative local model; external SOCA connection not configured",
        "recognition_rule": "Verified reuse and approved revision drive recognition; report volume is excluded",
        "leaderboard": leaderboard,
    }


@app.post("/api/v1/users", status_code=status.HTTP_201_CREATED)
def create_user(req: UserCreate, user: User = Depends(current_user), db: Session = Depends(db_dep)):
    require_roles(user, "system_administrator")
    if req.role not in ROLE_DEFINITIONS:
        raise HTTPException(status_code=422, detail="Unknown role")
    if not req.username.strip() or not req.display_name.strip() or len(req.password) < 8:
        raise HTTPException(status_code=422, detail="Username and display name are required; password must be at least 8 characters")
    section_required = ROLE_DEFINITIONS[req.role].get("section_required", False)
    if section_required and req.section not in SECTIONS:
        raise HTTPException(status_code=422, detail="A valid maintenance section is required for this role")
    if not section_required and req.section and req.section not in SECTIONS:
        raise HTTPException(status_code=422, detail="Unknown maintenance section")
    if db.scalar(select(User).where(User.username == req.username.strip())):
        raise HTTPException(status_code=409, detail="Username already exists")
    created = User(
        id=str(uuid.uuid4()),
        username=req.username.strip(),
        display_name=req.display_name.strip(),
        role=req.role,
        section=req.section,
        password_hash=bcrypt.hashpw(req.password.encode(), bcrypt.gensalt()).decode(),
    )
    db.add(created)
    audit_user_change(db, user.id, "USER_CREATED", created, {"username": created.username, "role": created.role, "section": created.section})
    db.commit()
    return user_payload(created)


@app.patch("/api/v1/users/{user_id}/status")
def update_user_status(user_id: str, req: UserStatusUpdate, user: User = Depends(current_user), db: Session = Depends(db_dep)):
    require_roles(user, "system_administrator")
    target = db.get(User, user_id)
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    if target.id == user.id and not req.active:
        raise HTTPException(status_code=409, detail="You cannot deactivate your own account")
    target.active = int(req.active)
    audit_user_change(db, user.id, "USER_STATUS_CHANGED", target, {"active": bool(target.active)})
    db.commit()
    return {"id": target.id, "active": bool(target.active)}


@app.get("/api/v1/users/audit")
def user_audit(user: User = Depends(current_user), db: Session = Depends(db_dep)):
    require_roles(user, "system_administrator")
    entries = db.scalars(select(UserAudit).order_by(UserAudit.created_at.desc()).limit(200)).all()
    return [{"id": item.id, "actor_id": item.actor_id, "action": item.action, "target_user_id": item.target_user_id, "details": item.details, "created_at": item.created_at.isoformat()} for item in entries]


def section_technician_payloads(db: Session, section: str) -> list[dict]:
    technicians = db.scalars(
        select(User)
        .where(User.section == section, User.role.in_(ASSIGNABLE_TECHNICIAN_ROLES))
        .order_by(User.role, User.display_name)
    ).all()
    assignments = db.scalars(
        select(FaultAssignment).where(
            FaultAssignment.section == section,
            FaultAssignment.status.in_(ACTIVE_ASSIGNMENT_STATUSES),
        )
    ).all()
    workloads: dict[str, int] = {}
    for assignment in assignments:
        if not assignment.assigned_user_id:
            continue
        fault = db.get(Fault, assignment.fault_id)
        if fault and fault.status not in ("RESTORED", "CLOSED") and current_assignment(fault) == assignment:
            workloads[assignment.assigned_user_id] = workloads.get(assignment.assigned_user_id, 0) + 1
    return [{
        "id": item.id,
        "display_name": item.display_name,
        "role": role_key(item),
        "role_label": role_definition(item)["label"],
        "section": item.section,
        "active": bool(item.active),
        "availability_status": item.availability_status,
        "competencies": json.loads(item.competencies or "[]"),
        "active_workload": workloads.get(item.id, 0),
    } for item in technicians]


@app.get("/api/v1/chief/team")
def chief_team(user: User = Depends(current_user), db: Session = Depends(db_dep)):
    require_roles(user, "technician_ct")
    return section_technician_payloads(db, user.section)


@app.patch("/api/v1/me/availability")
def update_my_availability(
    req: AvailabilityUpdate,
    user: User = Depends(current_user),
    db: Session = Depends(db_dep),
):
    require_roles(user, *ASSIGNABLE_TECHNICIAN_ROLES)
    if req.availability_status not in ("AVAILABLE", "UNAVAILABLE"):
        raise HTTPException(status_code=422, detail="Availability must be AVAILABLE or UNAVAILABLE")
    user.availability_status = req.availability_status
    audit_user_change(db, user.id, "TECHNICIAN_AVAILABILITY_CHANGED", user, {
        "availability_status": user.availability_status,
    })
    db.commit()
    return {"id": user.id, "availability_status": user.availability_status}


@app.patch("/api/v1/chief/team/{user_id}/competencies")
def update_team_competencies(
    user_id: str,
    req: CompetenciesUpdate,
    user: User = Depends(current_user),
    db: Session = Depends(db_dep),
):
    require_roles(user, "technician_ct")
    target = db.get(User, user_id)
    if not target or target.section != user.section or role_key(target) not in ASSIGNABLE_TECHNICIAN_ROLES:
        raise HTTPException(status_code=404, detail="Technician not found in your section")
    competencies = []
    seen = set()
    for value in req.competencies:
        competency = value.strip()
        key = competency.casefold()
        if competency and key not in seen:
            competencies.append(competency)
            seen.add(key)
    if len(competencies) > 20 or any(len(value) > 80 for value in competencies):
        raise HTTPException(status_code=422, detail="Enter at most 20 competencies, each no longer than 80 characters")
    target.competencies = json.dumps(competencies)
    audit_user_change(db, user.id, "TECHNICIAN_COMPETENCIES_CHANGED", target, {
        "competencies": competencies,
    })
    db.commit()
    return {"id": target.id, "competencies": competencies}


@app.get("/api/v1/chief/workspace")
def chief_workspace(user: User = Depends(current_user), db: Session = Depends(db_dep)):
    require_roles(user, "technician_ct")
    query = (
        select(Fault)
        .join(Equipment, Fault.equipment_id == Equipment.id)
        .where(
            (Fault.assigned_section == user.section)
            | (Equipment.section == user.section)
            | Fault.id.in_(select(FaultAssignment.fault_id).where(FaultAssignment.section == user.section))
        )
        .order_by(Fault.created_at.desc())
    )
    scoped_faults = db.scalars(query.limit(200)).all()
    records = []
    now = utcnow()
    for fault in scoped_faults:
        if fault.status == "CLOSED":
            continue
        assignment = current_assignment(fault)
        section_history = any(item.section == user.section for item in fault.assignments)
        if fault.assigned_section != user.section and (not fault.equipment or fault.equipment.section != user.section) and not section_history:
            continue
        due_at = assignment.response_due_at if assignment else None
        is_current_section = bool(assignment and assignment.section == user.section)
        escalated = bool(assignment and assignment.section != user.section and section_history)
        awaiting_assignment = bool(
            is_current_section and assignment and not assignment.assigned_user_id
            and assignment.escalation_status != "PENDING"
            and assignment.completion_review_status != "PENDING"
        )
        awaiting_review = bool(
            is_current_section and assignment and (
                assignment.escalation_status == "PENDING"
                or assignment.completion_review_status == "PENDING"
            )
        )
        overdue = bool(
            is_current_section and assignment and due_at
            and utc_datetime(due_at) < now
            and fault.status not in ("RESTORED", "CLOSED")
        )
        records.append({
            "id": fault.id,
            "reference": fault.reference,
            "equipment_tag": fault.equipment.tag if fault.equipment_confirmed and fault.equipment else (
                fault.reported_equipment_text or "Asset not identified"
            ),
            "symptom": fault.symptom,
            "severity": fault.severity,
            "status": fault.status,
            "severity": fault.severity,
            "assigned_section": fault.assigned_section,
            "assigned_user_id": assignment.assigned_user_id if assignment else None,
            "assigned_user_name": assignment.assigned_user.display_name if assignment and assignment.assigned_user else "",
            "assignment_status": assignment.status if assignment else "",
            "response_due_at": due_at.isoformat() if due_at else None,
            "awaiting_assignment": awaiting_assignment,
            "awaiting_review": awaiting_review,
            "escalated": escalated,
            "overdue": overdue,
            "created_at": fault.created_at.isoformat(),
        })
    active_section = [item for item in records if item["assigned_section"] == user.section and item["status"] not in ("RESTORED", "CLOSED")]
    return {
        "section": user.section,
        "counts": {
            "awaiting_assignment": sum(bool(item["awaiting_assignment"]) for item in active_section),
            "active_section": len(active_section),
            "investigating": sum(item["assignment_status"] in ("ACKNOWLEDGED", "IN_PROGRESS") for item in active_section),
            "escalated": sum(bool(item["escalated"]) for item in records),
            "awaiting_review": sum(bool(item["awaiting_review"]) for item in active_section),
            "overdue": sum(bool(item["overdue"]) for item in active_section),
            "critical": sum(item["severity"].casefold() == "critical" and item["status"] not in ("RESTORED", "CLOSED") for item in records),
        },
        "faults": records,
        "technicians": section_technician_payloads(db, user.section),
    }


@app.get("/api/v1/equipment")
def equipment_list(search: str = "", station: str = "", user: User = Depends(current_user), db: Session = Depends(db_dep)):
    require_roles(user, "operations", "systems_automation", "technician_st", "technician_pt", "technician_ct", "assistant_engineer", "engineer", "senior_engineer", "chief_engineer", "maintenance_manager", "general_manager_om", "supervisor", "system_administrator")
    query = select(Equipment).where(~Equipment.tag.like("UNCONFIRMED-%"))
    if station:
        query = query.where(Equipment.station == station)
    if role_key(user) in ("technician_st", "technician_pt", "technician_ct", "assistant_engineer", "engineer", "senior_engineer", "chief_engineer"):
        query = query.where(Equipment.section == user.section)
    equipment = db.scalars(query).all()
    if search.strip():
        terms = [term for term in search.lower().replace("-", " ").split() if len(term) > 1]

        def score(item: Equipment) -> int:
            searchable = " ".join((
                item.tag, item.name, item.category, item.station, item.location,
                item.section, item.description, item.manufacturer, item.model,
            )).lower().replace("-", " ")
            return sum(term in searchable for term in terms)

        equipment = sorted(
            (item for item in equipment if score(item)),
            key=lambda item: (-score(item), item.tag),
        )
    return [
        {
            "id": e.id, "tag": e.tag, "name": e.name, "category": e.category,
            "station": e.station, "location": e.location, "section": e.section,
            "criticality": e.criticality, "operational_status": e.operational_status,
            "description": e.description,
        }
        for e in equipment[:100]
    ]


@app.get("/api/v1/equipment/{equipment_id}")
def equipment_detail(equipment_id: str, user: User = Depends(current_user), db: Session = Depends(db_dep)):
    item = db.get(Equipment, equipment_id)
    if not item:
        raise HTTPException(status_code=404, detail="Equipment not found")
    require_equipment_scope(user, item)
    return {"id": item.id, "tag": item.tag, "name": item.name, "category": item.category, "station": item.station, "location": item.location, "section": item.section, "criticality": item.criticality, "operational_status": item.operational_status, "manufacturer": item.manufacturer, "model": item.model, "description": item.description}


@app.get("/api/v1/equipment/{equipment_id}/history")
def equipment_history(equipment_id: str, user: User = Depends(current_user), db: Session = Depends(db_dep)):
    equipment = db.get(Equipment, equipment_id)
    if not equipment:
        raise HTTPException(status_code=404, detail="Equipment not found")
    require_equipment_scope(user, equipment)
    faults = db.scalars(select(Fault).where(Fault.equipment_id == equipment_id).order_by(Fault.created_at.desc())).all()
    return [{"id": f.id, "reference": f.reference, "symptom": f.symptom, "severity": f.severity, "status": f.status, "created_at": f.created_at.isoformat()} for f in faults]


@app.post("/api/v1/faults")
def report_fault(req: FaultCreate, user: User = Depends(current_user), db: Session = Depends(db_dep)):
    require_roles(user, "operations", "systems_automation", "technician_st", "technician_pt", "technician_ct", "assistant_engineer", "engineer", "senior_engineer", "chief_engineer", "maintenance_manager", "general_manager_om", "supervisor", "system_administrator")
    if not req.symptom.strip():
        raise HTTPException(status_code=422, detail="Describe what was observed")
    if not req.operational_impact.strip():
        raise HTTPException(status_code=422, detail="Describe the immediate effect on operation")
    candidate = db.get(Equipment, req.equipment_id) if req.equipment_id else None
    if req.equipment_id and not candidate:
        raise HTTPException(status_code=404, detail="Equipment not found")
    if candidate and candidate.tag.startswith("UNCONFIRMED-"):
        raise HTTPException(status_code=422, detail="Select a real equipment candidate or report the asset as unconfirmed")
    if candidate:
        require_equipment_scope(user, candidate)
    confirmed_equipment = candidate if req.equipment_confirmed else None
    if not confirmed_equipment and not (
        req.reported_equipment_text.strip() or req.reported_location.strip() or candidate
    ):
        raise HTTPException(status_code=422, detail="Provide an equipment description or a known location")

    unconfirmed = confirmed_equipment is None
    if confirmed_equipment:
        selected_equipment = confirmed_equipment
        equipment_id = confirmed_equipment.id
    else:
        technical_roles = (
            "technician_st", "technician_pt", "technician_ct", "assistant_engineer",
            "engineer", "senior_engineer", "chief_engineer",
        )
        placeholder_section = user.section if role_key(user) in technical_roles else "Systems Automation"
        section_slug = placeholder_section.lower().replace(" ", "-")
        equipment_id = f"EQ-UNCONFIRMED-{section_slug}"
        selected_equipment = db.get(Equipment, equipment_id)
        if not selected_equipment:
            raise HTTPException(status_code=500, detail="Unconfirmed-asset routing is not configured")
    assigned_section = "Systems Automation"

    reported_equipment_text = req.reported_equipment_text.strip()
    if not reported_equipment_text and candidate and unconfirmed:
        reported_equipment_text = f"{candidate.tag} — {candidate.name}"
    references = db.scalars(
        select(Fault.reference).where(Fault.reference.like("KPC-DMO-%"))
    ).all()
    sequence_numbers = []
    for reference in references:
        suffix = reference.rpartition("-")[2]
        if suffix.isdigit():
            sequence_numbers.append(int(suffix))
    next_reference_number = max(sequence_numbers, default=0) + 1
    previous_recent = []
    if confirmed_equipment:
        previous_recent = db.scalars(
            select(Fault)
            .where(
                Fault.equipment_id == equipment_id,
                Fault.equipment_confirmed == 1,
                Fault.symptom == req.symptom,
                Fault.created_at >= utcnow() - timedelta(days=90),
            )
            .order_by(Fault.created_at.desc())
            .limit(10)
        ).all()
    repeat_count = len(previous_recent)
    fault = Fault(
        id=str(uuid.uuid4()),
        reference=f"KPC-DMO-{next_reference_number:05d}",
        equipment_id=equipment_id,
        reporter_id=user.id,
        category=req.category,
        symptom=req.symptom,
        severity=req.severity,
        description=req.description,
        operational_impact=req.operational_impact,
        equipment_confirmed=0 if unconfirmed else 1,
        reported_equipment_text=reported_equipment_text,
        reported_location=req.reported_location.strip(),
        raised_by_text=req.reported_on_behalf_of.strip(),
        operating_conditions=req.operating_conditions.strip(),
        suggested_equipment_id=candidate.id if candidate and unconfirmed else None,
        assigned_section=assigned_section,
        status="ASSIGNED",
    )
    db.add(fault)
    db.flush()
    initial_assignment = FaultAssignment(
        id=str(uuid.uuid4()),
        fault_id=fault.id,
        section=assigned_section,
        assigned_by_id=user.id,
        reason="Initial response to reported breakdown",
    )
    db.add(initial_assignment)
    add_event(db, fault.id, "FAULT_REPORTED", user.id, req.model_dump())
    add_event(db, fault.id, "FAULT_ASSIGNED", user.id, {
        "assignment_id": initial_assignment.id,
        "assigned_section": assigned_section,
        "suggested_section": selected_equipment.section if confirmed_equipment else "Systems Automation",
        "routing_strategy": "SYSTEMS_AUTOMATION_FIRST",
        "reason": initial_assignment.reason,
    })
    if repeat_count:
        last_fixed = previous_recent[0].restored_at or previous_recent[0].created_at
        fixer_name = ""
        if previous_recent:
            restoration_events = db.scalars(
                select(FaultEvent)
                .where(FaultEvent.fault_id == previous_recent[0].id, FaultEvent.event_type == "FAULT_RESTORE")
                .order_by(FaultEvent.created_at.desc())
                .limit(1)
            ).all()
            if restoration_events:
                fixer = db.get(User, restoration_events[0].actor_id)
                fixer_name = fixer.display_name if fixer else ""
        add_event(db, fault.id, "REPEAT_FAULT_ROUTED", user.id, {
            "repeat_count": repeat_count,
            "window_days": 90,
            "assigned_section": assigned_section,
            "asset_owner_section": selected_equipment.section,
            "triage_skipped": False,
            "last_fixed_at": last_fixed.isoformat(),
            "fixed_by": fixer_name,
        })
    db.commit()
    return {
        "id": fault.id,
        "reference": fault.reference,
        "status": fault.status,
        "repeat_fault": repeat_count > 0,
        "repeat_count": repeat_count,
        "assigned_section": fault.assigned_section,
        "triage_skipped": False,
        "seen_before_message": (
            f"SEEN BEFORE: Same fault {repeat_count} time(s) in 90 days."
            f" Sent to Systems Automation first; prior findings remain linked to this report."
            if repeat_count else ""
        ),
        "active_assignment_id": initial_assignment.id,
        "equipment_confirmed": not unconfirmed,
        "asset_confirmation_required": unconfirmed,
        "asset_confirmation_message": (
            "Asset identification is unconfirmed. Systems Automation must confirm the equipment before normal routing."
            if unconfirmed else ""
        ),
    }


@app.get("/api/v1/faults")
def fault_list(
    status_filter: str = "",
    queue: str = "",
    history_scope: str = "",
    search: str = "",
    user: User = Depends(current_user),
    db: Session = Depends(db_dep),
):
    require_roles(user, "operations", "systems_automation", "technician_st", "technician_pt", "technician_ct", "assistant_engineer", "engineer", "senior_engineer", "chief_engineer", "maintenance_manager", "general_manager_om", "supervisor", "system_administrator")
    query = select(Fault).join(Equipment, Fault.equipment_id == Equipment.id).order_by(Fault.created_at.desc())
    if status_filter:
        query = query.where(Fault.status == status_filter)
    if role_key(user) in ("technician_st", "technician_pt", "technician_ct", "assistant_engineer", "engineer", "senior_engineer", "chief_engineer"):
        query = query.where(
            (Fault.assigned_section == user.section)
            | (Equipment.section == user.section)
            | Fault.id.in_(select(FaultAssignment.fault_id).where(FaultAssignment.section == user.section))
        )
    if queue in ("mine", "section_open"):
        query = query.where(Fault.status.notin_(("RESTORED", "CLOSED")))
        if queue == "mine":
            query = query.where(
                (Fault.assigned_user_id == user.id)
                | Fault.id.in_(select(FaultAssignment.fault_id).where(
                    FaultAssignment.assigned_user_id == user.id,
                    FaultAssignment.status.in_(ACTIVE_ASSIGNMENT_STATUSES),
                ))
            )
        elif role_key(user) in ("technician_st", "technician_pt", "technician_ct", "assistant_engineer", "engineer", "senior_engineer", "chief_engineer"):
            query = query.where(
                Fault.id.in_(select(FaultAssignment.fault_id).where(
                    FaultAssignment.section == user.section,
                    FaultAssignment.status.in_(ACTIVE_ASSIGNMENT_STATUSES),
                ))
                | (
                    Fault.id.notin_(select(FaultAssignment.fault_id))
                    & ((Fault.assigned_section == user.section) | (Equipment.section == user.section))
                )
            )
        elif role_key(user) == "systems_automation":
            query = query.where(
                Fault.id.in_(select(FaultAssignment.fault_id).where(
                    FaultAssignment.section == "Systems Automation",
                    FaultAssignment.status.in_(ACTIVE_ASSIGNMENT_STATUSES),
                ))
                | (
                    Fault.id.notin_(select(FaultAssignment.fault_id))
                    & ((Fault.assigned_section == "Systems Automation") | (Equipment.section == "Systems Automation"))
                )
            )
    if history_scope == "reported_by_me":
        query = query.where(Fault.reporter_id == user.id)
    elif history_scope == "worked_by_me":
        query = query.where(
            (Fault.assigned_user_id == user.id)
            | Fault.id.in_(select(FaultAssignment.fault_id).where(FaultAssignment.assigned_user_id == user.id))
            | Fault.id.in_(select(FaultEvent.fault_id).where(FaultEvent.actor_id == user.id))
        )
    if search.strip():
        needle = f"%{search.strip()}%"
        query = query.where(
            Fault.reference.ilike(needle)
            | Fault.symptom.ilike(needle)
            | Fault.description.ilike(needle)
            | Fault.reported_equipment_text.ilike(needle)
            | Fault.reported_location.ilike(needle)
            | Equipment.tag.ilike(needle)
            | Equipment.name.ilike(needle)
            | Equipment.location.ilike(needle)
        )
    faults = db.scalars(query.limit(200)).all()
    result = []
    for f in faults:
        suggested = db.get(Equipment, f.suggested_equipment_id) if f.suggested_equipment_id else None
        assignment = current_assignment(f)
        result.append({
            "id": f.id, "reference": f.reference, "equipment_id": f.equipment_id,
            "equipment_tag": f.equipment.tag if f.equipment_confirmed and f.equipment else (
                f.reported_equipment_text or "Asset not identified"
            ),
            "category": f.category, "symptom": f.symptom, "severity": f.severity,
            "status": f.status, "assigned_section": f.assigned_section,
            "equipment_confirmed": bool(f.equipment_confirmed),
            "reported_equipment_text": f.reported_equipment_text,
            "reported_location": f.reported_location,
            "suggested_equipment_tag": suggested.tag if suggested else "",
            "reporter_name": f.reporter.display_name if f.reporter else "",
            "assigned_user_id": f.assigned_user_id,
            "assigned_user_name": f.assigned_user.display_name if f.assigned_user else "",
            "active_assignment_id": assignment.id if assignment else None,
            "active_assignment_section": assignment.section if assignment else "",
            "active_assignment_status": assignment.status if assignment else "",
            "active_assignment_elapsed_minutes": (
                max(0, int((utc_datetime(assignment.completed_at or utcnow()) - utc_datetime(assignment.created_at)).total_seconds() / 60))
                if assignment else None
            ),
            "created_at": f.created_at.isoformat(),
        })
    return result


@app.get("/api/v1/faults/{fault_id}")
def fault_detail(fault_id: str, user: User = Depends(current_user), db: Session = Depends(db_dep)):
    f = db.get(Fault, fault_id)
    if not f:
        raise HTTPException(status_code=404, detail="Fault not found")
    require_fault_scope(user, f)
    return {
        "id": f.id, "reference": f.reference, "equipment_id": f.equipment_id,
        "equipment_tag": f.equipment.tag if f.equipment_confirmed and f.equipment else (
            f.reported_equipment_text or "Asset not identified"
        ),
        "equipment_confirmed": bool(f.equipment_confirmed),
        "reported_equipment_text": f.reported_equipment_text,
        "reported_location": f.reported_location,
        "suggested_equipment_id": f.suggested_equipment_id,
        "category": f.category, "symptom": f.symptom, "severity": f.severity,
        "description": f.description, "operational_impact": f.operational_impact,
        "reported_on_behalf_of": f.raised_by_text, "status": f.status,
        "assigned_section": f.assigned_section, "assigned_user_id": f.assigned_user_id,
        "operating_conditions": f.operating_conditions,
        "closure_remarks": f.closure_remarks,
        "active_assignment_id": current_assignment(f).id if current_assignment(f) else None,
        "created_at": f.created_at.isoformat(),
    }


@app.get("/api/v1/faults/{fault_id}/timeline")
def fault_timeline(fault_id: str, user: User = Depends(current_user), db: Session = Depends(db_dep)):
    fault = db.get(Fault, fault_id)
    if not fault:
        raise HTTPException(status_code=404, detail="Fault not found")
    require_fault_scope(user, fault)
    events = db.scalars(select(FaultEvent).where(FaultEvent.fault_id == fault_id).order_by(FaultEvent.created_at)).all()
    return [{"id": e.id, "event_type": e.event_type, "actor_id": e.actor_id, "payload": e.payload, "created_at": e.created_at.isoformat()} for e in events]


@app.get("/api/v1/faults/{fault_id}/context")
def fault_context(fault_id: str, user: User = Depends(current_user), db: Session = Depends(db_dep)):
    fault = db.get(Fault, fault_id)
    if not fault:
        raise HTTPException(status_code=404, detail="Fault not found")
    require_fault_scope(user, fault)
    equipment = fault.equipment
    timeline = db.scalars(
        select(FaultEvent).where(FaultEvent.fault_id == fault_id).order_by(FaultEvent.created_at)
    ).all()
    actor_ids = {event.actor_id for event in timeline}
    actors = {item.id: item.display_name for item in db.scalars(select(User).where(User.id.in_(actor_ids))).all()} if actor_ids else {}
    diagnoses = db.scalars(
        select(Diagnosis).where(Diagnosis.fault_id == fault_id).order_by(Diagnosis.created_at)
    ).all()
    interventions = db.scalars(
        select(Intervention).where(Intervention.fault_id == fault_id).order_by(Intervention.created_at)
    ).all()
    assignments = fault.assignments
    attachments = fault.attachments
    operator_updates = [
        {
            "id": event.id,
            "event_type": event.event_type,
            "actor_name": actors.get(event.actor_id, event.actor_id),
            "payload": json.loads(event.payload or "{}"),
            "created_at": event.created_at.isoformat(),
        }
        for event in timeline
        if event.event_type in ("OPERATOR_UPDATE", "FAULT_OPERATOR_CONFIRMED", "FAULT_OPERATOR_REJECTED_RESTORATION")
    ]
    current_updates = db.scalars(
        select(ProcedureUpdate).where(ProcedureUpdate.fault_id == fault_id).order_by(ProcedureUpdate.version)
    ).all()
    reuse_records = db.scalars(
        select(KnowledgeReuse).where(KnowledgeReuse.fault_id == fault_id).order_by(KnowledgeReuse.used_at)
    ).all()

    previous_faults = []
    if fault.equipment_confirmed:
        previous_faults = db.scalars(
            select(Fault)
            .where(
                Fault.equipment_id == fault.equipment_id,
                Fault.equipment_confirmed == 1,
                Fault.id != fault_id,
            )
            .order_by(Fault.created_at.desc())
            .limit(10)
        ).all()
    history = []
    for previous in previous_faults:
        prior_diagnoses = db.scalars(
            select(Diagnosis).where(Diagnosis.fault_id == previous.id).order_by(Diagnosis.created_at)
        ).all()
        prior_interventions = db.scalars(
            select(Intervention).where(Intervention.fault_id == previous.id).order_by(Intervention.created_at)
        ).all()
        history.append({
            "id": previous.id,
            "reference": previous.reference,
            "symptom": previous.symptom,
            "description": previous.description,
            "status": previous.status,
            "created_at": previous.created_at.isoformat(),
            "diagnoses": [{"possible_cause": item.possible_cause, "verification_status": item.verification_status} for item in prior_diagnoses],
            "interventions": [{"corrective_action": item.corrective_action, "outcome": item.outcome, "notes": item.notes} for item in prior_interventions],
        })

    applicable_updates = db.scalars(
        select(ProcedureUpdate)
        .join(Fault, ProcedureUpdate.fault_id == Fault.id)
        .where(
            ProcedureUpdate.status == "APPROVED",
            (Fault.equipment_id == fault.equipment_id) | (ProcedureUpdate.observed_symptom.ilike(f"%{fault.symptom}%")),
        )
        .order_by(ProcedureUpdate.version.desc())
        .limit(50)
    ).all()
    latest_approved: dict[str, ProcedureUpdate] = {}
    for item in applicable_updates:
        current = latest_approved.get(item.lineage_id)
        if current is None or item.version > current.version:
            latest_approved[item.lineage_id] = item
    approved_procedures = []
    for item in latest_approved.values():
        author = db.get(User, item.author_id)
        reviews = db.scalars(
            select(ProcedureReview).where(ProcedureReview.procedure_update_id == item.id).order_by(ProcedureReview.created_at)
        ).all()
        approved_procedures.append(procedure_update_payload(item, author, reviews))
    legacy_knowledge = db.scalars(
        select(KnowledgeEntry)
        .where(
            KnowledgeEntry.status == "APPROVED",
            (KnowledgeEntry.equipment_id == fault.equipment_id) | (KnowledgeEntry.symptom.ilike(f"%{fault.symptom}%")),
        )
        .order_by(KnowledgeEntry.updated_at.desc())
        .limit(30)
    ).all()
    ranked_causes: dict[str, dict] = {}
    for prior_fault in previous_faults:
        prior_diagnoses = db.scalars(select(Diagnosis).where(Diagnosis.fault_id == prior_fault.id)).all()
        prior_interventions = db.scalars(select(Intervention).where(Intervention.fault_id == prior_fault.id)).all()
        for prior_diagnosis in prior_diagnoses:
            linked = [
                item for item in prior_interventions
                if item.diagnosis_id == prior_diagnosis.id
            ]
            successful = sum(item.outcome == "SUCCESS" for item in linked)
            failed = sum(item.outcome == "FAILED" for item in linked)
            row = ranked_causes.setdefault(prior_diagnosis.possible_cause, {
                "possible_cause": prior_diagnosis.possible_cause,
                "quick_check": prior_diagnosis.quick_check,
                "fix": prior_diagnosis.fix_summary,
                "confirmed_count": 0,
                "failed_count": 0,
                "workaround_count": 0,
                "recurrence_count": 0,
                "risk_level": prior_diagnosis.risk_level,
                "supervisor_required": prior_diagnosis.risk_level in ("Caution", "High"),
            })
            row["confirmed_count"] += successful
            row["failed_count"] += failed
            row["workaround_count"] += int(bool(prior_diagnosis.workaround))
            row["recurrence_count"] += 1
    ranked_cause_list = sorted(
        ranked_causes.values(),
        key=lambda row: (-row["confirmed_count"], row["failed_count"], row["possible_cause"]),
    )
    for ranked in ranked_cause_list:
        ranked["recurrence_warning"] = (
            ranked["workaround_count"] > 0
            and ranked["recurrence_count"] > ranked["confirmed_count"]
        )

    updates = []
    for item in current_updates:
        author = db.get(User, item.author_id)
        reviews = db.scalars(
            select(ProcedureReview).where(ProcedureReview.procedure_update_id == item.id).order_by(ProcedureReview.created_at)
        ).all()
        updates.append(procedure_update_payload(item, author, reviews))
    return {
        "fault": {
            "id": fault.id,
            "reference": fault.reference,
            "equipment_id": fault.equipment_id,
            "equipment_tag": equipment.tag if fault.equipment_confirmed and equipment else (
                fault.reported_equipment_text or "Asset not identified"
            ),
            "equipment_name": equipment.name if fault.equipment_confirmed and equipment else "Asset not yet identified",
            "equipment_confirmed": bool(fault.equipment_confirmed),
            "reported_equipment_text": fault.reported_equipment_text,
            "reported_location": fault.reported_location,
            "suggested_equipment_tag": (
                db.get(Equipment, fault.suggested_equipment_id).tag
                if fault.suggested_equipment_id and db.get(Equipment, fault.suggested_equipment_id) else ""
            ),
            "symptom": fault.symptom,
            "description": fault.description,
            "operational_impact": fault.operational_impact,
            "operating_conditions": fault.operating_conditions,
            "status": fault.status,
            "assigned_section": fault.assigned_section,
            "assigned_user_id": fault.assigned_user_id,
            "active_assignment_id": current_assignment(fault).id if current_assignment(fault) else None,
            "reporter_name": fault.reporter.display_name if fault.reporter else "",
            "reported_on_behalf_of": fault.raised_by_text,
            "closure_remarks": fault.closure_remarks,
            "suggested_section": equipment.section if fault.equipment_confirmed and equipment else "Systems Automation",
            "created_at": fault.created_at.isoformat(),
        },
        "assignments": [{
            "id": item.id,
            "section": item.section,
            "assigned_by_name": item.assigned_by.display_name if item.assigned_by else "",
            "assigned_user_id": item.assigned_user_id,
            "assigned_user_name": item.assigned_user.display_name if item.assigned_user else "",
            "previous_assignment_id": item.previous_assignment_id,
            "reason": item.reason,
            "findings": item.findings,
            "recommendation": item.recommendation,
            "instructions": item.instructions,
            "response_due_at": item.response_due_at.isoformat() if item.response_due_at else None,
            "escalation_status": item.escalation_status,
            "requested_next_section": item.requested_next_section,
            "escalation_review_comments": item.escalation_review_comments,
            "completion_review_status": item.completion_review_status,
            "completion_review_comments": item.completion_review_comments,
            "status": item.status,
            "is_active": item.status in ACTIVE_ASSIGNMENT_STATUSES,
            "created_at": item.created_at.isoformat(),
            "acknowledged_at": item.acknowledged_at.isoformat() if item.acknowledged_at else None,
            "completed_at": item.completed_at.isoformat() if item.completed_at else None,
            "elapsed_minutes": max(0, int((
                utc_datetime(item.completed_at or utcnow()) - utc_datetime(item.created_at)
            ).total_seconds() / 60)),
        } for item in assignments],
        "attachments": [{
            "id": item.id,
            "assignment_id": item.assignment_id,
            "filename": item.original_filename,
            "content_type": item.content_type,
            "size_bytes": item.size_bytes,
            "uploaded_by": item.uploader.display_name if item.uploader else "",
            "created_at": item.created_at.isoformat(),
            "download_url": f"/api/v1/faults/{fault.id}/attachments/{item.id}",
        } for item in attachments],
        "operator_updates": operator_updates,
        "timeline": [{
            "id": event.id,
            "event_type": event.event_type,
            "actor_id": event.actor_id,
            "actor_name": actors.get(event.actor_id, event.actor_id),
            "payload": event.payload,
            "created_at": event.created_at.isoformat(),
        } for event in timeline],
        "diagnoses": [{
            "id": item.id,
            "assignment_id": item.assignment_id,
            "assignment_section": db.get(FaultAssignment, item.assignment_id).section if item.assignment_id and db.get(FaultAssignment, item.assignment_id) else "",
            "author_id": item.author_id,
            "author_name": db.get(User, item.author_id).display_name if db.get(User, item.author_id) else item.author_id,
            "possible_cause": item.possible_cause,
            "diagnostic_method": item.diagnostic_method,
            "observations": item.observations,
            "test_results": item.test_results,
            "confidence": item.confidence,
            "verification_status": item.verification_status,
            "quick_check": item.quick_check,
            "fix_summary": item.fix_summary,
            "workaround": bool(item.workaround),
            "risk_level": item.risk_level,
            "created_at": item.created_at.isoformat(),
        } for item in diagnoses],
        "interventions": [{
            "id": item.id,
            "assignment_id": item.assignment_id,
            "assignment_section": db.get(FaultAssignment, item.assignment_id).section if item.assignment_id and db.get(FaultAssignment, item.assignment_id) else "",
            "diagnosis_id": item.diagnosis_id,
            "actor_id": item.actor_id,
            "actor_name": db.get(User, item.actor_id).display_name if db.get(User, item.actor_id) else item.actor_id,
            "corrective_action": item.corrective_action,
            "tools_materials": item.tools_materials,
            "outcome": item.outcome,
            "notes": item.notes,
            "created_at": item.created_at.isoformat(),
        } for item in interventions],
        "previous_faults": history,
        "ranked_causes": ranked_cause_list,
        "repeat_routing": {
            "seen_before": bool(fault.equipment_confirmed and history),
            "repeat_count": len(history),
            "triage_action": "SA_FIRST_WITH_REPEAT_CONTEXT" if fault.equipment_confirmed and history else "SA_FIRST",
            "suggested_section": equipment.section if fault.equipment_confirmed and equipment else fault.assigned_section,
        },
        "approved_procedures": approved_procedures,
        "legacy_knowledge": [{
            "id": item.id,
            "reference": item.reference,
            "title": item.title,
            "symptom": item.symptom,
            "confirmed_cause": item.confirmed_cause,
            "diagnostic_procedure": item.diagnostic_procedure,
            "corrective_action": item.corrective_action,
            "version": item.version,
            "source_type": item.source_type,
            "instruction_type": item.instruction_type,
            "usage_scope": item.usage_scope,
            "legacy_reference": item.legacy_reference,
            "step_by_step": item.step_by_step,
            "review_status": item.review_status,
        } for item in legacy_knowledge],
        "procedure_updates": updates,
        "reuse_records": [{
            "id": item.id,
            "procedure_update_id": item.procedure_update_id,
            "procedure_reference": db.get(ProcedureUpdate, item.procedure_update_id).reference,
            "procedure_title": db.get(ProcedureUpdate, item.procedure_update_id).title,
            "actor_id": item.actor_id,
            "actor_name": db.get(User, item.actor_id).display_name if db.get(User, item.actor_id) else item.actor_id,
            "outcome": db.get(KnowledgeReuseOutcome, item.id).outcome if db.get(KnowledgeReuseOutcome, item.id) else None,
            "used_at": item.used_at.isoformat(),
        } for item in reuse_records],
    }


@app.post("/api/v1/faults/{fault_id}/diagnoses")
def record_diagnosis(fault_id: str, req: DiagnosisCreate, user: User = Depends(current_user), db: Session = Depends(db_dep)):
    require_roles(user, *INVESTIGATION_ROLES)
    fault = db.get(Fault, fault_id)
    if not fault:
        raise HTTPException(status_code=404, detail="Fault not found")
    require_fault_scope(user, fault)
    assignment = current_assignment(fault)
    if not assignment:
        raise HTTPException(status_code=409, detail="There is no active section assignment for this breakdown")
    require_current_assignment(user, fault)
    if assignment.escalation_status == "PENDING" or assignment.completion_review_status == "PENDING":
        raise HTTPException(status_code=409, detail="This assignment is awaiting Chief Technician review")
    if not req.possible_cause.strip() or not req.diagnostic_method.strip():
        raise HTTPException(status_code=422, detail="A possible cause and diagnostic method are required")
    if req.confidence is not None and not 0 <= req.confidence <= 1:
        raise HTTPException(status_code=422, detail="Confidence must be between 0 and 1")
    if req.risk_level not in ("Normal", "Caution", "High"):
        raise HTTPException(status_code=422, detail="Risk level must be Normal, Caution or High")
    if req.risk_level == "High" and not req.fix_summary.strip():
        raise HTTPException(status_code=422, detail="A fix summary is required for a high-risk diagnosis")
    diagnosis = Diagnosis(
        id=str(uuid.uuid4()),
        fault_id=fault.id,
        assignment_id=assignment.id,
        author_id=user.id,
        possible_cause=req.possible_cause.strip(),
        diagnostic_method=req.diagnostic_method.strip(),
        observations=req.observations.strip(),
        test_results=req.test_results.strip(),
        confidence=req.confidence,
        quick_check=req.quick_check.strip(),
        fix_summary=req.fix_summary.strip(),
        workaround=int(req.workaround),
        risk_level=req.risk_level,
    )
    db.add(diagnosis)
    fault.status = "DIAGNOSED"
    add_event(db, fault.id, "DIAGNOSIS_RECORDED", user.id, req.model_dump())
    db.commit()
    return {"id": diagnosis.id, "status": diagnosis.verification_status, "created_at": diagnosis.created_at.isoformat()}


@app.post("/api/v1/faults/{fault_id}/interventions")
def record_intervention(fault_id: str, req: InterventionCreate, user: User = Depends(current_user), db: Session = Depends(db_dep)):
    require_roles(user, *INVESTIGATION_ROLES)
    fault = db.get(Fault, fault_id)
    if not fault:
        raise HTTPException(status_code=404, detail="Fault not found")
    require_fault_scope(user, fault)
    assignment = current_assignment(fault)
    if not assignment:
        raise HTTPException(status_code=409, detail="There is no active section assignment for this breakdown")
    require_current_assignment(user, fault)
    if assignment.escalation_status == "PENDING" or assignment.completion_review_status == "PENDING":
        raise HTTPException(status_code=409, detail="This assignment is awaiting Chief Technician review")
    if req.outcome not in ("SUCCESS", "FAILED", "IN_PROGRESS"):
        raise HTTPException(status_code=422, detail="Outcome must be SUCCESS, FAILED or IN_PROGRESS")
    if not req.corrective_action.strip():
        raise HTTPException(status_code=422, detail="A corrective action is required")
    if req.diagnosis_id:
        diagnosis = db.get(Diagnosis, req.diagnosis_id)
        if not diagnosis or diagnosis.fault_id != fault.id:
            raise HTTPException(status_code=422, detail="Diagnosis must belong to this fault")
        if req.outcome == "SUCCESS":
            diagnosis.verification_status = "CONFIRMED"
    intervention = Intervention(
        id=str(uuid.uuid4()),
        fault_id=fault.id,
        assignment_id=assignment.id,
        diagnosis_id=req.diagnosis_id,
        actor_id=user.id,
        corrective_action=req.corrective_action.strip(),
        tools_materials=req.tools_materials.strip(),
        outcome=req.outcome,
        notes=req.notes.strip(),
    )
    db.add(intervention)
    add_event(db, fault.id, f"INTERVENTION_{req.outcome}", user.id, req.model_dump())
    db.commit()
    return {"id": intervention.id, "outcome": intervention.outcome, "created_at": intervention.created_at.isoformat()}


@app.post("/api/v1/faults/{fault_id}/procedure-updates")
def submit_procedure_update(fault_id: str, req: ProcedureUpdateCreate, user: User = Depends(current_user), db: Session = Depends(db_dep)):
    require_roles(user, *PROCEDURE_AUTHOR_ROLES)
    fault = db.get(Fault, fault_id)
    if not fault:
        raise HTTPException(status_code=404, detail="Fault not found")
    require_fault_scope(user, fault)
    if fault.status not in ("RESTORED", "CLOSED"):
        raise HTTPException(status_code=409, detail="A work-procedure update can be submitted after restoration")
    successful_intervention = db.scalar(
        select(Intervention.id).where(Intervention.fault_id == fault.id, Intervention.outcome == "SUCCESS").limit(1)
    )
    if not successful_intervention:
        raise HTTPException(status_code=409, detail="Record a successful intervention before submitting a work-procedure update")
    fields = [req.title, req.observed_symptom, req.confirmed_cause, req.diagnostic_procedure, req.corrective_action]
    if any(not value.strip() for value in fields):
        raise HTTPException(status_code=422, detail="Title, symptom, cause, diagnostic procedure and corrective action are required")
    update_id = str(uuid.uuid4())
    count = db.query(ProcedureUpdate).count() + 1
    update = ProcedureUpdate(
        id=update_id,
        reference=f"PU-DMO-{count:05d}",
        fault_id=fault.id,
        author_id=user.id,
        section=fault.equipment.section,
        title=req.title.strip(),
        observed_symptom=req.observed_symptom.strip(),
        confirmed_cause=req.confirmed_cause.strip(),
        diagnostic_procedure=req.diagnostic_procedure.strip(),
        corrective_action=req.corrective_action.strip(),
        safety=req.safety.strip(),
        version=1,
        lineage_id=update_id,
        status="SUBMITTED",
    )
    db.add(update)
    add_event(db, fault.id, "PROCEDURE_UPDATE_SUBMITTED", user.id, {"procedure_update_id": update.id, "reference": update.reference})
    db.commit()
    return procedure_update_payload(update, user)


@app.post("/api/v1/procedure-updates/{update_id}/revisions")
def revise_procedure_update(update_id: str, req: ProcedureUpdateCreate, user: User = Depends(current_user), db: Session = Depends(db_dep)):
    previous = db.get(ProcedureUpdate, update_id)
    if not previous:
        raise HTTPException(status_code=404, detail="Procedure update not found")
    fault = db.get(Fault, previous.fault_id)
    require_fault_scope(user, fault)
    if previous.author_id != user.id:
        raise HTTPException(status_code=403, detail="Only the contributing employee can submit this revision")
    if previous.status not in ("CLARIFICATION_REQUESTED", "APPROVED"):
        raise HTTPException(status_code=409, detail="Only a clarification request or published procedure can be revised")
    if fault.status not in ("RESTORED", "CLOSED"):
        raise HTTPException(status_code=409, detail="The source fault must remain restored before revising its procedure")
    fields = [req.title, req.observed_symptom, req.confirmed_cause, req.diagnostic_procedure, req.corrective_action]
    if any(not value.strip() for value in fields):
        raise HTTPException(status_code=422, detail="Title, symptom, cause, diagnostic procedure and corrective action are required")
    versions = db.scalars(select(ProcedureUpdate.version).where(ProcedureUpdate.lineage_id == previous.lineage_id)).all()
    version = max(versions, default=previous.version) + 1
    revision_id = str(uuid.uuid4())
    count = db.query(ProcedureUpdate).count() + 1
    revision = ProcedureUpdate(
        id=revision_id,
        reference=f"PU-DMO-{count:05d}",
        fault_id=previous.fault_id,
        author_id=user.id,
        section=previous.section,
        title=req.title.strip(),
        observed_symptom=req.observed_symptom.strip(),
        confirmed_cause=req.confirmed_cause.strip(),
        diagnostic_procedure=req.diagnostic_procedure.strip(),
        corrective_action=req.corrective_action.strip(),
        safety=req.safety.strip(),
        version=version,
        lineage_id=previous.lineage_id,
        previous_update_id=previous.id,
        status="SUBMITTED",
    )
    db.add(revision)
    add_event(db, fault.id, "PROCEDURE_REVISION_SUBMITTED", user.id, {
        "procedure_update_id": revision.id,
        "previous_update_id": previous.id,
        "version": version,
    })
    db.commit()
    return procedure_update_payload(revision, user)


@app.get("/api/v1/procedure-updates/review-queue")
def procedure_review_queue(user: User = Depends(current_user), db: Session = Depends(db_dep)):
    role = role_key(user)
    if role in ("technician_ct", "chief_engineer"):
        query = select(ProcedureUpdate).where(
            ProcedureUpdate.section == user.section,
            ProcedureUpdate.status == "SUBMITTED",
        )
    elif role == "supervisor":
        query = select(ProcedureUpdate).where(ProcedureUpdate.status == "CHIEF_APPROVED")
    else:
        raise HTTPException(status_code=403, detail="Only section chiefs and supervisors can review work-procedure updates")
    updates = db.scalars(query.order_by(ProcedureUpdate.created_at)).all()
    result = []
    for item in updates:
        reviews = db.scalars(
            select(ProcedureReview).where(ProcedureReview.procedure_update_id == item.id).order_by(ProcedureReview.created_at)
        ).all()
        payload = procedure_update_payload(item, db.get(User, item.author_id), reviews)
        fault = db.get(Fault, item.fault_id)
        payload["source_evidence"] = {
            "fault_reference": fault.reference,
            "symptom": fault.symptom,
            "description": fault.description,
            "status": fault.status,
            "diagnoses": [{
                "possible_cause": diagnosis.possible_cause,
                "diagnostic_method": diagnosis.diagnostic_method,
                "observations": diagnosis.observations,
                "test_results": diagnosis.test_results,
                "verification_status": diagnosis.verification_status,
            } for diagnosis in db.scalars(select(Diagnosis).where(Diagnosis.fault_id == fault.id)).all()],
            "interventions": [{
                "corrective_action": intervention.corrective_action,
                "outcome": intervention.outcome,
                "notes": intervention.notes,
            } for intervention in db.scalars(select(Intervention).where(Intervention.fault_id == fault.id)).all()],
        }
        result.append(payload)
    return result


@app.post("/api/v1/procedure-updates/{update_id}/review")
def review_procedure_update(update_id: str, req: ProcedureReviewRequest, user: User = Depends(current_user), db: Session = Depends(db_dep)):
    update = db.get(ProcedureUpdate, update_id)
    if not update:
        raise HTTPException(status_code=404, detail="Procedure update not found")
    if req.decision not in ("APPROVE", "REQUEST_CLARIFICATION", "REJECT"):
        raise HTTPException(status_code=422, detail="Decision must be APPROVE, REQUEST_CLARIFICATION or REJECT")
    if req.decision in ("REQUEST_CLARIFICATION", "REJECT") and not req.comments.strip():
        raise HTTPException(status_code=422, detail="A comment is required for clarification or rejection")
    if update.author_id == user.id:
        raise HTTPException(status_code=403, detail="Contributors cannot review or publish their own procedure updates")
    role = role_key(user)
    if role in ("technician_ct", "chief_engineer"):
        if update.section != user.section:
            raise HTTPException(status_code=404, detail="Procedure update not found")
        if update.status != "SUBMITTED":
            raise HTTPException(status_code=409, detail="Technical review is only available for submitted updates")
        if req.decision == "APPROVE":
            update.status = "CHIEF_APPROVED"
            review_decision = "TECHNICAL_APPROVED"
        elif req.decision == "REQUEST_CLARIFICATION":
            update.status = "CLARIFICATION_REQUESTED"
            review_decision = "CLARIFICATION_REQUESTED"
        else:
            update.status = "REJECTED"
            review_decision = "REJECTED"
    elif role == "supervisor":
        if req.decision == "APPROVE":
            if update.status != "CHIEF_APPROVED":
                raise HTTPException(status_code=409, detail="A section chief must complete technical review before publication")
            update.status = "APPROVED"
            review_decision = "SUPERVISOR_APPROVED"
        else:
            if update.status not in ("SUBMITTED", "CHIEF_APPROVED"):
                raise HTTPException(status_code=409, detail="This procedure update is not awaiting review")
            update.status = "CLARIFICATION_REQUESTED" if req.decision == "REQUEST_CLARIFICATION" else "REJECTED"
            review_decision = update.status
    else:
        raise HTTPException(status_code=403, detail="Only section chiefs and supervisors can review work-procedure updates")
    review = ProcedureReview(
        id=str(uuid.uuid4()),
        procedure_update_id=update.id,
        reviewer_id=user.id,
        decision=review_decision,
        comments=req.comments.strip(),
    )
    db.add(review)
    update.updated_at = utcnow()
    fault = db.get(Fault, update.fault_id)
    add_event(db, fault.id, "PROCEDURE_REVIEWED", user.id, {
        "procedure_update_id": update.id,
        "decision": review_decision,
        "status": update.status,
    })
    db.commit()
    return procedure_update_payload(update, db.get(User, update.author_id), [review])


@app.get("/api/v1/procedure-updates/library")
def procedure_library(user: User = Depends(current_user), db: Session = Depends(db_dep)):
    require_roles(user, "systems_automation", *TECHNICAL_ROLES, "maintenance_manager", "general_manager_om", "supervisor", "system_administrator")
    query = select(ProcedureUpdate).where(ProcedureUpdate.status == "APPROVED")
    if role_key(user) in TECHNICAL_ROLES:
        query = query.where(ProcedureUpdate.section == user.section)
    updates = db.scalars(query.order_by(ProcedureUpdate.updated_at.desc())).all()
    latest: dict[str, ProcedureUpdate] = {}
    for item in updates:
        current = latest.get(item.lineage_id)
        if current is None or item.version > current.version:
            latest[item.lineage_id] = item
    return [
        procedure_update_payload(
            item,
            db.get(User, item.author_id),
            db.scalars(select(ProcedureReview).where(ProcedureReview.procedure_update_id == item.id).order_by(ProcedureReview.created_at)).all(),
        )
        for item in latest.values()
    ]


@app.post("/api/v1/faults/{fault_id}/procedure-reuse")
def reuse_procedure(fault_id: str, req: KnowledgeReuseCreate, user: User = Depends(current_user), db: Session = Depends(db_dep)):
    require_roles(user, *INVESTIGATION_ROLES)
    fault = db.get(Fault, fault_id)
    update = db.get(ProcedureUpdate, req.procedure_update_id)
    if not fault:
        raise HTTPException(status_code=404, detail="Fault not found")
    require_fault_scope(user, fault)
    if not update or update.status != "APPROVED":
        raise HTTPException(status_code=404, detail="Approved procedure not found")
    reuse = KnowledgeReuse(
        id=str(uuid.uuid4()),
        procedure_update_id=update.id,
        fault_id=fault.id,
        actor_id=user.id,
    )
    db.add(reuse)
    add_event(db, fault.id, "KNOWLEDGE_REUSED", user.id, {
        "reuse_id": reuse.id,
        "procedure_update_id": update.id,
        "procedure_reference": update.reference,
    })
    db.commit()
    return {"id": reuse.id, "procedure_reference": update.reference, "used_at": reuse.used_at.isoformat()}


@app.post("/api/v1/procedure-reuse/{reuse_id}/outcome")
def confirm_procedure_reuse(reuse_id: str, req: KnowledgeReuseOutcomeCreate, user: User = Depends(current_user), db: Session = Depends(db_dep)):
    require_roles(user, *INVESTIGATION_ROLES)
    reuse = db.get(KnowledgeReuse, reuse_id)
    if not reuse:
        raise HTTPException(status_code=404, detail="Procedure reuse record not found")
    if reuse.actor_id != user.id:
        raise HTTPException(status_code=403, detail="Only the employee who recorded reuse can confirm its outcome")
    fault = db.get(Fault, reuse.fault_id)
    require_fault_scope(user, fault)
    if fault.status not in ("RESTORED", "CLOSED"):
        raise HTTPException(status_code=409, detail="Confirm reuse after the fault is restored")
    if req.outcome not in ("SUCCESS", "FAILED"):
        raise HTTPException(status_code=422, detail="Outcome must be SUCCESS or FAILED")
    if db.get(KnowledgeReuseOutcome, reuse.id):
        raise HTTPException(status_code=409, detail="This reuse outcome has already been confirmed")
    outcome = KnowledgeReuseOutcome(
        reuse_id=reuse.id,
        actor_id=user.id,
        outcome=req.outcome,
        comments=req.comments.strip(),
    )
    db.add(outcome)
    add_event(db, fault.id, "KNOWLEDGE_REUSE_CONFIRMED", user.id, {
        "reuse_id": reuse.id,
        "outcome": req.outcome,
    })
    db.commit()
    return {"reuse_id": reuse.id, "outcome": outcome.outcome, "confirmed_at": outcome.confirmed_at.isoformat()}


@app.post("/api/v1/faults/{fault_id}/triage")
def triage_fault(fault_id: str, req: TriageRequest, user: User = Depends(current_user), db: Session = Depends(db_dep)):
    require_roles(user, "systems_automation", "technician_ct", "chief_engineer", "maintenance_manager", "general_manager_om", "supervisor", "system_administrator")
    f = db.get(Fault, fault_id)
    if not f:
        raise HTTPException(status_code=404, detail="Fault not found")
    require_fault_scope(user, f)
    if role_key(user) in ("technician_ct", "chief_engineer") and req.assigned_section != user.section and not (
        not f.equipment_confirmed
        and not req.confirmed_equipment_id
        and req.assigned_section == "Systems Automation"
    ):
        raise HTTPException(status_code=403, detail="Section leads may only assign work within their section")
    active_assignment = current_assignment(f)
    if active_assignment:
        require_current_assignment(user, f)
        if req.assigned_section != active_assignment.section:
            raise HTTPException(status_code=422, detail="Use the section handoff action to transfer this assignment")
    if req.assigned_section not in SECTIONS:
        raise HTTPException(status_code=422, detail="Unknown maintenance section")
    confirmed_equipment = None
    if req.confirmed_equipment_id:
        if f.equipment_confirmed:
            raise HTTPException(status_code=409, detail="Equipment is already confirmed")
        confirmed_equipment = db.get(Equipment, req.confirmed_equipment_id)
        if not confirmed_equipment or confirmed_equipment.tag.startswith("UNCONFIRMED-"):
            raise HTTPException(status_code=404, detail="Confirmed equipment not found")
        require_equipment_scope(user, confirmed_equipment)
        if not active_assignment and req.assigned_section != confirmed_equipment.section:
            raise HTTPException(status_code=422, detail="Route the breakdown to the confirmed equipment section")
    elif not f.equipment_confirmed and req.assigned_section != "Systems Automation":
        raise HTTPException(status_code=422, detail="Confirm the asset before routing to an equipment section")
    if confirmed_equipment:
        f.equipment_id = confirmed_equipment.id
        f.equipment_confirmed = 1
    repeat_count = db.query(Fault).filter(
        Fault.equipment_id == f.equipment_id,
        Fault.equipment_confirmed == 1,
        Fault.id != f.id,
    ).count()
    add_event(db, fault_id, "FAULT_TRIAGED", user.id, {
        "triage_comment": req.triage_comment,
        "confirmed_equipment_id": confirmed_equipment.id if confirmed_equipment else None,
    })
    f.assigned_section = active_assignment.section if active_assignment else req.assigned_section
    if not active_assignment:
        db.add(FaultAssignment(
            id=str(uuid.uuid4()),
            fault_id=f.id,
            section=req.assigned_section,
            assigned_by_id=user.id,
            reason="Initial triage assignment",
        ))
    f.status = "ASSIGNED"
    add_event(db, fault_id, "FAULT_ASSIGNED", user.id, {
        **req.model_dump(),
        "suggested_section": f.equipment.section if f.equipment else "",
        "repeat_count": repeat_count,
        "repeat_routed_to_owner": bool(
            not active_assignment and repeat_count and f.equipment and req.assigned_section == f.equipment.section
        ),
    })
    db.commit()
    return {"reference": f.reference, "status": f.status, "assigned_section": f.assigned_section}


@app.post("/api/v1/faults/{fault_id}/assignments/{assignment_id}/allocate")
def allocate_section_assignment(
    fault_id: str,
    assignment_id: str,
    req: AssignmentAllocationRequest,
    user: User = Depends(current_user),
    db: Session = Depends(db_dep),
):
    require_roles(user, "technician_ct")
    fault = db.get(Fault, fault_id)
    assignment = db.get(FaultAssignment, assignment_id)
    if not fault or not assignment or assignment.fault_id != fault_id:
        raise HTTPException(status_code=404, detail="Section assignment not found")
    require_fault_scope(user, fault)
    if assignment.section != user.section or current_assignment(fault) != assignment:
        raise HTTPException(status_code=404, detail="Active assignment not found in your section")
    if assignment.escalation_status == "PENDING" or assignment.completion_review_status == "PENDING":
        raise HTTPException(status_code=409, detail="Resolve the pending technical review before changing this assignment")
    if req.severity not in ("Low", "Medium", "High", "Critical"):
        raise HTTPException(status_code=422, detail="Priority must be Low, Medium, High or Critical")
    if req.response_due_at and utc_datetime(req.response_due_at) <= utcnow():
        raise HTTPException(status_code=422, detail="Expected response time must be in the future")
    assignee = None
    if req.assigned_user_id:
        assignee = db.get(User, req.assigned_user_id)
        if (
            not assignee
            or not assignee.active
            or assignee.section != user.section
            or role_key(assignee) not in ASSIGNABLE_TECHNICIAN_ROLES
        ):
            raise HTTPException(status_code=422, detail="Choose an active Senior or Principal Technician in your section")
        if assignee.availability_status != "AVAILABLE":
            raise HTTPException(status_code=409, detail="This technician is marked unavailable")
    previous_assignee_id = assignment.assigned_user_id
    assignment.assigned_user_id = assignee.id if assignee else None
    assignment.instructions = req.instructions.strip()
    assignment.response_due_at = utc_datetime(req.response_due_at) if req.response_due_at else None
    fault.severity = req.severity
    fault.assigned_section = assignment.section
    fault.assigned_user_id = assignment.assigned_user_id
    if previous_assignee_id != assignment.assigned_user_id:
        assignment.status = "OPEN"
        assignment.acknowledged_at = None
        fault.status = "ASSIGNED"
    add_event(db, fault.id, "SECTION_WORK_ALLOCATED", user.id, {
        "assignment_id": assignment.id,
        "section": assignment.section,
        "previous_assigned_user_id": previous_assignee_id,
        "assigned_user_id": assignment.assigned_user_id,
        "priority": fault.severity,
        "response_due_at": assignment.response_due_at.isoformat() if assignment.response_due_at else None,
        "instructions": assignment.instructions,
    })
    db.commit()
    return {
        "assignment_id": assignment.id,
        "assigned_user_id": assignment.assigned_user_id,
        "priority": fault.severity,
        "response_due_at": assignment.response_due_at.isoformat() if assignment.response_due_at else None,
        "instructions": assignment.instructions,
    }


@app.post("/api/v1/faults/{fault_id}/assignments/{assignment_id}/review")
def review_section_assignment(
    fault_id: str,
    assignment_id: str,
    req: AssignmentReviewRequest,
    user: User = Depends(current_user),
    db: Session = Depends(db_dep),
):
    require_roles(user, "technician_ct")
    fault = db.get(Fault, fault_id)
    assignment = db.get(FaultAssignment, assignment_id)
    if not fault or not assignment or assignment.fault_id != fault_id:
        raise HTTPException(status_code=404, detail="Section assignment not found")
    require_fault_scope(user, fault)
    if assignment.section != user.section or current_assignment(fault) != assignment:
        raise HTTPException(status_code=404, detail="Active assignment not found in your section")
    if req.decision not in (
        "APPROVE_ESCALATION", "RETURN_ESCALATION",
        "APPROVE_COMPLETION", "RETURN_COMPLETION",
    ):
        raise HTTPException(status_code=422, detail="Choose an escalation or technical completion review decision")
    comments = req.comments.strip()
    if req.decision.startswith("RETURN_") and not comments:
        raise HTTPException(status_code=422, detail="A return decision requires instructions for further work")

    now = utcnow()
    if req.decision in ("APPROVE_ESCALATION", "RETURN_ESCALATION"):
        if assignment.escalation_status != "PENDING" or not assignment.requested_next_section:
            raise HTTPException(status_code=409, detail="This assignment has no escalation awaiting review")
        if req.decision == "RETURN_ESCALATION":
            assignment.escalation_status = "RETURNED"
            assignment.escalation_review_comments = comments
            fault.status = assignment.review_previous_fault_status or "DIAGNOSED"
            add_event(db, fault.id, "SECTION_ESCALATION_RETURNED", user.id, {
                "assignment_id": assignment.id,
                "comments": comments,
            })
            result_assignment_id = assignment.id
        else:
            next_section = assignment.requested_next_section
            if next_section not in SECTIONS or next_section == assignment.section:
                raise HTTPException(status_code=409, detail="The requested receiving section is no longer valid")
            assignment.status = "ESCALATED"
            assignment.completed_at = now
            assignment.escalation_status = "APPROVED"
            assignment.escalation_review_comments = comments
            next_assignment = FaultAssignment(
                id=str(uuid.uuid4()),
                fault_id=fault.id,
                section=next_section,
                assigned_by_id=user.id,
                previous_assignment_id=assignment.id,
                reason=assignment.recommendation,
            )
            db.add(next_assignment)
            fault.assigned_section = next_section
            fault.assigned_user_id = None
            fault.status = "ASSIGNED"
            add_event(db, fault.id, "SECTION_ASSIGNMENT_ESCALATED", user.id, {
                "previous_assignment_id": assignment.id,
                "next_assignment_id": next_assignment.id,
                "from_section": assignment.section,
                "to_section": next_assignment.section,
                "findings": assignment.findings,
                "recommendation": assignment.recommendation,
                "review_comments": comments,
            })
            add_event(db, fault.id, "FAULT_ASSIGNED", user.id, {
                "assignment_id": next_assignment.id,
                "previous_assignment_id": assignment.id,
                "assigned_section": next_assignment.section,
                "handoff": True,
            })
            result_assignment_id = next_assignment.id
    else:
        if assignment.completion_review_status != "PENDING":
            raise HTTPException(status_code=409, detail="This assignment has no technical completion awaiting review")
        if req.decision == "RETURN_COMPLETION":
            assignment.completion_review_status = "RETURNED"
            assignment.completion_review_comments = comments
            fault.status = assignment.review_previous_fault_status or "DIAGNOSED"
            add_event(db, fault.id, "TECHNICAL_COMPLETION_RETURNED", user.id, {
                "assignment_id": assignment.id,
                "comments": comments,
            })
        else:
            successful_intervention = db.scalar(
                select(Intervention.id).where(
                    Intervention.assignment_id == assignment.id,
                    Intervention.outcome == "SUCCESS",
                ).limit(1)
            )
            if not successful_intervention:
                raise HTTPException(status_code=409, detail="Record a successful corrective intervention before approving technical completion")
            assignment.completion_review_status = "APPROVED"
            assignment.completion_review_comments = comments
            assignment.status = "RESTORED"
            assignment.completed_at = now
            fault.status = "RESTORED"
            fault.restored_at = now
            add_event(db, fault.id, "FAULT_RESTORE", assignment.assigned_user_id or user.id, {
                "assignment_id": assignment.id,
                "technical_reviewed_by": user.id,
            })
            add_event(db, fault.id, "TECHNICAL_COMPLETION_APPROVED", user.id, {
                "assignment_id": assignment.id,
                "comments": comments,
            })
    db.commit()
    return {
        "fault_id": fault.id,
        "assignment_id": result_assignment_id if req.decision == "APPROVE_ESCALATION" else assignment.id,
        "assigned_section": fault.assigned_section,
        "status": fault.status,
        "decision": req.decision,
    }


@app.post("/api/v1/faults/{fault_id}/assignments/escalate")
def escalate_assignment(
    fault_id: str,
    req: SectionEscalationCreate,
    user: User = Depends(current_user),
    db: Session = Depends(db_dep),
):
    require_roles(user, "systems_automation", *INVESTIGATION_ROLES, "maintenance_manager", "supervisor", "system_administrator")
    fault = db.get(Fault, fault_id)
    if not fault:
        raise HTTPException(status_code=404, detail="Fault not found")
    require_fault_scope(user, fault)
    assignment = current_assignment(fault)
    if not assignment:
        raise HTTPException(status_code=409, detail="This breakdown has no active section assignment")
    require_current_assignment(user, fault)
    if not fault.equipment_confirmed:
        raise HTTPException(status_code=409, detail="Confirm the physical equipment before handing off technical work")
    if assignment.escalation_status == "PENDING" or assignment.completion_review_status == "PENDING":
        raise HTTPException(status_code=409, detail="This assignment already has a technical review pending")
    if req.next_section not in SECTIONS or req.next_section == assignment.section:
        raise HTTPException(status_code=422, detail="Choose a different, valid maintenance section")
    if not req.findings.strip() or not req.recommendation.strip():
        raise HTTPException(status_code=422, detail="Record findings and a recommended next action before handoff")

    assignment.findings = req.findings.strip()
    assignment.recommendation = req.recommendation.strip()
    assignment.escalation_status = "PENDING"
    assignment.requested_next_section = req.next_section
    assignment.review_previous_fault_status = fault.status
    fault.status = "AWAITING_CHIEF_REVIEW"
    add_event(db, fault.id, "SECTION_ESCALATION_SUBMITTED_FOR_REVIEW", user.id, {
        "assignment_id": assignment.id,
        "from_section": assignment.section,
        "to_section": req.next_section,
        "findings": assignment.findings,
        "recommendation": assignment.recommendation,
    })
    db.commit()
    return {
        "fault_id": fault.id,
        "assignment_id": assignment.id,
        "requested_section": assignment.requested_next_section,
        "escalation_status": assignment.escalation_status,
        "status": fault.status,
    }


@app.post("/api/v1/faults/{fault_id}/operator-updates")
def add_operator_update(
    fault_id: str,
    req: OperatorUpdateCreate,
    user: User = Depends(current_user),
    db: Session = Depends(db_dep),
):
    require_roles(user, "operations")
    fault = db.get(Fault, fault_id)
    if not fault:
        raise HTTPException(status_code=404, detail="Fault not found")
    require_fault_scope(user, fault)
    if fault.status == "CLOSED":
        raise HTTPException(status_code=409, detail="A closed breakdown cannot receive further operator updates")
    note = req.note.strip()
    if not note:
        raise HTTPException(status_code=422, detail="Enter an update for the responding team")
    add_event(db, fault.id, "OPERATOR_UPDATE", user.id, {"note": note})
    db.commit()
    return {"fault_id": fault.id, "status": fault.status}


@app.post("/api/v1/faults/{fault_id}/operator-confirmation")
def confirm_operator_restoration(
    fault_id: str,
    req: OperatorConfirmationCreate,
    user: User = Depends(current_user),
    db: Session = Depends(db_dep),
):
    require_roles(user, "operations")
    fault = db.get(Fault, fault_id)
    if not fault:
        raise HTTPException(status_code=404, detail="Fault not found")
    require_fault_scope(user, fault)
    if fault.status != "RESTORED":
        raise HTTPException(status_code=409, detail="Operator confirmation is available after a section reports restoration")
    comments = req.comments.strip()
    if not req.confirmed and not comments:
        raise HTTPException(status_code=422, detail="Describe what remains wrong so the section can continue")
    assignment = max(fault.assignments, key=lambda item: item.created_at) if fault.assignments else None
    if req.confirmed:
        fault.status = "CLOSED"
        fault.closure_remarks = comments
        add_event(db, fault.id, "FAULT_OPERATOR_CONFIRMED", user.id, {"comments": comments})
        add_event(db, fault.id, "FAULT_CLOSE", user.id, {"comments": comments})
    else:
        section = assignment.section if assignment else fault.assigned_section or "Systems Automation"
        reopened = FaultAssignment(
            id=str(uuid.uuid4()),
            fault_id=fault.id,
            section=section,
            assigned_by_id=user.id,
            previous_assignment_id=assignment.id if assignment else None,
            reason="Operator did not confirm restoration",
        )
        db.add(reopened)
        fault.assigned_section = section
        fault.assigned_user_id = None
        fault.restored_at = None
        fault.status = "ASSIGNED"
        add_event(db, fault.id, "FAULT_OPERATOR_REJECTED_RESTORATION", user.id, {
            "comments": comments,
            "reopened_assignment_id": reopened.id,
            "assigned_section": section,
        })
    db.commit()
    return {"fault_id": fault.id, "status": fault.status, "confirmed": req.confirmed}


@app.post("/api/v1/faults/{fault_id}/attachments")
async def upload_fault_attachment(
    fault_id: str,
    file: UploadFile = File(...),
    assignment_id: str | None = Query(default=None),
    user: User = Depends(current_user),
    db: Session = Depends(db_dep),
):
    require_roles(user, "operations", *INVESTIGATION_ROLES, "maintenance_manager", "general_manager_om", "supervisor", "system_administrator")
    fault = db.get(Fault, fault_id)
    if not fault:
        raise HTTPException(status_code=404, detail="Fault not found")
    require_fault_scope(user, fault)
    if fault.status == "CLOSED":
        raise HTTPException(status_code=409, detail="Evidence cannot be added to a closed breakdown")

    active_assignment = current_assignment(fault)
    attachment_assignment_id = assignment_id
    if role_key(user) in TECHNICAL_ROLES:
        if not active_assignment:
            raise HTTPException(status_code=409, detail="There is no active section assignment for this breakdown")
        require_current_assignment(user, fault)
        if assignment_id and assignment_id != active_assignment.id:
            raise HTTPException(status_code=422, detail="Evidence must be attached to the active section assignment")
        attachment_assignment_id = active_assignment.id
    elif assignment_id:
        target_assignment = db.get(FaultAssignment, assignment_id)
        if not target_assignment or target_assignment.fault_id != fault.id:
            raise HTTPException(status_code=404, detail="Section assignment not found")

    extension = Path(file.filename or "").suffix.lower()
    media_type = ALLOWED_ATTACHMENT_TYPES.get(extension)
    if not media_type:
        raise HTTPException(status_code=415, detail="Upload a PNG, JPEG, WebP, PDF, CSV, TXT, JSON or LOG file")
    supplied_type = (file.content_type or "").lower()
    accepted_types = {media_type}
    if extension == ".csv":
        accepted_types.add("text/plain")
    if supplied_type and supplied_type not in accepted_types and supplied_type != "application/octet-stream":
        raise HTTPException(status_code=415, detail="The uploaded file type does not match its extension")
    content = await file.read(MAX_ATTACHMENT_BYTES + 1)
    if not content:
        raise HTTPException(status_code=422, detail="The uploaded file is empty")
    if len(content) > MAX_ATTACHMENT_BYTES:
        raise HTTPException(status_code=413, detail="Each attachment must be 10 MiB or smaller")

    attachment_id = str(uuid.uuid4())
    storage_key = f"{uuid.uuid4().hex}{extension}"
    storage_path = ATTACHMENT_STORAGE_DIR / storage_key
    ATTACHMENT_STORAGE_DIR.mkdir(parents=True, exist_ok=True)
    storage_path.write_bytes(content)
    original_filename = (file.filename or "evidence").replace("\\", "/").rsplit("/", 1)[-1]
    original_filename = "".join(character for character in original_filename if character >= " " and character != "\x7f")[:255]
    if not original_filename:
        original_filename = f"evidence{extension}"
    attachment = FaultAttachment(
        id=attachment_id,
        fault_id=fault.id,
        assignment_id=attachment_assignment_id,
        uploader_id=user.id,
        original_filename=original_filename,
        storage_key=storage_key,
        content_type=media_type,
        size_bytes=len(content),
    )
    db.add(attachment)
    add_event(db, fault.id, "EVIDENCE_ATTACHED", user.id, {
        "attachment_id": attachment.id,
        "assignment_id": attachment.assignment_id,
        "filename": attachment.original_filename,
        "size_bytes": attachment.size_bytes,
    })
    try:
        db.commit()
    except SQLAlchemyError:
        db.rollback()
        if storage_path.exists():
            storage_path.unlink()
        raise
    return {
        "id": attachment.id,
        "fault_id": attachment.fault_id,
        "assignment_id": attachment.assignment_id,
        "filename": attachment.original_filename,
        "content_type": attachment.content_type,
        "size_bytes": attachment.size_bytes,
    }


@app.get("/api/v1/faults/{fault_id}/attachments/{attachment_id}")
def download_fault_attachment(
    fault_id: str,
    attachment_id: str,
    user: User = Depends(current_user),
    db: Session = Depends(db_dep),
):
    fault = db.get(Fault, fault_id)
    if not fault:
        raise HTTPException(status_code=404, detail="Fault not found")
    require_fault_scope(user, fault)
    attachment = db.get(FaultAttachment, attachment_id)
    if not attachment or attachment.fault_id != fault.id:
        raise HTTPException(status_code=404, detail="Attachment not found")
    storage_path = ATTACHMENT_STORAGE_DIR / Path(attachment.storage_key).name
    if not storage_path.is_file():
        raise HTTPException(status_code=404, detail="Attachment file is unavailable")
    return FileResponse(storage_path, media_type=attachment.content_type, filename=attachment.original_filename)


@app.post("/api/v1/faults/{fault_id}/action")
def fault_action(fault_id: str, action: str, user: User = Depends(current_user), db: Session = Depends(db_dep)):
    action_roles = {
        "acknowledge": (*INVESTIGATION_ROLES, "maintenance_manager", "general_manager_om", "supervisor", "system_administrator"),
        "on_site": (*INVESTIGATION_ROLES, "maintenance_manager", "general_manager_om", "supervisor", "system_administrator"),
        "diagnose": (*INVESTIGATION_ROLES, "maintenance_manager", "general_manager_om", "supervisor", "system_administrator"),
        "restore": ("systems_automation", "technician_st", "technician_pt", "senior_engineer", "chief_engineer", "maintenance_manager", "general_manager_om", "supervisor", "system_administrator"),
        "close": ("chief_engineer", "maintenance_manager", "general_manager_om", "supervisor", "system_administrator"),
    }
    if action not in action_roles:
        raise HTTPException(status_code=400, detail="Unknown fault action")
    require_roles(user, *action_roles[action])
    f = db.get(Fault, fault_id)
    if not f:
        raise HTTPException(status_code=404, detail="Fault not found")
    require_fault_scope(user, f)
    if action == "close":
        raise HTTPException(status_code=409, detail="Operations must confirm restoration before the breakdown can close")
    if not f.equipment_confirmed:
        raise HTTPException(status_code=409, detail="Confirm the physical equipment before starting technical work")
    assignment = current_assignment(f)
    if assignment:
        require_current_assignment(user, f)
    else:
        section = f.assigned_section or (f.equipment.section if f.equipment else "")
        assignment = FaultAssignment(
            id=str(uuid.uuid4()),
            fault_id=f.id,
            section=section,
            assigned_by_id=user.id,
            reason="Existing fault section assignment",
            created_at=f.created_at,
        )
        db.add(assignment)
        f.assigned_section = section
    if assignment.escalation_status == "PENDING" or assignment.completion_review_status == "PENDING":
        raise HTTPException(status_code=409, detail="This assignment is awaiting Chief Technician review")
    if action == "restore":
        successful_intervention = db.scalar(
            select(Intervention.id).where(
                Intervention.assignment_id == assignment.id,
                Intervention.outcome == "SUCCESS",
            ).limit(1)
        )
        if not successful_intervention:
            raise HTTPException(status_code=409, detail="Record a successful corrective intervention before requesting technical completion")
        assignment.completion_review_status = "PENDING"
        assignment.review_previous_fault_status = f.status
        f.status = "AWAITING_CHIEF_REVIEW"
        add_event(db, f.id, "TECHNICAL_COMPLETION_SUBMITTED_FOR_REVIEW", user.id, {
            "assignment_id": assignment.id,
            "section": assignment.section,
        })
        db.commit()
        return {
            "reference": f.reference,
            "status": f.status,
            "completion_review_status": assignment.completion_review_status,
        }
    if action == "acknowledge":
        if assignment.assigned_user_id and assignment.assigned_user_id != user.id:
            raise HTTPException(status_code=409, detail="This breakdown is already assigned to another employee")
        assignment.assigned_user_id = user.id
        assignment.status = "ACKNOWLEDGED"
        assignment.acknowledged_at = utcnow()
        f.assigned_user_id = user.id
        if assignment.section == "Systems Automation" and not db.scalar(
            select(FaultEvent.id).where(FaultEvent.fault_id == f.id, FaultEvent.event_type == "FAULT_TRIAGED").limit(1)
        ):
            add_event(db, f.id, "FAULT_TRIAGED", user.id, {
                "assignment_id": assignment.id,
                "triage_method": "Systems Automation accepted the initial response",
            })
    transitions = {"acknowledge": "ACKNOWLEDGED", "on_site": "ON_SITE", "diagnose": "DIAGNOSED"}
    f.status = transitions[action]
    if action in ("on_site", "diagnose"):
        assignment.status = "IN_PROGRESS"
    add_event(db, fault_id, f"FAULT_{action.upper()}", user.id, {"assignment_id": assignment.id})
    db.commit()
    return {"reference": f.reference, "status": f.status}


@app.get("/api/v1/knowledge")
def knowledge_list(status_filter: str = "", search: str = "", source_type: str = "", user: User = Depends(current_user), db: Session = Depends(db_dep)):
    require_roles(user, "systems_automation", "technician_st", "technician_pt", "technician_ct", "assistant_engineer", "engineer", "senior_engineer", "chief_engineer", "maintenance_manager", "general_manager_om", "supervisor", "system_administrator")
    query = select(KnowledgeEntry)
    if role_key(user) not in ("maintenance_manager", "general_manager_om", "supervisor", "system_administrator"):
        query = query.where(KnowledgeEntry.status == "APPROVED")
    if status_filter:
        if status_filter != "APPROVED" and role_key(user) not in ("maintenance_manager", "supervisor", "system_administrator"):
            raise HTTPException(status_code=403, detail="Only reviewers may view unapproved knowledge")
        query = query.where(KnowledgeEntry.status == status_filter)
    if search:
        needle = f"%{search.lower()}%"
        query = query.where(KnowledgeEntry.title.ilike(needle) | KnowledgeEntry.symptom.ilike(needle) | KnowledgeEntry.confirmed_cause.ilike(needle))
    if source_type:
        if source_type not in ("LEGACY_PROCEDURE", "FAULT_DERIVED"):
            raise HTTPException(status_code=422, detail="Unknown knowledge source type")
        query = query.where(KnowledgeEntry.source_type == source_type)
    entries = db.scalars(query.limit(200)).all()
    return [{
        "id": e.id,
        "reference": e.reference,
        "equipment_id": e.equipment_id,
        "title": e.title,
        "symptom": e.symptom,
        "confirmed_cause": e.confirmed_cause,
        "diagnostic_procedure": e.diagnostic_procedure,
        "corrective_action": e.corrective_action,
        "safety": e.safety,
        "status": e.status,
        "version": e.version,
        "source_type": e.source_type,
        "instruction_type": e.instruction_type,
        "usage_scope": e.usage_scope,
        "legacy_reference": e.legacy_reference,
        "step_by_step": e.step_by_step,
        "review_status": e.review_status,
        "superseded_by_id": e.superseded_by_id,
    } for e in entries]


@app.post("/api/v1/knowledge")
def create_knowledge(req: KnowledgeCreate, user: User = Depends(current_user), db: Session = Depends(db_dep)):
    require_roles(user, "technician_st", "technician_pt", "technician_ct", "assistant_engineer", "engineer", "senior_engineer", "chief_engineer", "maintenance_manager", "general_manager_om", "system_administrator")
    if req.equipment_id:
        equipment = db.get(Equipment, req.equipment_id)
        if not equipment:
            raise HTTPException(status_code=404, detail="Equipment not found")
        require_equipment_scope(user, equipment)
    if req.source_type not in ("LEGACY_PROCEDURE", "FAULT_DERIVED"):
        raise HTTPException(status_code=422, detail="Unknown knowledge source type")
    if req.source_type == "LEGACY_PROCEDURE" and not req.step_by_step.strip():
        raise HTTPException(status_code=422, detail="Legacy work instructions require numbered step-by-step text")
    count = db.query(KnowledgeEntry).count() + 1
    entry = KnowledgeEntry(
        id=str(uuid.uuid4()),
        reference=f"KN-DMO-{count:04d}",
        equipment_id=req.equipment_id,
        title=req.title,
        symptom=req.symptom,
        confirmed_cause=req.confirmed_cause,
        diagnostic_procedure=req.diagnostic_procedure,
        corrective_action=req.corrective_action,
        safety=req.safety,
        status="SUBMITTED" if req.source_type == "LEGACY_PROCEDURE" else "DRAFT",
        author_id=user.id,
        source_type=req.source_type,
        instruction_type=req.instruction_type,
        usage_scope=req.usage_scope,
        legacy_reference=req.legacy_reference,
        step_by_step=req.step_by_step,
        review_status="LEGACY_SUBMITTED" if req.source_type == "LEGACY_PROCEDURE" else "DIGITAL_REVIEW",
    )
    db.add(entry)
    db.commit()
    return {"id": entry.id, "reference": entry.reference, "status": entry.status}


@app.post("/api/v1/knowledge/{knowledge_id}/status")
def knowledge_status(knowledge_id: str, target_status: str, user: User = Depends(current_user), db: Session = Depends(db_dep)):
    require_roles(user, "maintenance_manager", "supervisor")
    entry = db.get(KnowledgeEntry, knowledge_id)
    if not entry:
        raise HTTPException(status_code=404, detail="Knowledge entry not found")
    if target_status not in ("SUBMITTED", "APPROVED", "REJECTED", "SUPERSEDED"):
        raise HTTPException(status_code=400, detail="Invalid knowledge status")
    entry.status = target_status
    if entry.source_type == "LEGACY_PROCEDURE":
        entry.review_status = {
            "APPROVED": "LEGACY_APPROVED",
            "REJECTED": "LEGACY_REJECTED",
            "SUPERSEDED": "LEGACY_SUPERSEDED",
            "SUBMITTED": "LEGACY_SUBMITTED",
        }[target_status]
    entry.updated_at = utcnow()
    db.commit()
    return {"id": entry.id, "status": entry.status, "version": entry.version}


@app.get("/api/v1/intelligence/equipment/{equipment_id}")
def recurring_intelligence(equipment_id: str, user: User = Depends(current_user), db: Session = Depends(db_dep)):
    require_roles(user, "systems_automation", "technician_st", "technician_pt", "technician_ct", "assistant_engineer", "engineer", "senior_engineer", "chief_engineer", "maintenance_manager", "general_manager_om", "supervisor", "system_administrator")
    equipment = db.get(Equipment, equipment_id)
    if not equipment:
        raise HTTPException(status_code=404, detail="Equipment not found")
    require_equipment_scope(user, equipment)
    faults = db.scalars(select(Fault).where(Fault.equipment_id == equipment_id).order_by(Fault.created_at.desc())).all()
    recent = [f for f in faults if f.created_at.replace(tzinfo=timezone.utc) >= utcnow() - timedelta(days=90)]
    ranked_causes = []
    for fault in recent:
        diagnoses = db.scalars(select(Diagnosis).where(Diagnosis.fault_id == fault.id)).all()
        interventions = db.scalars(select(Intervention).where(Intervention.fault_id == fault.id)).all()
        for diagnosis in diagnoses:
            interventions_by_diagnosis = [
                item for item in interventions
                if item.diagnosis_id == diagnosis.id
            ]
            successful = sum(item.outcome == "SUCCESS" for item in interventions_by_diagnosis)
            failed = sum(item.outcome == "FAILED" for item in interventions_by_diagnosis)
            ranked_causes.append({
                "possible_cause": diagnosis.possible_cause,
                "quick_check": diagnosis.quick_check,
                "fix": diagnosis.fix_summary,
                "confirmed_count": successful,
                "failed_count": failed,
                "workaround": bool(diagnosis.workaround),
                "risk_level": diagnosis.risk_level,
                "recurring_count": len([item for item in recent if item.id != fault.id]),
            })
    cause_totals: dict[str, dict] = {}
    for cause in ranked_causes:
        row = cause_totals.setdefault(cause["possible_cause"], {
            "possible_cause": cause["possible_cause"],
            "quick_check": cause["quick_check"],
            "fix": cause["fix"],
            "confirmed_count": 0,
            "failed_count": 0,
            "workaround_count": 0,
            "high_risk_count": 0,
            "recurring_count": 0,
        })
        row["confirmed_count"] += cause["confirmed_count"]
        row["failed_count"] += cause["failed_count"]
        row["workaround_count"] += int(cause["workaround"])
        row["high_risk_count"] += int(cause["risk_level"] in ("Caution", "High"))
        row["recurring_count"] += cause["recurring_count"]
    ranked_causes = sorted(
        cause_totals.values(),
        key=lambda row: (-row["confirmed_count"], row["failed_count"], row["possible_cause"]),
    )
    for row in ranked_causes:
        row["recurrence_warning"] = bool(
            row["workaround_count"] > 0
            and row["recurring_count"] > row["confirmed_count"]
        )
        row["supervisor_required"] = row["high_risk_count"] > 0
    last = recent[0] if recent else None
    return {
        "repeat_count": len(recent),
        "seen_label": f"Seen {len(recent)} times in the last 90 days",
        "seen_before": len(recent) > 0,
        "last_occurrence": {
            "reference": last.reference,
            "date": last.created_at.isoformat(),
            "status": last.status,
            "assigned_section": last.assigned_section or last.equipment.section,
        } if last else None,
        "suggested_section": equipment.section,
        "triage_action": "SA_FIRST_WITH_REPEAT_CONTEXT" if len(recent) > 0 else "SA_FIRST",
        "ranked_causes": ranked_causes,
        "previous_occurrences": [{"reference": f.reference, "symptom": f.symptom, "category": f.category, "status": f.status, "date": f.created_at.isoformat()} for f in recent[:10]],
        "ranking_note": "Deterministic history-based indication; not a confirmed root cause.",
    }


def workflow_summary(faults: list[Fault], db: Session) -> dict:
    fault_ids = [item.id for item in faults]
    events = db.scalars(
        select(FaultEvent).where(FaultEvent.fault_id.in_(fault_ids)).order_by(FaultEvent.created_at)
    ).all() if fault_ids else []
    assignments = db.scalars(
        select(FaultAssignment).where(FaultAssignment.fault_id.in_(fault_ids))
    ).all() if fault_ids else []
    assignment_by_id = {item.id: item for item in assignments}
    events_by_fault: dict[str, list[FaultEvent]] = {}
    for event in events:
        events_by_fault.setdefault(event.fault_id, []).append(event)
    users = db.scalars(select(User)).all()
    user_by_id = {item.id: item for item in users}
    stage_types = {
        "reported": ("FAULT_REPORTED",),
        "triaged": ("FAULT_TRIAGED",),
        "assigned": ("FAULT_ASSIGNED",),
        "acknowledged": ("FAULT_ACKNOWLEDGE",),
        "on_site": ("FAULT_ON_SITE",),
        "diagnosed": ("FAULT_DIAGNOSE", "DIAGNOSIS_RECORDED"),
        "restored": ("FAULT_RESTORE",),
        "closed": ("FAULT_CLOSE",),
    }
    stage_counts = {stage: 0 for stage in stage_types}
    section_counts: dict[str, dict[str, int]] = {}
    handoffs: dict[str, dict[str, int]] = {}
    handoff_defaults = {
        "operations_reports": 0,
        "systems_automation_triage": 0,
        "assigned_to_section": 0,
        "section_acknowledgements": 0,
        "restorations": 0,
        "knowledge_reuses": 0,
        "repeat_direct_routes": 0,
        "section_handoffs_sent": 0,
        "section_handoffs_received": 0,
    }

    def section_handoff(section_name: str) -> dict[str, int]:
        return handoffs.setdefault(section_name, handoff_defaults.copy())

    triage_times: list[float] = []
    acknowledgement_times: list[float] = []
    restoration_times: list[float] = []
    report_to_triage_minutes: list[float] = []
    triage_to_acknowledge_minutes: list[float] = []
    acknowledge_to_diagnose_minutes: list[float] = []
    diagnose_to_restore_minutes: list[float] = []
    restore_to_close_minutes: list[float] = []
    repeat_report_to_restore_minutes: list[float] = []
    first_report_to_restore_minutes: list[float] = []
    assignment_count = 0
    wrong_first_assignment_count = 0
    operations_report_count = 0
    automation_triage_count = 0

    for fault in faults:
        section = fault.assigned_section or (fault.equipment.section if fault.equipment else "Unassigned")
        section_row = section_counts.setdefault(section, {stage: 0 for stage in stage_types})
        handoff_row = section_handoff(section)
        reporter = user_by_id.get(fault.reporter_id)
        if reporter and role_key(reporter) == "operations":
            operations_report_count += 1
            operations_row = section_handoff("Operations")
            operations_row["operations_reports"] += 1
        fault_events = events_by_fault.get(fault.id, [])
        first_event_by_stage: dict[str, FaultEvent] = {}
        for event in fault_events:
            for stage, event_types in stage_types.items():
                if event.event_type in event_types and stage not in first_event_by_stage:
                    first_event_by_stage[stage] = event
            if event.event_type == "KNOWLEDGE_REUSED":
                handoff_row["knowledge_reuses"] += 1
        for stage, event in first_event_by_stage.items():
            stage_counts[stage] += 1
            section_row[stage] += 1
        reported_event = first_event_by_stage.get("reported")
        triage_event = first_event_by_stage.get("triaged")
        acknowledgement_event = first_event_by_stage.get("acknowledged")
        diagnosed_event = first_event_by_stage.get("diagnosed")
        restored_event = first_event_by_stage.get("restored")
        closed_event = first_event_by_stage.get("closed")
        if reported_event and triage_event:
            report_to_triage_minutes.append(
                (utc_datetime(triage_event.created_at) - utc_datetime(reported_event.created_at)).total_seconds() / 60
            )
        if triage_event and acknowledgement_event:
            triage_to_acknowledge_minutes.append(
                (utc_datetime(acknowledgement_event.created_at) - utc_datetime(triage_event.created_at)).total_seconds() / 60
            )
        if acknowledgement_event and diagnosed_event:
            acknowledge_to_diagnose_minutes.append(
                (utc_datetime(diagnosed_event.created_at) - utc_datetime(acknowledgement_event.created_at)).total_seconds() / 60
            )
        if diagnosed_event and restored_event:
            diagnose_to_restore_minutes.append(
                (utc_datetime(restored_event.created_at) - utc_datetime(diagnosed_event.created_at)).total_seconds() / 60
            )
        if restored_event and closed_event:
            restore_to_close_minutes.append(
                (utc_datetime(closed_event.created_at) - utc_datetime(restored_event.created_at)).total_seconds() / 60
            )
        repeat_count = sum(
            1 for prior in faults
            if prior.id != fault.id
            and prior.equipment_id == fault.equipment_id
            and prior.created_at < fault.created_at
        )
        if reported_event and restored_event:
            elapsed_minutes = (
                utc_datetime(restored_event.created_at) - utc_datetime(reported_event.created_at)
            ).total_seconds() / 60
            if repeat_count:
                repeat_report_to_restore_minutes.append(elapsed_minutes)
            else:
                first_report_to_restore_minutes.append(elapsed_minutes)
        if triage_event:
            actor = user_by_id.get(triage_event.actor_id)
            if actor and role_key(actor) == "systems_automation":
                automation_triage_count += 1
                automation_row = section_handoff("Systems Automation")
                automation_row["systems_automation_triage"] += 1
            triage_times.append((utc_datetime(triage_event.created_at) - utc_datetime(fault.created_at)).total_seconds() / 60)
        assignment_events = [event for event in fault_events if event.event_type == "FAULT_ASSIGNED"]
        for assignment_event in assignment_events:
            try:
                assignment_payload = json.loads(assignment_event.payload or "{}")
            except json.JSONDecodeError:
                assignment_payload = {}
            receiving_section = assignment_payload.get("assigned_section") or section
            receiving_row = section_handoff(receiving_section)
            receiving_row["assigned_to_section"] += 1
            if assignment_payload.get("repeat_routed_to_owner"):
                receiving_row["repeat_direct_routes"] += 1
        for escalation_event in (event for event in fault_events if event.event_type == "SECTION_ASSIGNMENT_ESCALATED"):
            try:
                escalation_payload = json.loads(escalation_event.payload or "{}")
            except json.JSONDecodeError:
                escalation_payload = {}
            source_section = escalation_payload.get("from_section") or section
            destination_section = escalation_payload.get("to_section") or section
            source_row = section_handoff(source_section)
            destination_row = section_handoff(destination_section)
            source_row["section_handoffs_sent"] += 1
            destination_row["section_handoffs_received"] += 1
        if "assigned" in first_event_by_stage:
            assignment_count += 1
            assignment = first_event_by_stage["assigned"]
            try:
                assignment_payload = json.loads(assignment.payload or "{}")
            except json.JSONDecodeError:
                assignment_payload = {}
            suggested_section = assignment_payload.get("suggested_section") or (fault.equipment.section if fault.equipment else "")
            assigned_section = assignment_payload.get("assigned_section") or section
            if (
                assignment_payload.get("routing_strategy") != "SYSTEMS_AUTOMATION_FIRST"
                and suggested_section
                and assigned_section != suggested_section
            ):
                wrong_first_assignment_count += 1
        if "acknowledged" in first_event_by_stage:
            acknowledgement = first_event_by_stage["acknowledged"]
            acknowledgement_times.append((utc_datetime(acknowledgement.created_at) - utc_datetime(fault.created_at)).total_seconds() / 60)
        if "restored" in first_event_by_stage:
            restored = first_event_by_stage["restored"]
            restoration_times.append((utc_datetime(restored.created_at) - utc_datetime(fault.created_at)).total_seconds() / 3600)
        for event in fault_events:
            if event.event_type not in ("FAULT_ACKNOWLEDGE", "FAULT_RESTORE"):
                continue
            try:
                event_payload = json.loads(event.payload or "{}")
            except json.JSONDecodeError:
                event_payload = {}
            assignment = assignment_by_id.get(event_payload.get("assignment_id"))
            assignment_section = assignment.section if assignment else section
            assignment_row = section_handoff(assignment_section)
            if event.event_type == "FAULT_ACKNOWLEDGE":
                assignment_row["section_acknowledgements"] += 1
            else:
                assignment_row["restorations"] += 1

    return {
        "stages": stage_counts,
        "by_section": section_counts,
        "handoffs_by_section": handoffs,
        "critical_window_minutes": {
            "report_to_triage_median": round(median(report_to_triage_minutes), 1) if report_to_triage_minutes else None,
            "triage_to_acknowledge_median": round(median(triage_to_acknowledge_minutes), 1) if triage_to_acknowledge_minutes else None,
            "acknowledge_to_diagnose_median": round(median(acknowledge_to_diagnose_minutes), 1) if acknowledge_to_diagnose_minutes else None,
            "diagnose_to_restore_median": round(median(diagnose_to_restore_minutes), 1) if diagnose_to_restore_minutes else None,
            "restore_to_close_median": round(median(restore_to_close_minutes), 1) if restore_to_close_minutes else None,
        },
        "resolution_comparison": {
            "first_fault_median_minutes": round(median(first_report_to_restore_minutes), 1) if first_report_to_restore_minutes else None,
            "repeat_fault_median_minutes": round(median(repeat_report_to_restore_minutes), 1) if repeat_report_to_restore_minutes else None,
            "repeat_target_reduction_percent": 60,
            "baseline_status": "Baseline only; target requires comparable real operating periods",
        },
        "operations_reported_faults": operations_report_count,
        "systems_automation_triaged_faults": automation_triage_count,
        "first_assignments": assignment_count,
        "wrong_section_first_assignments": wrong_first_assignment_count,
        "wrong_first_assignment_rate_percent": round(wrong_first_assignment_count * 100 / assignment_count, 1) if assignment_count else None,
        "mean_report_to_triage_minutes": round(sum(triage_times) / len(triage_times), 1) if triage_times else None,
        "mean_report_to_acknowledge_minutes": round(sum(acknowledgement_times) / len(acknowledgement_times), 1) if acknowledgement_times else None,
        "mean_report_to_restore_hours": round(sum(restoration_times) / len(restoration_times), 1) if restoration_times else None,
        "timing_note": "Durations are based on recorded event timestamps and are illustrative for this synthetic prototype.",
    }


@app.get("/api/v1/analytics/overview")
def analytics(user: User = Depends(current_user), db: Session = Depends(db_dep)):
    key = role_key(user)
    if key == "hr_officer":
        raise HTTPException(status_code=403, detail="HR roles use the workforce directory, not maintenance analytics")
    query = select(Fault)
    section_scoped = key in ("technician_st", "technician_pt", "technician_ct", "assistant_engineer", "engineer", "senior_engineer", "chief_engineer")
    if section_scoped:
        query = query.join(Equipment, Fault.equipment_id == Equipment.id).where(
            (Fault.assigned_section == user.section) | (Equipment.section == user.section)
        )
    faults = db.scalars(query).all()
    categories = {}
    stations = {}
    sections = {}
    for f in faults:
        categories[f.category] = categories.get(f.category, 0) + 1
        sections[f.assigned_section or "Unassigned"] = sections.get(f.assigned_section or "Unassigned", 0) + 1
        if f.equipment:
            stations[f.equipment.station] = stations.get(f.equipment.station, 0) + 1
    open_count = sum(f.status not in ("RESTORED", "CLOSED") for f in faults)
    resolved_count = sum(f.status in ("RESTORED", "CLOSED") for f in faults)
    restore_times = [(f.restored_at - f.created_at).total_seconds() / 3600 for f in faults if f.restored_at]
    acknowledge_times = [(f.acknowledged_at - f.created_at).total_seconds() / 60 for f in faults if f.acknowledged_at]
    result = {
        "total_faults": len(faults),
        "open_faults": open_count,
        "resolved_faults": resolved_count,
        "approved_knowledge": db.query(KnowledgeEntry).filter(KnowledgeEntry.status == "APPROVED").count()
        + db.query(ProcedureUpdate).filter(ProcedureUpdate.status == "APPROVED").count(),
        "data_type": "Illustrative synthetic demonstration statistics",
    }
    if key == "managing_director":
        result["resolved_rate_percent"] = round(resolved_count * 100 / len(faults), 1) if faults else 0
        result["view_level"] = "Executive summary"
        return result
    result.update({
        "by_category": categories,
        "by_station": stations,
        "by_section": sections if not section_scoped else {user.section: len(faults)},
        "mean_time_acknowledge_minutes": round(sum(acknowledge_times) / len(acknowledge_times), 1) if acknowledge_times else None,
        "mean_time_restore_hours": round(sum(restore_times) / len(restore_times), 1) if restore_times else None,
        "knowledge_entries": db.query(KnowledgeEntry).count() + db.query(ProcedureUpdate).count(),
        "view_level": f"{user.section} section" if section_scoped else "Operations and maintenance detail",
    })
    if key in ("general_manager_om", "maintenance_manager", "supervisor", "system_administrator"):
        result["workflow"] = workflow_summary(faults, db)
    return result


@app.get("/api/v1/integrations/sap/status")
def sap_integration_status(user: User = Depends(current_user)):
    require_roles(
        user,
        "maintenance_manager", "general_manager_om", "system_administrator",
        "managing_director", "supervisor",
    )
    return {
        "integration": "SAP",
        "phase": "After operational workflow stabilizes",
        "mode": "Read-only planned; write-back disabled",
        "permitted_future_reads": ["equipment tags", "locations", "permit and work-order references"],
        "blocked_actions": ["SAP write-back", "permit modification", "work-order creation"],
        "approval_required": ["ICT", "SAP team"],
    }


@app.post("/api/v1/sync/events")
def sync_events(events: list[dict], user: User = Depends(current_user), db: Session = Depends(db_dep)):
    require_roles(user, "operations", "systems_automation", "technician_st", "technician_pt", "technician_ct", "assistant_engineer", "engineer", "senior_engineer", "chief_engineer", "maintenance_manager", "general_manager_om", "supervisor", "system_administrator")
    accepted = []
    duplicates = []
    for event in events:
        event_id = str(event.get("event_id", uuid.uuid4()))
        if event.get("actor_id") and event["actor_id"] != user.id:
            raise HTTPException(status_code=403, detail="Offline events must belong to the authenticated user")
        if db.get(SyncEvent, event_id):
            duplicates.append(event_id)
            continue
        db.add(SyncEvent(
            event_id=event_id,
            fault_id=event.get("fault_id"),
            event_type=str(event.get("event_type", "UNKNOWN")),
            actor_id=user.id,
            payload=str(event.get("payload", {})),
            client_timestamp=str(event.get("client_timestamp", utcnow().isoformat())),
        ))
        accepted.append(event_id)
    db.commit()
    return {"accepted": accepted, "duplicates": duplicates}


@app.get("/api/v1/sync/status")
def sync_status(user: User = Depends(current_user), db: Session = Depends(db_dep)):
    require_roles(user, "operations", "systems_automation", "technician_st", "technician_pt", "technician_ct", "assistant_engineer", "engineer", "senior_engineer", "chief_engineer", "maintenance_manager", "general_manager_om", "supervisor", "system_administrator")
    count = db.query(SyncEvent).count()
    return {"received_events": count, "authoritative": True, "conflicts": 0}
