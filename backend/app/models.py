from __future__ import annotations

from datetime import date
from datetime import datetime
from datetime import timezone
from sqlalchemy import Date
from sqlalchemy import DateTime
from sqlalchemy import Float
from sqlalchemy import ForeignKey
from sqlalchemy import Integer
from sqlalchemy import String
from sqlalchemy import Text
from sqlalchemy import JSON
from sqlalchemy.dialects.postgresql import JSONB
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
    # Company email is the sign-in identity (services/accounts.py enforces the domain).
    email: Mapped[str] = mapped_column(String, unique=True)
    staff_number: Mapped[str] = mapped_column(String, default="")
    job_title: Mapped[str] = mapped_column(String, default="")
    account_status: Mapped[str] = mapped_column(String, default="ACTIVE")
    requested_role: Mapped[str] = mapped_column(String, default="")
    requested_section: Mapped[str] = mapped_column(String, default="")
    decision_note: Mapped[str] = mapped_column(Text, default="")
    decided_by_id: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    decided_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    email_verified_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    failed_logins: Mapped[int] = mapped_column(Integer, default=0)
    locked_until: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    last_login_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    password_changed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=True)
    # Set by HR: used to find knowledge at risk of leaving with the person.
    retirement_date: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    # Western, Nairobi or Coast for regional staff (ST/PT/CT/AE/E/SE); empty for CE and company-wide roles.
    region: Mapped[str] = mapped_column(String, default="")
    requested_region: Mapped[str] = mapped_column(String, default="")
    # The developer / owner of the standalone system: a System Administrator who also has developer tools
    # (view as, demo reset, banner, feature switches). Set only from the seed or the command line, never in the app.
    developer: Mapped[int] = mapped_column(Integer, default=0)


class AppSetting(Base):
    """A rule or switch the System Administrator changed in the app; overrides the default in core/config.py."""
    __tablename__ = "app_settings"
    key: Mapped[str] = mapped_column(String, primary_key=True)
    value: Mapped[str] = mapped_column(Text)
    updated_by_id: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    updated_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)


class System(Base):
    """Equipment that works together, and what people know about it as a whole (legacy systems especially)."""
    __tablename__ = "systems"
    id: Mapped[str] = mapped_column(String, primary_key=True)
    name: Mapped[str] = mapped_column(String, unique=True)
    station: Mapped[str] = mapped_column(String, default="")
    legacy: Mapped[int] = mapped_column(Integer, default=0)
    description: Mapped[str] = mapped_column(Text, default="")
    how_it_connects: Mapped[str] = mapped_column(Text, default="")
    known_limitations: Mapped[str] = mapped_column(Text, default="")
    updated_by_id: Mapped[Optional[str]] = mapped_column(ForeignKey("users.id"), nullable=True)
    updated_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)


class SystemChange(Base):
    """One modification to a system over the years (rewiring, replaced parts, changed logic)."""
    __tablename__ = "system_changes"
    id: Mapped[str] = mapped_column(String, primary_key=True)
    system_id: Mapped[str] = mapped_column(ForeignKey("systems.id"), index=True)
    changed_on: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    what_changed: Mapped[str] = mapped_column(Text)
    recorded_by_id: Mapped[str] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class Notification(Base):
    """In-app notice for one person: shown under the bell, kept after it is read."""
    __tablename__ = "notifications"
    id: Mapped[str] = mapped_column(String, primary_key=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"))
    kind: Mapped[str] = mapped_column(String)
    title: Mapped[str] = mapped_column(String)
    body: Mapped[str] = mapped_column(Text, default="")
    link: Mapped[str] = mapped_column(String, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    read_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)


class EquipmentTypeOwner(Base):
    """The named person (CT or SE) who keeps an equipment type's knowledge current."""
    __tablename__ = "equipment_type_owners"
    equipment_type: Mapped[str] = mapped_column(String, primary_key=True)
    owner_id: Mapped[str] = mapped_column(ForeignKey("users.id"))
    assigned_by_id: Mapped[str] = mapped_column(ForeignKey("users.id"))
    assigned_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class PointRule(Base):
    """How many points a kind of verified contribution earns (HR sets these)."""
    __tablename__ = "point_rules"
    kind: Mapped[str] = mapped_column(String, primary_key=True)
    label: Mapped[str] = mapped_column(String)
    points: Mapped[int] = mapped_column(Integer)
    description: Mapped[str] = mapped_column(Text, default="")
    active: Mapped[int] = mapped_column(Integer, default=1)


class HRSetting(Base):
    __tablename__ = "hr_settings"
    key: Mapped[str] = mapped_column(String, primary_key=True)
    value: Mapped[str] = mapped_column(String)


class PointEntry(Base):
    """One line in a person's points record: always with the reason and the work behind it."""
    __tablename__ = "points_ledger"
    id: Mapped[str] = mapped_column(String, primary_key=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    kind: Mapped[str] = mapped_column(String)
    points: Mapped[int] = mapped_column(Integer)
    reason: Mapped[str] = mapped_column(Text)
    source_type: Mapped[str] = mapped_column(String, default="")
    source_id: Mapped[str] = mapped_column(String, default="")
    link: Mapped[str] = mapped_column(String, default="")
    earned_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    created_by_id: Mapped[Optional[str]] = mapped_column(String, nullable=True)


class PointRedemption(Base):
    __tablename__ = "point_redemptions"
    id: Mapped[str] = mapped_column(String, primary_key=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    points: Mapped[int] = mapped_column(Integer)
    option: Mapped[str] = mapped_column(String)
    value_text: Mapped[str] = mapped_column(String, default="")
    note: Mapped[str] = mapped_column(Text, default="")
    recorded_by_id: Mapped[str] = mapped_column(String)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class Award(Base):
    """Employee of the month, quarter or (financial) year, per section or overall."""
    __tablename__ = "awards"
    id: Mapped[str] = mapped_column(String, primary_key=True)
    award_type: Mapped[str] = mapped_column(String)
    period_key: Mapped[str] = mapped_column(String)
    scope: Mapped[str] = mapped_column(String)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"))
    citation: Mapped[str] = mapped_column(Text)
    prize: Mapped[str] = mapped_column(String, default="")
    decided_by_id: Mapped[str] = mapped_column(String)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class Drawing(Base):
    """Drawing register. Placeholder until KPC's digitised drawings can be linked (document_url)."""
    __tablename__ = "drawings"
    id: Mapped[str] = mapped_column(String, primary_key=True)
    number: Mapped[str] = mapped_column(String, unique=True)
    title: Mapped[str] = mapped_column(String)
    revision: Mapped[str] = mapped_column(String, default="")
    discipline: Mapped[str] = mapped_column(String, default="")
    status: Mapped[str] = mapped_column(String, default="PAPER")
    document_url: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    source: Mapped[str] = mapped_column(String, default="Local register")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class DrawingEquipment(Base):
    __tablename__ = "drawing_equipment"
    drawing_id: Mapped[str] = mapped_column(ForeignKey("drawings.id"), primary_key=True)
    equipment_id: Mapped[str] = mapped_column(ForeignKey("equipment.id"), primary_key=True)


class DrawingDifference(Base):
    """Where the installed equipment no longer matches its drawing (a red-line for the drawing office)."""
    __tablename__ = "drawing_differences"
    id: Mapped[str] = mapped_column(String, primary_key=True)
    equipment_id: Mapped[str] = mapped_column(ForeignKey("equipment.id"), index=True)
    drawing_id: Mapped[Optional[str]] = mapped_column(ForeignKey("drawings.id"), nullable=True)
    drawing_number_text: Mapped[str] = mapped_column(String, default="")
    description: Mapped[str] = mapped_column(Text)
    permanence: Mapped[str] = mapped_column(String)
    fault_id: Mapped[Optional[str]] = mapped_column(ForeignKey("faults.id"), nullable=True)
    reported_by_id: Mapped[str] = mapped_column(ForeignKey("users.id"))
    reported_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    status: Mapped[str] = mapped_column(String, default="REPORTED")
    verified_by_id: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    verified_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    review_note: Mapped[str] = mapped_column(Text, default="")
    incorporated_revision: Mapped[str] = mapped_column(String, default="")
    incorporated_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)


class ExpertSession(Base):
    """An experienced person's knowledge of an equipment type, written up by a colleague."""
    __tablename__ = "expert_sessions"
    id: Mapped[str] = mapped_column(String, primary_key=True)
    expert_id: Mapped[str] = mapped_column(ForeignKey("users.id"))
    scribe_id: Mapped[str] = mapped_column(ForeignKey("users.id"))
    equipment_type: Mapped[str] = mapped_column(String)
    section: Mapped[str] = mapped_column(String)
    title: Mapped[str] = mapped_column(String)
    how_it_fails: Mapped[str] = mapped_column(Text, default="")
    first_checks: Mapped[str] = mapped_column(Text, default="")
    what_fools_people: Mapped[str] = mapped_column(Text, default="")
    tricks: Mapped[str] = mapped_column(Text, default="")
    parts: Mapped[str] = mapped_column(Text, default="")
    safety: Mapped[str] = mapped_column(Text, default="")
    status: Mapped[str] = mapped_column(String, default="SUBMITTED")
    reviewer_id: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    review_note: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    decided_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)


class ExpertQuestion(Base):
    __tablename__ = "expert_questions"
    id: Mapped[str] = mapped_column(String, primary_key=True)
    equipment_type: Mapped[str] = mapped_column(String)
    section: Mapped[str] = mapped_column(String)
    asked_by_id: Mapped[str] = mapped_column(ForeignKey("users.id"))
    text: Mapped[str] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String, default="OPEN")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class ExpertAnswer(Base):
    __tablename__ = "expert_answers"
    id: Mapped[str] = mapped_column(String, primary_key=True)
    question_id: Mapped[str] = mapped_column(ForeignKey("expert_questions.id"), index=True)
    author_id: Mapped[str] = mapped_column(ForeignKey("users.id"))
    text: Mapped[str] = mapped_column(Text)
    accepted: Mapped[int] = mapped_column(Integer, default=0)
    accepted_by_id: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    accepted_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class EmailCode(Base):
    """A one-time code sent to a company email (stored as a keyed hash, never in clear)."""
    __tablename__ = "email_codes"
    id: Mapped[str] = mapped_column(String, primary_key=True)
    email: Mapped[str] = mapped_column(String, index=True)
    purpose: Mapped[str] = mapped_column(String)
    code_hash: Mapped[str] = mapped_column(String)
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    used_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class ReportSubscription(Base):
    """A person's choice to receive (or not) a periodic report by email. No row = their level's default."""
    __tablename__ = "report_subscriptions"
    user_id: Mapped[str] = mapped_column(String, ForeignKey("users.id"), primary_key=True)
    kind: Mapped[str] = mapped_column(String, primary_key=True)
    enabled: Mapped[int] = mapped_column(Integer)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class ReportDelivery(Base):
    """One scheduled report sent to one person; unique so a report is never emailed twice."""
    __tablename__ = "report_deliveries"
    id: Mapped[str] = mapped_column(String, primary_key=True)
    kind: Mapped[str] = mapped_column(String)
    period_key: Mapped[str] = mapped_column(String)
    recipient_id: Mapped[str] = mapped_column(String, ForeignKey("users.id"))
    scope: Mapped[str] = mapped_column(String)
    sent_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class MailOutbox(Base):
    """Every email the system would send. The prototype never sends real mail."""
    __tablename__ = "mail_outbox"
    id: Mapped[str] = mapped_column(String, primary_key=True)
    recipient: Mapped[str] = mapped_column(String, index=True)
    subject: Mapped[str] = mapped_column(String)
    body: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


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
    # Words people actually use for this asset ("t601 inlet mov"), searched with tag and name.
    aliases: Mapped[str] = mapped_column(Text, default="")
    # From the pump station: Western, Nairobi or Coast.
    region: Mapped[str] = mapped_column(String, default="")
    # The system it works in with other equipment (related equipment), if known.
    system_id: Mapped[Optional[str]] = mapped_column(String, nullable=True)


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
    # When and how the reporter saw the problem (may be earlier than created_at).
    observed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    seen_via: Mapped[str] = mapped_column(String, default="")
    # Someone or something at risk: Critical, flagged in every queue and on the job card.
    safety_hazard: Mapped[int] = mapped_column(Integer, default=0)
    # The reporter's answers to the follow-up questions (JSON).
    # JSONB on PostgreSQL (indexed, queryable); JSON text on SQLite. {"problem", "answers": {...}, "hazard"}.
    report_details: Mapped[dict] = mapped_column(JSON().with_variant(JSONB(), "postgresql"), default=dict)
    callback: Mapped[str] = mapped_column(String, default="")
    # 0 with the Chief Technician, 1 with the regional Senior Engineer, 2 with the section Chief Engineer.
    escalation_level: Mapped[int] = mapped_column(Integer, default=0)
    escalated_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    escalation_reason: Mapped[str] = mapped_column(Text, default="")
    escalation_guidance: Mapped[str] = mapped_column(Text, default="")
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
    # Technician-entered time the equipment was working again (from their notes).
    back_in_service_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    # An experienced colleague advising on this job (shadowing; both are credited).
    adviser_id: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    fault = relationship("Fault", back_populates="assignments")
    assigned_by = relationship("User", foreign_keys=[assigned_by_id])
    assigned_user = relationship("User", foreign_keys=[assigned_user_id])
    helpers = relationship("FaultHelper", back_populates="assignment", order_by="FaultHelper.created_at")


class FaultHelper(Base):
    """A colleague the person on the job called in to help, from any section. Credited with the job."""
    __tablename__ = "fault_helpers"
    id: Mapped[str] = mapped_column(String, primary_key=True)
    assignment_id: Mapped[str] = mapped_column(ForeignKey("fault_assignments.id"), index=True)
    fault_id: Mapped[str] = mapped_column(ForeignKey("faults.id"), index=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    added_by_id: Mapped[str] = mapped_column(ForeignKey("users.id"))
    note: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    assignment = relationship("FaultAssignment", back_populates="helpers")
    user = relationship("User", foreign_keys=[user_id])


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
    # Pick-list (services/catalogue.py): what kind of cause, so the library can be analysed.
    cause_category: Mapped[str] = mapped_column(String, default="")
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
    # Pick-list (services/catalogue.py): replaced, adjusted, reset, temporary fix…
    action_type: Mapped[str] = mapped_column(String, default="")
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
    # Why this version differs from the one before it (revisions and improvements).
    change_reason: Mapped[str] = mapped_column(Text, default="")
    # Tools, test equipment and parts the job needs.
    tools_materials: Mapped[str] = mapped_column(Text, default="")
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
