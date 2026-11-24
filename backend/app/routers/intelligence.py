from __future__ import annotations

from datetime import timedelta
from datetime import timezone
from fastapi import Depends
from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session
from fastapi import APIRouter

from app.db import db_dep
from app.deps import current_user
from app.models import Diagnosis, Equipment, Fault, Intervention, User, utcnow
from app.services.access import require_equipment_scope, require_roles

router = APIRouter()

@router.get("/api/v1/intelligence/equipment/{equipment_id}")
def recurring_intelligence(equipment_id: str, user: User = Depends(current_user), db: Session = Depends(db_dep)):
    # Operations needs this while reporting, to see "seen before" for the asset.
    require_roles(user, "operations", "systems_automation", "technician_st", "technician_pt", "technician_ct", "assistant_engineer", "engineer", "senior_engineer", "chief_engineer", "maintenance_manager", "general_manager_om", "supervisor", "system_administrator")
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
