"""The knowledge library, organised the way a problem arrives: equipment type -> symptom -> what now.

For each symptom on an equipment type it brings together, from real records:
likely causes (how often confirmed), what worked, what did not, approved
procedures with their evidence and freshness, watch-outs (expert notes, safety,
drawing differences) and the cases themselves.

Philosophy (KNOWLEDGE_LIBRARY.md): a memory of what happened on our equipment,
led by cases, honest about failures, showing proof and how recent it is.
"""
from __future__ import annotations

import re
import uuid
from collections import Counter, defaultdict
from datetime import datetime, timedelta

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models import (
    Diagnosis, DrawingDifference, Equipment, EquipmentTypeOwner, ExpertSession, Fault, Intervention, KnowledgeEntry,
    KnowledgeReuse, KnowledgeReuseOutcome, ProcedureReview, ProcedureUpdate, User, utc_datetime, utcnow,
)
from app.services import accounts, notifications
from app.services.access import role_key
from app.services.catalogue import ACTION_TYPES, CAUSE_CATEGORIES, type_name, type_of
from app.services.report_answers import answer_insights
from app.services import text_search

# The problems Operations choose from when reporting (frontend reportQuestions.ts), plus older wordings.
SYMPTOM_RULES: list[tuple[str, str]] = [
    (r"won.?t open|won.?t close|not opening|not closing|stuck|valve", "Won't open / close"),
    (r"won.?t start|failure to start|fail(ed|s)? to start|not start", "Won't start"),
    (r"trip|stopped", "Stopped / tripped"),
    (r"leak", "Leaking"),
    (r"reading|drift|unstable|frozen|level|pressure", "Wrong or no reading"),
    (r"communicat|comms|signal|telemetry|link", "Communication lost"),
    (r"noise|vibrat|heat|hot|smell|smoke", "Noise, vibration or heat"),
    (r"block|clog|strainer|filter|flow", "Blocked or low flow"),
    (r"alarm", "Alarm only"),
]
OWNER_ROLES = ("technician_ct", "senior_engineer")
ASSIGNERS = ("chief_engineer", "maintenance_manager", "system_administrator")
CURRENT = "APPROVED"


def symptom_group(text: str) -> str:
    lowered = (text or "").lower()
    for pattern, label in SYMPTOM_RULES:
        if re.search(pattern, lowered):
            return label
    return "Other"


def cause_key(diagnosis: Diagnosis) -> str:
    """Group causes that mean the same thing: the cause category from the write-up pick-list, else the words."""
    if diagnosis.cause_category and diagnosis.cause_category != "not_found":
        return f"category:{diagnosis.cause_category}"
    return "text:" + " ".join(re.findall(r"[a-z0-9]+", diagnosis.possible_cause.lower()))


def _iso(value: datetime | None) -> str | None:
    return utc_datetime(value).isoformat() if value else None


def _equipment_of_type(db: Session, code: str) -> list[Equipment]:
    return [item for item in db.scalars(select(Equipment)) if not item.tag.startswith("UNCONFIRMED") and type_of(item.tag) == code]


def owner_of(db: Session, code: str) -> dict | None:
    row = db.get(EquipmentTypeOwner, code)
    person = db.get(User, row.owner_id) if row else None
    if not person:
        return None
    return {"id": person.id, "name": person.display_name, "role": role_key(person), "section": person.section,
            "since": _iso(row.assigned_at)}


# --- procedures: evidence and freshness ---------------------------------------------------------------

def procedure_evidence(db: Session, update: ProcedureUpdate, now: datetime | None = None) -> dict:
    """How well this procedure (any version in its lineage) has worked, and how recently it was confirmed."""
    now = now or utcnow()
    lineage = [item.id for item in db.scalars(select(ProcedureUpdate).where(ProcedureUpdate.lineage_id == update.lineage_id))]
    rows = db.execute(
        select(KnowledgeReuse, KnowledgeReuseOutcome)
        .outerjoin(KnowledgeReuseOutcome, KnowledgeReuseOutcome.reuse_id == KnowledgeReuse.id)
        .where(KnowledgeReuse.procedure_update_id.in_(lineage))
    ).all()
    worked = [utc_datetime(outcome.confirmed_at) for _, outcome in rows if outcome and outcome.outcome == "SUCCESS"]
    failed = sum(1 for _, outcome in rows if outcome and outcome.outcome == "FAILED")
    source = db.get(Fault, update.fault_id)
    confirmations = worked + ([utc_datetime(source.restored_at)] if source and source.restored_at else [])
    last = max(confirmations) if confirmations else None
    fading = last is None or now - last > timedelta(days=settings.knowledge_fade_days)
    return {
        "worked": len(worked) + (1 if source and source.restored_at else 0),  # the original fix counts once
        "failed": failed,
        "used": len(rows),
        "last_confirmed_working": _iso(last),
        "fading": fading,
        "freshness": "Not confirmed working for over a year: check before relying on it" if fading else "Confirmed working recently",
    }


def procedure_card(db: Session, update: ProcedureUpdate, now: datetime | None = None) -> dict:
    author = db.get(User, update.author_id)
    source = db.get(Fault, update.fault_id)
    versions = db.scalars(select(ProcedureUpdate).where(ProcedureUpdate.lineage_id == update.lineage_id)
                          .order_by(ProcedureUpdate.version)).all()
    contributors = []
    for item in versions:
        person = db.get(User, item.author_id)
        if person and person.display_name not in contributors and item.status in (CURRENT, "SUPERSEDED", "WITHDRAWN"):
            contributors.append(person.display_name)
    return {
        "id": update.id, "reference": update.reference, "title": update.title, "version": update.version,
        "status": update.status, "section": update.section,
        "symptom": update.observed_symptom, "cause": update.confirmed_cause,
        "checks": update.diagnostic_procedure, "fix": update.corrective_action, "safety": update.safety,
        "author": author.display_name if author else "", "contributors": contributors,
        "source_fault": {"id": source.id, "reference": source.reference} if source else None,
        "evidence": procedure_evidence(db, update, now),
        "history": [{"version": item.version, "reference": item.reference, "status": item.status,
                     "author": (db.get(User, item.author_id).display_name if db.get(User, item.author_id) else ""),
                     "created_at": _iso(item.created_at)} for item in versions],
    }


def current_procedures(db: Session) -> list[ProcedureUpdate]:
    """The latest approved version of each procedure."""
    latest: dict[str, ProcedureUpdate] = {}
    for item in db.scalars(select(ProcedureUpdate).where(ProcedureUpdate.status == CURRENT)):
        if item.lineage_id not in latest or item.version > latest[item.lineage_id].version:
            latest[item.lineage_id] = item
    return list(latest.values())


def procedure_type(db: Session, update: ProcedureUpdate) -> str:
    fault = db.get(Fault, update.fault_id)
    return type_of(fault.equipment.tag) if fault and fault.equipment_confirmed and fault.equipment else ""


# --- the list of equipment types -----------------------------------------------------------------------

def type_list(db: Session, now: datetime | None = None) -> list[dict]:
    now = now or utcnow()
    year_ago = now - timedelta(days=365)
    equipment = [item for item in db.scalars(select(Equipment)) if not item.tag.startswith("UNCONFIRMED")]
    by_type: dict[str, list[Equipment]] = defaultdict(list)
    for item in equipment:
        code = type_of(item.tag)
        if code:
            by_type[code].append(item)
    faults = db.scalars(select(Fault).where(Fault.equipment_confirmed == 1)).all()
    type_by_equipment = {item.id: type_of(item.tag) for item in equipment}
    fault_counts, recent_counts, open_counts = Counter(), Counter(), Counter()
    for fault in faults:
        code = type_by_equipment.get(fault.equipment_id)
        if not code:
            continue
        fault_counts[code] += 1
        if utc_datetime(fault.created_at) >= year_ago:
            recent_counts[code] += 1
        if fault.status not in ("RESTORED", "CLOSED"):
            open_counts[code] += 1
    procedures: dict[str, list[ProcedureUpdate]] = defaultdict(list)
    for item in current_procedures(db):
        procedures[procedure_type(db, item)].append(item)
    experts = Counter(item.equipment_type for item in db.scalars(select(ExpertSession).where(ExpertSession.status == "APPROVED")))
    differences = Counter(type_by_equipment.get(item.equipment_id) for item in db.scalars(
        select(DrawingDifference).where(DrawingDifference.status == "VERIFIED")))
    rows = []
    for code, items in by_type.items():
        evidence = [procedure_evidence(db, item, now) for item in procedures.get(code, [])]
        rows.append({
            "code": code, "name": type_name(code),
            "sections": sorted({item.section for item in items}),
            "regions": sorted({item.region for item in items if item.region}),
            "equipment_count": len(items),
            "faults": fault_counts[code], "faults_last_year": recent_counts[code], "open_faults": open_counts[code],
            "procedures": len(evidence), "fading_procedures": sum(item["fading"] for item in evidence),
            "expert_notes": experts[code], "drawing_differences": differences[code],
            "owner": owner_of(db, code),
        })
    # Where the library matters most first: most faults in the last year.
    return sorted(rows, key=lambda row: (-row["faults_last_year"], -row["faults"], row["name"]))


# --- one equipment type -------------------------------------------------------------------------------

def type_page(db: Session, user: User, code: str, now: datetime | None = None) -> dict:
    now = now or utcnow()
    code = code.upper()
    equipment = _equipment_of_type(db, code)
    if not equipment:
        raise HTTPException(status_code=404, detail="No equipment of this type")
    ids = {item.id for item in equipment}
    by_id = {item.id: item for item in equipment}
    faults = db.scalars(select(Fault).where(Fault.equipment_id.in_(ids), Fault.equipment_confirmed == 1)
                        .order_by(Fault.created_at.desc())).all()
    fault_ids = [fault.id for fault in faults]
    diagnoses = db.scalars(select(Diagnosis).where(Diagnosis.fault_id.in_(fault_ids))).all() if fault_ids else []
    interventions = db.scalars(select(Intervention).where(Intervention.fault_id.in_(fault_ids))
                               .order_by(Intervention.created_at)).all() if fault_ids else []
    diagnoses_by_fault: dict[str, list[Diagnosis]] = defaultdict(list)
    for item in diagnoses:
        diagnoses_by_fault[item.fault_id].append(item)
    interventions_by_fault: dict[str, list[Intervention]] = defaultdict(list)
    for item in interventions:
        interventions_by_fault[item.fault_id].append(item)

    groups: dict[str, dict] = {}
    for fault in faults:
        label = symptom_group(f"{fault.symptom} {fault.description}" if symptom_group(fault.symptom) == "Other" else fault.symptom)
        group = groups.setdefault(label, {
            "symptom": label, "faults": 0, "last_seen": None,
            "_causes": defaultdict(lambda: {"confirmed": 0, "seen": 0, "checks": Counter(), "category": "", "wordings": Counter()}),
            "_worked": Counter(), "_worked_type": {}, "_failed": Counter(), "_failed_notes": {}, "cases": [], "_fault_ids": set(),
            "_faults": [],
        })
        group["_faults"].append(fault)
        group["faults"] += 1
        group["_fault_ids"].add(fault.id)
        group["last_seen"] = group["last_seen"] or _iso(fault.created_at)
        attempts = interventions_by_fault.get(fault.id, [])
        succeeded_diagnoses = {item.diagnosis_id for item in attempts if item.outcome == "SUCCESS"}
        for diagnosis in diagnoses_by_fault.get(fault.id, []):
            # Same kind of cause, different wording: merged (by cause category, else by normalised text).
            cause = group["_causes"][cause_key(diagnosis)]
            cause["seen"] += 1
            cause["confirmed"] += int(diagnosis.id in succeeded_diagnoses)
            cause["category"] = cause["category"] or diagnosis.cause_category
            cause["wordings"][diagnosis.possible_cause.strip()] += 1
            if diagnosis.quick_check:
                cause["checks"][diagnosis.quick_check.strip()] += 1
        for attempt in attempts:
            words = attempt.corrective_action.strip()
            if attempt.outcome == "SUCCESS":
                group["_worked"][words] += 1
                group["_worked_type"][words] = attempt.action_type
            elif attempt.outcome == "FAILED":
                group["_failed"][words] += 1
                if attempt.notes:
                    group["_failed_notes"][words] = attempt.notes
        if len(group["cases"]) < 6:
            item = by_id[fault.equipment_id]
            group["cases"].append({
                "id": fault.id, "reference": fault.reference, "equipment_tag": item.tag, "station": item.station,
                "region": item.region, "reported_at": _iso(fault.created_at), "status": fault.status,
                "description": (fault.description or "")[:240],
                "cause": next((diagnosis.possible_cause for diagnosis in diagnoses_by_fault.get(fault.id, [])), ""),
                "failed_attempts": sum(attempt.outcome == "FAILED" for attempt in attempts),
                "fixed_by": next((attempt.corrective_action for attempt in attempts if attempt.outcome == "SUCCESS"), ""),
            })

    fixes = {fault_id: next((item.corrective_action for item in attempts if item.outcome == "SUCCESS"), "")
             for fault_id, attempts in interventions_by_fault.items()}
    fixes = {key: value for key, value in fixes.items() if value}
    procedures = [item for item in current_procedures(db) if procedure_type(db, item) == code]
    cards_by_group: dict[str, list[dict]] = defaultdict(list)
    for item in procedures:
        cards_by_group[symptom_group(item.observed_symptom)].append(procedure_card(db, item, now))

    symptoms = []
    for label in sorted(set(groups) | set(cards_by_group), key=lambda key: -(groups.get(key, {}).get("faults", 0))):
        group = groups.get(label, {"faults": 0, "last_seen": None, "_causes": {}, "_worked": Counter(), "_worked_type": {},
                                   "_failed": Counter(), "_failed_notes": {}, "cases": [], "_faults": []})
        causes = sorted(group["_causes"].items(), key=lambda pair: (-pair[1]["confirmed"], -pair[1]["seen"], pair[0]))
        symptoms.append({
            "symptom": label, "faults": group["faults"], "last_seen": group["last_seen"],
            "causes": [{
                # The most common wording leads; the others are listed so nothing recorded is hidden.
                "cause": data["wordings"].most_common(1)[0][0] if data["wordings"] else key,
                "also_recorded_as": [text for text, _ in data["wordings"].most_common()][1:4],
                "confirmed": data["confirmed"], "seen": data["seen"],
                "category": CAUSE_CATEGORIES.get(data["category"], ""),
                "first_check": data["checks"].most_common(1)[0][0] if data["checks"] else "",
            } for key, data in causes[:5]],
            "worked": [{"action": action, "times": times, "kind": ACTION_TYPES.get(group["_worked_type"].get(action, ""), "")}
                       for action, times in group["_worked"].most_common(5)],
            "did_not_work": [{"action": action, "times": times, "note": group["_failed_notes"].get(action, "")}
                             for action, times in group["_failed"].most_common(5)],
            # What reporters answered (JSONB answers), and what usually fixed it when they said so.
            "from_reports": answer_insights(group["_faults"], fixes),
            "procedures": sorted(cards_by_group.get(label, []), key=lambda card: (card["evidence"]["fading"], -card["evidence"]["worked"])),
            "cases": group["cases"],
        })

    experts = db.scalars(select(ExpertSession).where(ExpertSession.status == "APPROVED", ExpertSession.equipment_type == code)
                         .order_by(ExpertSession.created_at.desc())).all()
    differences = db.scalars(select(DrawingDifference).where(DrawingDifference.equipment_id.in_(ids),
                                                             DrawingDifference.status == "VERIFIED")).all()
    older = db.scalars(select(KnowledgeEntry).where(KnowledgeEntry.status == "APPROVED", KnowledgeEntry.equipment_id.in_(ids))).all()
    safety = []
    for item in procedures:
        if item.safety and item.safety not in safety:
            safety.append(item.safety)
    for item in experts:
        if item.safety and item.safety not in safety:
            safety.append(item.safety)
    owner = owner_of(db, code)
    key = role_key(user)
    return {
        "code": code, "name": type_name(code),
        "sections": sorted({item.section for item in equipment}),
        "equipment": [{"id": item.id, "tag": item.tag, "name": item.name, "station": item.station, "region": item.region,
                       "section": item.section} for item in sorted(equipment, key=lambda row: row.tag)],
        "faults": len(faults),
        "owner": owner,
        "can_assign_owner": key in ASSIGNERS,
        "can_withdraw": can_withdraw(user, code, owner),
        "symptoms": symptoms,
        "watch_out": {
            "expert_notes": [{
                "id": item.id, "title": item.title, "expert": (db.get(User, item.expert_id).display_name if db.get(User, item.expert_id) else ""),
                "year": item.created_at.year, "how_it_fails": item.how_it_fails, "first_checks": item.first_checks,
                "what_fools_people": item.what_fools_people, "tricks": item.tricks,
            } for item in experts],
            "safety": safety[:6],
            "drawing_differences": [{
                "id": item.id, "equipment_tag": db.get(Equipment, item.equipment_id).tag, "description": item.description,
                "drawing": item.drawing_number_text, "permanence": item.permanence,
            } for item in differences],
        },
        "older_instructions": [{
            "id": item.id, "reference": item.reference, "title": item.title, "symptom": item.symptom,
            "cause": item.confirmed_cause, "action": item.corrective_action, "legacy_reference": item.legacy_reference,
        } for item in older],
    }


# --- owners, withdrawal, revisions ----------------------------------------------------------------------

def can_withdraw(user: User, code: str, owner: dict | None) -> bool:
    key = role_key(user)
    return (owner is not None and owner["id"] == user.id) or key in ("chief_engineer", "supervisor", "maintenance_manager")


def assign_owner(db: Session, user: User, code: str, owner_id: str) -> dict:
    if role_key(user) not in ASSIGNERS:
        raise HTTPException(status_code=403, detail="Chief Engineers, the Maintenance Manager or the System Administrator assign owners")
    code = code.upper()
    if not _equipment_of_type(db, code):
        raise HTTPException(status_code=404, detail="No equipment of this type")
    person = db.get(User, owner_id)
    if not person or not person.active or role_key(person) not in OWNER_ROLES:
        raise HTTPException(status_code=422, detail="Choose an active Chief Technician or Senior Engineer")
    if role_key(user) == "chief_engineer" and person.section != user.section:
        raise HTTPException(status_code=403, detail="Choose someone in your section")
    row = db.get(EquipmentTypeOwner, code)
    if row:
        row.owner_id, row.assigned_by_id, row.assigned_at = person.id, user.id, utcnow()
    else:
        db.add(EquipmentTypeOwner(equipment_type=code, owner_id=person.id, assigned_by_id=user.id, assigned_at=utcnow()))
    notifications.notify(db, [person], "knowledge", f"You now keep the knowledge for {type_name(code)}",
                         f"Named by {user.display_name}. Check what is fading and withdraw what no longer works.", f"/library/{code}",
                         exclude=user.id)
    accounts.send_mail(db, person.email, f"You now keep the knowledge for {type_name(code)}",
                       f"Hello {person.display_name},\n\n{user.display_name} has named you the knowledge owner for {type_name(code)}.\n"
                       "You will hear when procedures for this equipment are written or revised. Please keep its page current: "
                       "withdraw what no longer works and check anything marked as fading.\n"
                       f"{settings.app_url.rstrip('/')}/library/{code}")
    db.commit()
    return owner_of(db, code) or {}


def withdraw(db: Session, user: User, update_id: str, reason: str) -> dict:
    update = db.get(ProcedureUpdate, update_id)
    if not update or update.status != CURRENT:
        raise HTTPException(status_code=404, detail="Current procedure not found")
    code = procedure_type(db, update)
    if not can_withdraw(user, code, owner_of(db, code)):
        raise HTTPException(status_code=403, detail="Only the knowledge owner, the Chief Engineer or a supervisor can withdraw a procedure")
    if role_key(user) == "chief_engineer" and update.section != user.section:
        raise HTTPException(status_code=403, detail="This procedure belongs to another section")
    reason = reason.strip()
    if len(reason) < 5:
        raise HTTPException(status_code=422, detail="Say why it no longer applies")
    update.status, update.updated_at = "WITHDRAWN", utcnow()
    db.add(ProcedureReview(id=str(uuid.uuid4()), procedure_update_id=update.id, reviewer_id=user.id,
                           decision="WITHDRAWN", comments=reason))
    author = db.get(User, update.author_id)
    if author and author.id != user.id:
        notifications.notify(db, [author], "knowledge", f"Withdrawn: {update.title}",
                             f"{user.display_name}: {reason}. It stays in the history and still counts for you.", f"/library/{code}")
        accounts.send_mail(db, author.email, f"{update.reference} has been withdrawn",
                           f"Hello {author.display_name},\n\n{user.display_name} withdrew \"{update.title}\": {reason}\n"
                           "It stays in the history and still counts for you; it is no longer shown as current guidance.")
    db.commit()
    return {"id": update.id, "status": update.status}


def supersede_earlier(db: Session, update: ProcedureUpdate, reviewer_id: str) -> None:
    """A newer version was approved: the earlier approved versions stay in the history, marked Superseded."""
    for item in db.scalars(select(ProcedureUpdate).where(ProcedureUpdate.lineage_id == update.lineage_id,
                                                         ProcedureUpdate.id != update.id, ProcedureUpdate.status == CURRENT)):
        if item.version < update.version:
            item.status, item.updated_at = "SUPERSEDED", utcnow()
            db.add(ProcedureReview(id=str(uuid.uuid4()), procedure_update_id=item.id, reviewer_id=reviewer_id,
                                   decision="SUPERSEDED", comments=f"Replaced by version {update.version} ({update.reference})."))


def matches_for_fault(db: Session, fault: Fault) -> list[dict]:
    """Approved procedures this write-up might add to: same equipment type, ranked by equipment, symptom and cause."""
    if not (fault.equipment_confirmed and fault.equipment):
        return []
    code = type_of(fault.equipment.tag)
    group = symptom_group(fault.symptom)
    causes = " ".join(item.possible_cause.lower() for item in db.scalars(select(Diagnosis).where(Diagnosis.fault_id == fault.id)))
    cause_words = {word for word in re.findall(r"[a-z]{4,}", causes)}
    rows = []
    for item in current_procedures(db):
        if item.fault_id == fault.id or procedure_type(db, item) != code:
            continue
        reasons, score = [], 0
        source = db.get(Fault, item.fault_id)
        if source and source.equipment_id == fault.equipment_id:
            score += 3
            reasons.append("same equipment")
        else:
            reasons.append(f"same type ({type_name(code).lower()})")
        if symptom_group(item.observed_symptom) == group:
            score += 2
            reasons.append(f"same problem ({group.lower()})")
        shared = cause_words & set(re.findall(r"[a-z]{4,}", item.confirmed_cause.lower()))
        if shared:
            score += 1
            reasons.append("similar cause")
        if score >= 2:
            card = procedure_card(db, item)
            rows.append({**card, "score": score, "reasons": reasons})
    return sorted(rows, key=lambda row: -row["score"])[:3]


def notify_owner(db: Session, update: ProcedureUpdate, what: str) -> None:
    code = procedure_type(db, update)
    owner = owner_of(db, code)
    if not owner or owner["id"] == update.author_id:
        return
    person = db.get(User, owner["id"])
    author = db.get(User, update.author_id)
    notifications.notify(db, [person], "knowledge", f"{what}: {update.title}",
                         f"{author.display_name if author else 'A colleague'} · {type_name(code)}, version {update.version}",
                         f"/library/{code}")
    accounts.send_mail(db, person.email, f"{what}: {update.reference} ({type_name(code)})",
                       f"Hello {person.display_name},\n\n{author.display_name if author else 'A colleague'} — {what.lower()}: "
                       f"\"{update.title}\" (version {update.version}).\n{settings.app_url.rstrip('/')}/library/{code}")


def thank_author(db: Session, reuse: KnowledgeReuse, outcome: str) -> None:
    """The loop that builds the habit: tell the author when their procedure helped a colleague."""
    if outcome != "SUCCESS":
        return
    update = db.get(ProcedureUpdate, reuse.procedure_update_id)
    if not update or update.author_id == reuse.actor_id:
        return
    author, colleague, fault = db.get(User, update.author_id), db.get(User, reuse.actor_id), db.get(Fault, reuse.fault_id)
    if not author:
        return
    tag = fault.equipment.tag if fault and fault.equipment_confirmed and fault.equipment else "a breakdown"
    notifications.notify(db, [author], "recognition", f"Your procedure helped {colleague.display_name if colleague else 'a colleague'}",
                         f"They fixed {tag} with {update.reference} \"{update.title}\" and confirmed it worked. Thank you.", "/recognition")
    accounts.send_mail(db, author.email, f"Your procedure helped {colleague.display_name if colleague else 'a colleague'}",
                       f"Hello {author.display_name},\n\n{colleague.display_name if colleague else 'A colleague'} used "
                       f"{update.reference} \"{update.title}\" on {tag} and confirmed it worked. Thank you: this is exactly "
                       "what the library is for. It also earns you recognition points.")


def my_impact(db: Session, user: User, now: datetime | None = None) -> dict:
    """What this person's knowledge has done for colleagues (shown on their home)."""
    now = now or utcnow()
    mine = db.scalars(select(ProcedureUpdate).where(ProcedureUpdate.author_id == user.id)).all()
    ids = [item.id for item in mine]
    helped = []
    if ids:
        rows = db.execute(
            select(KnowledgeReuse, KnowledgeReuseOutcome, ProcedureUpdate)
            .join(KnowledgeReuseOutcome, KnowledgeReuseOutcome.reuse_id == KnowledgeReuse.id)
            .join(ProcedureUpdate, ProcedureUpdate.id == KnowledgeReuse.procedure_update_id)
            .where(KnowledgeReuse.procedure_update_id.in_(ids), KnowledgeReuseOutcome.outcome == "SUCCESS",
                   KnowledgeReuse.actor_id != user.id)
            .order_by(KnowledgeReuseOutcome.confirmed_at.desc())
        ).all()
        for reuse, outcome, update in rows:
            colleague, fault = db.get(User, reuse.actor_id), db.get(Fault, reuse.fault_id)
            helped.append({
                "procedure_reference": update.reference, "procedure_title": update.title,
                "colleague": colleague.display_name if colleague else "",
                "equipment_tag": fault.equipment.tag if fault and fault.equipment else "",
                "confirmed_at": _iso(outcome.confirmed_at),
            })
    owned = [row.equipment_type for row in db.scalars(select(EquipmentTypeOwner).where(EquipmentTypeOwner.owner_id == user.id))]
    attention = []
    for code in owned:
        for item in current_procedures(db):
            if procedure_type(db, item) == code and procedure_evidence(db, item, now)["fading"]:
                attention.append({"code": code, "reference": item.reference, "title": item.title})
    recent = [item for item in helped if item["confirmed_at"] and utc_datetime(datetime.fromisoformat(item["confirmed_at"])) >= now - timedelta(days=90)]
    return {
        "published": sum(item.status in (CURRENT, "SUPERSEDED") for item in mine),
        "helped_total": len(helped), "helped_last_90_days": len(recent), "helped": helped[:5],
        "owned_types": [{"code": code, "name": type_name(code)} for code in owned],
        "needs_attention": attention[:5],
    }


# --- search across the library --------------------------------------------------------------------

KIND_LABELS = {"case": "What happened", "procedure": "Approved procedure", "expert": "Expert knowledge",
               "instruction": "Older work instruction"}


def search_results(db: Session, query: str, limit: int = 25) -> list[dict]:
    """Ranked results from cases, procedures, expert notes and older instructions, each with where to go."""
    rows = []
    for hit in text_search.search(db, query, limit=limit):
        base = {"kind": hit.kind, "kind_label": KIND_LABELS[hit.kind], "id": hit.id, "snippet": hit.snippet,
                "matched_words": hit.score[0]}
        if hit.kind == "case":
            fault = db.get(Fault, hit.id)
            if not fault:
                continue
            equipment = fault.equipment if fault.equipment_confirmed else None
            rows.append({**base, "title": f"{fault.reference} · {equipment.tag if equipment else fault.reported_equipment_text or 'equipment not identified'}: {fault.symptom}",
                         "type_code": type_of(equipment.tag) if equipment else "", "date": _iso(fault.created_at), "status": fault.status,
                         "link": f"/faults?mode=history&fault={fault.id}"})
        elif hit.kind == "procedure":
            update = db.get(ProcedureUpdate, hit.id)
            if not update:
                continue
            code = procedure_type(db, update)
            rows.append({**base, "title": f"{update.reference} v{update.version}: {update.title}", "type_code": code,
                         "evidence": procedure_evidence(db, update), "link": f"/library/{code}" if code else "/knowledge"})
        elif hit.kind == "expert":
            session = db.get(ExpertSession, hit.id)
            if not session:
                continue
            expert = db.get(User, session.expert_id)
            rows.append({**base, "title": f"{session.title} ({expert.display_name if expert else 'expert'}, {session.created_at:%Y})",
                         "type_code": session.equipment_type, "link": f"/library/{session.equipment_type}"})
        else:
            entry = db.get(KnowledgeEntry, hit.id)
            if not entry:
                continue
            equipment = db.get(Equipment, entry.equipment_id) if entry.equipment_id else None
            code = type_of(equipment.tag) if equipment else ""
            rows.append({**base, "title": f"{entry.reference}: {entry.title}", "type_code": code,
                         "link": f"/library/{code}" if code else "/knowledge"})
    return rows

# --- versions of one procedure, for side-by-side comparison --------------------------------------------

COMPARED_FIELDS = [("title", "Title"), ("observed_symptom", "When you see"), ("confirmed_cause", "Cause"),
                   ("diagnostic_procedure", "Check first"), ("corrective_action", "Fix"), ("safety", "Safety")]
PUBLIC = (CURRENT, "SUPERSEDED", "WITHDRAWN")


def can_see_draft(user: User, update: ProcedureUpdate) -> bool:
    """Unpublished versions: the author, the section's reviewers and supervisors."""
    key = role_key(user)
    return (update.author_id == user.id or key in ("supervisor", "system_administrator", "maintenance_manager")
            or (key in ("technician_ct", "chief_engineer") and user.section == update.section))


def lineage_versions(db: Session, user: User, update_id: str) -> dict:
    """Every version of a procedure: content, author, when, why it changed, who approved it, review notes."""
    start = db.get(ProcedureUpdate, update_id)
    if not start:
        raise HTTPException(status_code=404, detail="Procedure not found")
    versions = db.scalars(select(ProcedureUpdate).where(ProcedureUpdate.lineage_id == start.lineage_id)
                          .order_by(ProcedureUpdate.version, ProcedureUpdate.created_at)).all()
    visible = [item for item in versions if item.status in PUBLIC or can_see_draft(user, item)]
    if start not in visible:
        raise HTTPException(status_code=404, detail="Procedure not found")
    rows = []
    for item in visible:
        reviews = db.scalars(select(ProcedureReview).where(ProcedureReview.procedure_update_id == item.id)
                             .order_by(ProcedureReview.created_at)).all()
        published = next((review for review in reviews if review.decision == "SUPERVISOR_APPROVED"), None)
        technical = next((review for review in reviews if review.decision == "TECHNICAL_APPROVED"), None)
        author = db.get(User, item.author_id)
        source = db.get(Fault, item.fault_id)
        rows.append({
            "id": item.id, "reference": item.reference, "version": item.version, "status": item.status,
            "author": author.display_name if author else "", "created_at": _iso(item.created_at),
            "change_reason": item.change_reason or "",
            "source_fault": {"id": source.id, "reference": source.reference} if source else None,
            "technical_review_by": technical.reviewer.display_name if technical and technical.reviewer else "",
            "published_by": published.reviewer.display_name if published and published.reviewer else "",
            "published_at": _iso(published.created_at) if published else None,
            "reviews": [{"decision": review.decision, "comments": review.comments, "created_at": _iso(review.created_at),
                         "by": review.reviewer.display_name if review.reviewer else ""} for review in reviews],
            "fields": {key: getattr(item, key) or "" for key, _ in COMPARED_FIELDS},
        })
    return {"lineage_id": start.lineage_id, "field_labels": dict(COMPARED_FIELDS), "versions": rows,
            "equipment_type": procedure_type(db, start)}