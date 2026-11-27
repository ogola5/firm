from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session
from statistics import median
import json

from app.models import Fault, FaultAssignment, FaultEvent, User, utc_datetime
from app.services.access import role_key

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
        # Older timeline entries still say "Instrumentation": it is part of Systems Automation now.
        if section_name == "Instrumentation":
            section_name = "Systems Automation"
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
                assignment_payload.get("routing_strategy") not in ("SYSTEMS_AUTOMATION_FIRST", "REPORTER_CHOSE")
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
