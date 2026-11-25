"""Recognition points: earned only from verified contributions, never from speed or volume.

Points are derived from the records themselves (an approved procedure, a
colleague's confirmed fix, a verified drawing difference…), so they cannot be
claimed by hand and each piece of work is credited once (unique per person,
kind and source). The value is fixed when earned: HR can change the rules
later without rewriting history. A monthly cap stops anyone farming points.
"""
from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import date, datetime, timedelta

from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models import (
    Award, Diagnosis, DrawingDifference, ExpertAnswer, ExpertQuestion, ExpertSession, FaultAssignment, HRSetting,
    Intervention, KnowledgeReuse, KnowledgeReuseOutcome, PointEntry, PointRedemption, PointRule, ProcedureReview,
    ProcedureUpdate, User, utc_datetime, utcnow,
)
from app.services.analytics.periods import local_zone, period_from_days
from app.services.reports import fy_key, fy_start_year, resolve as resolve_report_period

AWARD_TYPES = {"MONTH": "Employee of the Month", "QUARTER": "Employee of the Quarter", "YEAR": "Employee of the Year"}
REDEMPTION_OPTIONS = {"CASH": "Cash", "VOUCHER": "Voucher", "DAY_OFF": "Day off", "OTHER": "Other"}


def setting(db: Session, key: str, default: str = "") -> str:
    row = db.get(HRSetting, key)
    return row.value if row else default


def monthly_cap(db: Session) -> int:
    try:
        return int(setting(db, "monthly_cap", "150"))
    except ValueError:
        return 150


def rules(db: Session) -> dict[str, PointRule]:
    return {item.kind: item for item in db.scalars(select(PointRule))}


@dataclass
class Candidate:
    user_id: str
    kind: str
    source_type: str
    source_id: str
    earned_at: datetime
    reason: str
    link: str = ""


def _approval_time(db: Session, update: ProcedureUpdate) -> datetime:
    published = db.scalar(select(ProcedureReview.created_at).where(
        ProcedureReview.procedure_update_id == update.id, ProcedureReview.decision == "SUPERVISOR_APPROVED",
    ).order_by(ProcedureReview.created_at.desc()))
    return utc_datetime(published or update.updated_at)


def _candidates(db: Session) -> list[Candidate]:
    found: list[Candidate] = []
    for update in db.scalars(select(ProcedureUpdate).where(ProcedureUpdate.status == "APPROVED")):
        kind = "PROCEDURE_APPROVED" if update.version == 1 else "REVISION_APPROVED"
        found.append(Candidate(update.author_id, kind, "procedure", update.id, _approval_time(db, update),
                               f"{'Procedure' if update.version == 1 else 'Improvement'} approved: {update.title}", "/knowledge"))
    reuse_rows = db.execute(
        select(KnowledgeReuse, KnowledgeReuseOutcome, ProcedureUpdate)
        .join(KnowledgeReuseOutcome, KnowledgeReuseOutcome.reuse_id == KnowledgeReuse.id)
        .join(ProcedureUpdate, KnowledgeReuse.procedure_update_id == ProcedureUpdate.id)
        .where(KnowledgeReuseOutcome.outcome == "SUCCESS")
    ).all()
    for reuse, outcome, update in reuse_rows:
        if reuse.actor_id == update.author_id:
            continue  # using your own procedure earns nothing
        colleague = db.get(User, reuse.actor_id)
        found.append(Candidate(update.author_id, "REUSE_CONFIRMED", "reuse", reuse.id, utc_datetime(outcome.confirmed_at),
                               f"{colleague.display_name if colleague else 'A colleague'} fixed a fault with your procedure \"{update.title}\"",
                               f"/faults?mode=history&fault={reuse.fault_id}"))
    for session in db.scalars(select(ExpertSession).where(ExpertSession.status == "APPROVED")):
        when = utc_datetime(session.decided_at or session.created_at)
        found.append(Candidate(session.expert_id, "EXPERT_SESSION", "expert_session", session.id, when,
                               f"Expert session approved: {session.title}", "/expertise"))
        if session.scribe_id != session.expert_id:
            found.append(Candidate(session.scribe_id, "EXPERT_SESSION_SCRIBE", "expert_session", session.id, when,
                                   f"Wrote up the expert session: {session.title}", "/expertise"))
    for difference in db.scalars(select(DrawingDifference).where(DrawingDifference.status.in_(("VERIFIED", "INCORPORATED")))):
        found.append(Candidate(difference.reported_by_id, "DRAWING_DIFFERENCE", "drawing_difference", difference.id,
                               utc_datetime(difference.verified_at or difference.reported_at),
                               f"Drawing difference verified: {difference.description[:80]}", "/equipment"))
    answers = db.execute(select(ExpertAnswer, ExpertQuestion).join(ExpertQuestion, ExpertAnswer.question_id == ExpertQuestion.id)
                         .where(ExpertAnswer.accepted == 1)).all()
    for answer, question in answers:
        if answer.author_id == question.asked_by_id:
            continue
        found.append(Candidate(answer.author_id, "ANSWER_ACCEPTED", "answer", answer.id, utc_datetime(answer.accepted_at or answer.created_at),
                               f"Your answer was accepted: \"{question.text[:70]}\"", "/expertise"))
    for assignment in db.scalars(select(FaultAssignment).where(FaultAssignment.back_in_service_at.is_not(None))):
        done = utc_datetime(assignment.back_in_service_at)
        if assignment.adviser_id and assignment.assigned_user_id and assignment.adviser_id != assignment.assigned_user_id:
            for person, role in ((assignment.adviser_id, "as expert adviser"), (assignment.assigned_user_id, "learning from an expert")):
                found.append(Candidate(person, "SHADOW_JOB", "assignment", assignment.id, done,
                                       f"Shadowing job completed ({role})", f"/faults?mode=history&fault={assignment.fault_id}"))
        if assignment.assigned_user_id and _complete_write_up(db, assignment):
            found.append(Candidate(assignment.assigned_user_id, "COMPLETE_WRITE_UP", "assignment", assignment.id, done,
                                   "Complete write-up: what was found, what was done and when it was back in service",
                                   f"/faults?mode=history&fault={assignment.fault_id}"))
    return found


def _complete_write_up(db: Session, assignment: FaultAssignment) -> bool:
    diagnosis = db.scalar(select(Diagnosis).where(
        Diagnosis.assignment_id == assignment.id, Diagnosis.author_id == assignment.assigned_user_id,
        Diagnosis.cause_category != "",
    ))
    if not diagnosis:
        return False
    return bool(db.scalar(select(Intervention.id).where(
        Intervention.assignment_id == assignment.id, Intervention.outcome == "SUCCESS", Intervention.action_type != "",
    ).limit(1)))


def _month_key(moment: datetime) -> str:
    return moment.astimezone(local_zone()).strftime("%Y-%m")


def sync(db: Session) -> int:
    """Credit any verified contribution not yet in the points record. Safe to run any time."""
    rule_map = rules(db)
    cap = monthly_cap(db)
    existing = {(row.user_id, row.kind, row.source_id) for row in db.scalars(select(PointEntry))}
    month_totals: dict[tuple[str, str], int] = {}
    for row in db.scalars(select(PointEntry)):
        key = (row.user_id, _month_key(utc_datetime(row.earned_at)))
        month_totals[key] = month_totals.get(key, 0) + row.points
    added = 0
    for item in sorted(_candidates(db), key=lambda candidate: candidate.earned_at):
        rule = rule_map.get(item.kind)
        if not rule or not rule.active or (item.user_id, item.kind, item.source_id) in existing:
            continue
        month = (item.user_id, _month_key(item.earned_at))
        room = max(0, cap - month_totals.get(month, 0))
        points = min(rule.points, room)
        reason = item.reason + ("" if points == rule.points else f" (monthly limit of {cap} reached)")
        db.add(PointEntry(id=str(uuid.uuid4()), user_id=item.user_id, kind=item.kind, points=points, reason=reason,
                          source_type=item.source_type, source_id=item.source_id, link=item.link, earned_at=item.earned_at))
        existing.add((item.user_id, item.kind, item.source_id))
        month_totals[month] = month_totals.get(month, 0) + points
        added += 1
    if added:
        try:
            db.commit()
        except IntegrityError:
            # Another request (e.g. the same page's other panel, or the scheduler) credited the same work
            # a moment earlier; the unique constraint kept it to once. Use theirs.
            db.rollback()
            return 0
    return added


def balance(db: Session, user_id: str) -> dict:
    earned = db.scalar(select(func.coalesce(func.sum(PointEntry.points), 0)).where(PointEntry.user_id == user_id)) or 0
    redeemed = db.scalar(select(func.coalesce(func.sum(PointRedemption.points), 0)).where(PointRedemption.user_id == user_id)) or 0
    return {"earned": int(earned), "redeemed": int(redeemed), "balance": int(earned) - int(redeemed)}


def entry_payload(entry: PointEntry, rule_map: dict[str, PointRule]) -> dict:
    rule = rule_map.get(entry.kind)
    return {"id": entry.id, "kind": entry.kind, "kind_label": rule.label if rule else entry.kind, "points": entry.points,
            "reason": entry.reason, "link": entry.link, "earned_at": utc_datetime(entry.earned_at).isoformat()}


# --- award periods -------------------------------------------------------------------------------

def award_period(award_type: str, key: str | None, now: datetime | None = None) -> tuple[str, str, date, date]:
    """(key, label, first day, last day). Quarters follow the financial year: Q1 = July to September."""
    if award_type == "MONTH":
        report = resolve_report_period("month", key, now)
        return report.key, report.period.first_day.strftime("%B %Y"), report.period.first_day, report.period.last_day
    if award_type == "YEAR":
        report = resolve_report_period("year", key, now)
        return report.key, f"Financial year {report.key}", report.period.first_day, report.period.last_day
    if award_type != "QUARTER":
        raise HTTPException(status_code=422, detail="Award type must be MONTH, QUARTER or YEAR")
    today = (now or utcnow()).astimezone(local_zone()).date()
    if key:
        try:
            year_part, quarter_part = key.split("-Q")
            start_year, quarter = int(year_part.split("/")[0]), int(quarter_part)
            if not 1 <= quarter <= 4 or fy_key(start_year) != year_part:
                raise ValueError
        except ValueError as exc:
            raise HTTPException(status_code=422, detail="Quarter looks like 2026/27-Q2") from exc
    else:  # the last complete quarter
        start_year = fy_start_year(today)
        quarter = (today.month - 7) % 12 // 3 + 1
        quarter -= 1
        if quarter == 0:
            start_year, quarter = start_year - 1, 4
    first_month = (7 + 3 * (quarter - 1) - 1) % 12 + 1
    first = date(start_year + (first_month < 7), first_month, 1)
    following = date(first.year + (first.month + 3 > 12), (first.month + 2) % 12 + 1, 1)
    key = f"{fy_key(start_year)}-Q{quarter}"
    return key, f"Q{quarter} of FY {fy_key(start_year)} ({first.strftime('%b')}–{(following - timedelta(days=1)).strftime('%b %Y')})", first, following - timedelta(days=1)


def earned_in(db: Session, first: date, last: date) -> dict[str, dict]:
    """Points per person in the period, with what they were for."""
    period = period_from_days(first, last)
    rule_map = rules(db)
    people: dict[str, dict] = {}
    for entry in db.scalars(select(PointEntry).where(PointEntry.earned_at >= period.start, PointEntry.earned_at < period.end)):
        row = people.setdefault(entry.user_id, {"points": 0, "by_kind": {}})
        row["points"] += entry.points
        label = rule_map[entry.kind].label if entry.kind in rule_map else entry.kind
        row["by_kind"][label] = row["by_kind"].get(label, 0) + 1
    return people


def shortlist(db: Session, award_type: str, key: str | None, scope: str) -> dict:
    """Top five by points in the period, with the evidence. A panel decides; the system only proposes."""
    period_key, label, first, last = award_period(award_type, key)
    earned = earned_in(db, first, last)
    users = {item.id: item for item in db.scalars(select(User).where(User.id.in_(list(earned))))} if earned else {}
    rows = []
    for user_id, row in earned.items():
        person = users.get(user_id)
        if not person or not person.active or row["points"] <= 0:
            continue
        if scope != "Overall" and person.section != scope:
            continue
        evidence = "; ".join(f"{count} × {kind.lower()}" for kind, count in sorted(row["by_kind"].items(), key=lambda pair: -pair[1]))
        rows.append({"user_id": user_id, "name": person.display_name, "section": person.section or "Cross-section",
                     "points": row["points"], "evidence": evidence})
    rows.sort(key=lambda item: (-item["points"], item["name"]))
    existing = db.scalar(select(Award).where(Award.award_type == award_type, Award.period_key == period_key, Award.scope == scope))
    return {"award_type": award_type, "award_label": AWARD_TYPES[award_type], "period": period_key, "period_label": label,
            "scope": scope, "shortlist": rows[:5], "awarded": award_payload(db, existing) if existing else None}


def award_payload(db: Session, award: Award) -> dict:
    person = db.get(User, award.user_id)
    return {"id": award.id, "award_type": award.award_type, "award_label": AWARD_TYPES.get(award.award_type, award.award_type),
            "period": award.period_key, "scope": award.scope, "user_id": award.user_id,
            "name": person.display_name if person else "", "section": person.section if person else "",
            "citation": award.citation, "prize": award.prize, "created_at": utc_datetime(award.created_at).isoformat()}
