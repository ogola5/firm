from __future__ import annotations

from datetime import date
from datetime import datetime
from datetime import timedelta
from datetime import timezone
from sqlalchemy import select
from sqlalchemy.orm import Session
import json

from app.models import Diagnosis, EquipmentTypeOwner, ExpertSession, Fault, FaultAssignment, FaultEvent, Intervention, KnowledgeReuse, KnowledgeReuseOutcome, ProcedureUpdate, User, utc_datetime
from app.services.access import ACTIVE_ASSIGNMENT_STATUSES, ASSIGNABLE_TECHNICIAN_ROLES, TECHNICAL_ROLES, current_assignment, role_definition, role_key

def contribution_rows(db: Session, start_date: date | None, end_date: date | None) -> list[dict]:
    start = datetime.combine(start_date, datetime.min.time(), timezone.utc) if start_date else None
    end = datetime.combine(end_date + timedelta(days=1), datetime.min.time(), timezone.utc) if end_date else None

    def in_period(value: datetime) -> bool:
        normalized = utc_datetime(value)
        return (start is None or normalized >= start) and (end is None or normalized < end)

    users = db.scalars(select(User).where(User.active == 1)).all()
    contributors = [item for item in users if role_key(item) in TECHNICAL_ROLES or role_key(item) == "systems_automation"]
    faults = db.scalars(select(Fault)).all()
    fault_by_id = {item.id: item for item in faults}
    events = db.scalars(select(FaultEvent)).all()
    diagnoses = db.scalars(select(Diagnosis)).all()
    interventions = db.scalars(select(Intervention)).all()
    updates = db.scalars(select(ProcedureUpdate)).all()
    first_authors = {item.lineage_id: item.author_id for item in updates if item.version == 1}
    sessions = db.scalars(select(ExpertSession).where(ExpertSession.status == "APPROVED")).all()
    owned_types: dict[str, int] = {}
    for row in db.scalars(select(EquipmentTypeOwner)):
        owned_types[row.owner_id] = owned_types.get(row.owner_id, 0) + 1
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
        # Superseded and withdrawn versions were approved once and still count.
        approved = [item for item in authored if item.status in ("APPROVED", "SUPERSEDED", "WITHDRAWN")]
        improved_colleagues = [item for item in approved if item.version > 1 and first_authors.get(item.lineage_id) not in (None, employee.id)]
        expert_sessions = [item for item in sessions if item.expert_id == employee.id and in_period(item.decided_at or item.created_at)]
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
            # Knowledge contribution (proposed for appraisal; see appraisal_knowledge_status).
            "improved_colleagues_procedures": len(improved_colleagues),
            "expert_sessions_given": len(expert_sessions),
            "knowledge_types_owned": owned_types.get(employee.id, 0),
            "reuses_recorded_by_employee": len(own_reuses),
            "reuses_confirmed_successful_by_employee": sum(
                bool(outcome and outcome.outcome == "SUCCESS") for _, outcome, _ in own_reuses
            ),
            "illustrative_recognition_points": approved_count * 10 + len(approved_revisions) * 2 + peer_success_count * 5,
        })
    return sorted(rows, key=lambda row: (row["section"], row["employee_name"]))


def section_technician_payloads(db: Session, section: str, region: str | None = None) -> list[dict]:
    """The ST/PT pool a Chief Technician allocates from: their section, and their region when they have one."""
    query = select(User).where(User.section == section, User.role.in_(ASSIGNABLE_TECHNICIAN_ROLES))
    if region:
        query = query.where(User.region == region)
    technicians = db.scalars(query.order_by(User.role, User.display_name)).all()
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
        "region": item.region,
        "active": bool(item.active),
        "availability_status": item.availability_status,
        "competencies": json.loads(item.competencies or "[]"),
        "active_workload": workloads.get(item.id, 0),
    } for item in technicians]
