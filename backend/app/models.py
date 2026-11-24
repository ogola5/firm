from __future__ import annotations

from datetime import datetime
from datetime import timezone
from sqlalchemy import DateTime
from sqlalchemy import Float
from sqlalchemy import ForeignKey
from sqlalchemy import Integer
from sqlalchemy import String
from sqlalchemy import Text
from sqlalchemy.orm import Mapped
from sqlalchemy.orm import mapped_column
from sqlalchemy.orm import relationship
from typing import Optional

from app.db import Base

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
    equipment_id: Mapped[str] = mapped_column(ForeignKey("equipment.id"), index=True)
    reporter_id: Mapped[str] = mapped_column(ForeignKey("users.id"))
    category: Mapped[str] = mapped_column(String)
    symptom: Mapped[str] = mapped_column(String)
    severity: Mapped[str] = mapped_column(String)
    description: Mapped[str] = mapped_column(Text)
    operational_impact: Mapped[str] = mapped_column(String, default="")
    operating_conditions: Mapped[str] = mapped_column(Text, default="")
    status: Mapped[str] = mapped_column(String, default="REPORTED", index=True)
    assigned_section: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True)
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
    fault_id: Mapped[str] = mapped_column(ForeignKey("faults.id"), index=True)
    event_type: Mapped[str] = mapped_column(String)
    actor_id: Mapped[str] = mapped_column(String)
    payload: Mapped[str] = mapped_column(Text, default="{}")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class FaultAssignment(Base):
    __tablename__ = "fault_assignments"
    id: Mapped[str] = mapped_column(String, primary_key=True)
    fault_id: Mapped[str] = mapped_column(ForeignKey("faults.id"), index=True)
    section: Mapped[str] = mapped_column(String)
    assigned_by_id: Mapped[str] = mapped_column(ForeignKey("users.id"))
    assigned_user_id: Mapped[Optional[str]] = mapped_column(ForeignKey("users.id"), nullable=True)
    previous_assignment_id: Mapped[Optional[str]] = mapped_column(ForeignKey("fault_assignments.id"), nullable=True, index=True)
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
    fault_id: Mapped[str] = mapped_column(ForeignKey("faults.id"), index=True)
    assignment_id: Mapped[Optional[str]] = mapped_column(ForeignKey("fault_assignments.id"), nullable=True, index=True)
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
    fault_id: Mapped[str] = mapped_column(ForeignKey("faults.id"), index=True)
    assignment_id: Mapped[Optional[str]] = mapped_column(ForeignKey("fault_assignments.id"), nullable=True, index=True)
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
    fault_id: Mapped[str] = mapped_column(ForeignKey("faults.id"), index=True)
    assignment_id: Mapped[Optional[str]] = mapped_column(ForeignKey("fault_assignments.id"), nullable=True, index=True)
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
    equipment_id: Mapped[Optional[str]] = mapped_column(ForeignKey("equipment.id"), nullable=True, index=True)
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
    fault_id: Mapped[str] = mapped_column(ForeignKey("faults.id"), index=True)
    author_id: Mapped[str] = mapped_column(ForeignKey("users.id"))
    section: Mapped[str] = mapped_column(String)
    title: Mapped[str] = mapped_column(String)
    observed_symptom: Mapped[str] = mapped_column(Text)
    confirmed_cause: Mapped[str] = mapped_column(Text)
    diagnostic_procedure: Mapped[str] = mapped_column(Text)
    corrective_action: Mapped[str] = mapped_column(Text)
    safety: Mapped[str] = mapped_column(Text, default="")
    version: Mapped[int] = mapped_column(Integer, default=1)
    lineage_id: Mapped[str] = mapped_column(String, index=True)
    previous_update_id: Mapped[Optional[str]] = mapped_column(ForeignKey("procedure_updates.id"), nullable=True, index=True)
    status: Mapped[str] = mapped_column(String, default="SUBMITTED")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class ProcedureReview(Base):
    __tablename__ = "procedure_reviews"
    id: Mapped[str] = mapped_column(String, primary_key=True)
    procedure_update_id: Mapped[str] = mapped_column(ForeignKey("procedure_updates.id"), index=True)
    reviewer_id: Mapped[str] = mapped_column(ForeignKey("users.id"))
    decision: Mapped[str] = mapped_column(String)
    comments: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    reviewer = relationship("User")


class KnowledgeReuse(Base):
    __tablename__ = "knowledge_reuse"
    id: Mapped[str] = mapped_column(String, primary_key=True)
    procedure_update_id: Mapped[str] = mapped_column(ForeignKey("procedure_updates.id"), index=True)
    fault_id: Mapped[str] = mapped_column(ForeignKey("faults.id"), index=True)
    actor_id: Mapped[str] = mapped_column(ForeignKey("users.id"))
    used_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class KnowledgeReuseOutcome(Base):
    __tablename__ = "knowledge_reuse_outcomes"
    reuse_id: Mapped[str] = mapped_column(ForeignKey("knowledge_reuse.id"), primary_key=True)
    actor_id: Mapped[str] = mapped_column(ForeignKey("users.id"))
    outcome: Mapped[str] = mapped_column(String)
    comments: Mapped[str] = mapped_column(Text, default="")
    confirmed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class SyncBatch(Base):
    """One upload of queued offline events from a device (sync audit history)."""
    __tablename__ = "sync_batches"
    id: Mapped[str] = mapped_column(String, primary_key=True)
    actor_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    device_id: Mapped[str] = mapped_column(String, default="")
    received_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True)
    event_count: Mapped[int] = mapped_column(Integer, default=0)
    applied_count: Mapped[int] = mapped_column(Integer, default=0)
    conflict_count: Mapped[int] = mapped_column(Integer, default=0)
    rejected_count: Mapped[int] = mapped_column(Integer, default=0)
    duplicate_count: Mapped[int] = mapped_column(Integer, default=0)


class SyncEvent(Base):
    """An offline event received from a client.

    `event_id` is client-generated and is the idempotency key. `client_timestamp`
    is the device's clock and is kept separate from the server's `received_at`.
    Status: APPLIED, CONFLICT (kept for reconciliation), REJECTED (permission or
    validation failure), RESOLVED_APPLIED or RESOLVED_DISCARDED.
    """
    __tablename__ = "sync_events"
    event_id: Mapped[str] = mapped_column(String, primary_key=True)
    batch_id: Mapped[Optional[str]] = mapped_column(ForeignKey("sync_batches.id"), nullable=True, index=True)
    fault_id: Mapped[Optional[str]] = mapped_column(String, nullable=True, index=True)
    event_type: Mapped[str] = mapped_column(String)
    actor_id: Mapped[str] = mapped_column(String, index=True)
    device_id: Mapped[str] = mapped_column(String, default="")
    sequence_number: Mapped[int] = mapped_column(Integer, default=0)
    base_status: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    payload: Mapped[str] = mapped_column(Text)
    client_timestamp: Mapped[str] = mapped_column(String)
    received_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    status: Mapped[str] = mapped_column(String, default="APPLIED", index=True)
    status_code: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    detail: Mapped[str] = mapped_column(Text, default="")
    result: Mapped[str] = mapped_column(Text, default="{}")
    applied_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    resolved_by_id: Mapped[Optional[str]] = mapped_column(ForeignKey("users.id"), nullable=True)
    resolved_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    resolution_note: Mapped[str] = mapped_column(Text, default="")
