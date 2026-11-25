"""Analytics and intelligence endpoints (definitions: METRICS.md)."""
from __future__ import annotations

from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.db import db_dep
from app.deps import current_user
from app.models import Fault, User, utcnow
from app.services.access import SECTIONS, require_fault_scope, require_roles, role_key
from app.services.analytics import insights, measures
from app.services.analytics.facts import UNIDENTIFIED, load_facts
from app.services.analytics.periods import Granularity, resolve_period
from app.services.analytics.similarity import similar_faults

router = APIRouter()

ORG_WIDE = ("maintenance_manager", "general_manager_om", "supervisor", "system_administrator")
SECTION_LEADS = ("technician_ct", "chief_engineer")
EXECUTIVE = ("managing_director",)
SECTION_ROLES = ("systems_automation", "technician_st", "technician_pt", "technician_ct", "assistant_engineer",
                 "engineer", "senior_engineer", "chief_engineer")


def analytics_section(user: User, requested: str, *, detail: bool) -> str | None:
    """Which section's data this user may see: None = all sections.

    Section leads are held to their own section; the executive sees summaries only.
    """
    key = role_key(user)
    allowed = ORG_WIDE + SECTION_LEADS + (() if detail else EXECUTIVE)
    require_roles(user, *allowed)
    if key in SECTION_LEADS:
        return user.section
    if requested and requested not in (*SECTIONS, UNIDENTIFIED):
        raise HTTPException(status_code=422, detail="Unknown section")
    return requested or None


def scope_note(section: str | None) -> str:
    return f"{section} section" if section else "All sections"


@router.get("/api/v1/analytics/measures")
def measure_definitions(user: User = Depends(current_user)):
    require_roles(user, *ORG_WIDE, *SECTION_LEADS, *EXECUTIVE)
    return {"measures": [measure.describe() for measure in measures.MEASURES.values()], "min_n_to_compare": measures.MIN_N_TO_COMPARE}


@router.get("/api/v1/analytics/summary")
def analytics_summary(
    start: date | None = None, end: date | None = None, section: str = "",
    user: User = Depends(current_user), db: Session = Depends(db_dep),
):
    """Headline measures for the period, compared with the period before it."""
    scope = analytics_section(user, section, detail=False)
    period = resolve_period(start, end)
    return {**measures.summary(load_facts(db, scope), period), "scope": scope_note(scope),
            "data_type": "Illustrative synthetic demonstration data"}


@router.get("/api/v1/analytics/trends")
def analytics_trends(
    start: date | None = None, end: date | None = None, section: str = "",
    granularity: Granularity = "week",
    measure: list[str] = Query(default=[]),
    user: User = Depends(current_user), db: Session = Depends(db_dep),
):
    """Each measure per week or month, with the number of faults behind every point."""
    scope = analytics_section(user, section, detail=False)
    keys = measure or measures.HEADLINE
    unknown = [key for key in keys if key not in measures.MEASURES]
    if unknown:
        raise HTTPException(status_code=422, detail=f"Unknown measure: {', '.join(unknown)}")
    period = resolve_period(start, end, default_days=84 if granularity == "week" else 365)
    return {**measures.trends(load_facts(db, scope), period, granularity, keys), "scope": scope_note(scope)}


@router.get("/api/v1/analytics/equipment-attention")
def analytics_equipment(
    start: date | None = None, end: date | None = None, section: str = "", limit: int = Query(default=10, ge=1, le=50),
    user: User = Depends(current_user), db: Session = Depends(db_dep),
):
    """Equipment needing attention in the period, with the reasons for each."""
    scope = analytics_section(user, section, detail=True)
    period = resolve_period(start, end)
    return {"period": period.as_dict(), "scope": scope_note(scope),
            "equipment": insights.equipment_attention(load_facts(db, scope), period, limit),
            "ranking": "Faults + repeats + 2 × came back after fix; ties by total hours to restore."}


@router.get("/api/v1/analytics/sections")
def analytics_sections(
    start: date | None = None, end: date | None = None,
    user: User = Depends(current_user), db: Session = Depends(db_dep),
):
    """Per owning section; section leads see their own section only."""
    scope = analytics_section(user, "", detail=True)
    period = resolve_period(start, end)
    return {"period": period.as_dict(), "sections": insights.section_comparison(load_facts(db, scope), period, utcnow()),
            "note": "Sections look after different equipment. Compare a section with its own trend first."}


@router.get("/api/v1/analytics/data-quality")
def analytics_data_quality(
    start: date | None = None, end: date | None = None, section: str = "",
    user: User = Depends(current_user), db: Session = Depends(db_dep),
):
    """How complete the records behind the figures are."""
    scope = analytics_section(user, section, detail=True)
    period = resolve_period(start, end)
    return {"period": period.as_dict(), "scope": scope_note(scope),
            "checks": insights.data_quality(load_facts(db, scope), period, utcnow())}


@router.get("/api/v1/intelligence/similar-faults")
def intelligence_similar_faults(
    fault_id: str, limit: int = Query(default=5, ge=1, le=20),
    user: User = Depends(current_user), db: Session = Depends(db_dep),
):
    """Earlier faults most like this one, with why each ranked. A lead to check, not a diagnosis."""
    require_roles(user, *SECTION_ROLES, *ORG_WIDE)
    fault = db.get(Fault, fault_id)
    if not fault:
        raise HTTPException(status_code=404, detail="Fault not found")
    require_fault_scope(user, fault)
    facts = load_facts(db)
    target = next(item for item in facts if item.id == fault_id)
    candidates = facts
    if role_key(user) in SECTION_ROLES and role_key(user) != "systems_automation":
        # Section roles only see their own section's history.
        candidates = [item for item in facts if item.section == user.section]
    return {"fault_id": fault_id, "similar": similar_faults(target, candidates, utcnow(), limit),
            "note": "Similar is not the same cause. Check before you act."}
