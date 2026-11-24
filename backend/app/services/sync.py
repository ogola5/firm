"""Offline event synchronisation.

Each uploaded event is applied through the same service functions as the REST
routes, as the authenticated user, so offline clients cannot bypass permission
or workflow checks. Outcomes:

- APPLIED     the change was made; `result` holds the server's response.
- DUPLICATE   the event_id was received before; the stored outcome is returned.
- CONFLICT    the server state no longer allows the change (HTTP 409 from the
              workflow rules, or the fault's status differs from the status
              the device saw). The event is kept for reconciliation, and later
              events for the same fault in the batch are held behind it.
- REJECTED    permission or validation failure (other 4xx). Kept for audit.

Each event is committed separately, so one failure never loses another
event's change.
"""
from __future__ import annotations

import json
import uuid
from collections.abc import Callable

from fastapi import HTTPException
from pydantic import ValidationError
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import Fault, SyncBatch, SyncEvent, User, utcnow
from app.schemas import DiagnosisCreate, FaultCreate, InterventionCreate, SyncEventIn
from app.services import fault_operations
from app.services.access import require_fault_scope, require_roles, role_key
from app.services.audit import add_event, offline_origin

MAX_BATCH_SIZE = 500
SYNC_ROLES = fault_operations.REPORTING_ROLES
ORGANISATION_WIDE_RESOLVERS = ("supervisor", "maintenance_manager", "general_manager_om", "system_administrator")
SECTION_RESOLVERS = ("technician_ct", "chief_engineer")


def _require_fault_id(event: SyncEventIn) -> str:
    if not event.fault_id:
        raise HTTPException(status_code=422, detail="This event type requires a fault_id")
    return event.fault_id


def _apply_fault_reported(db: Session, user: User, event: SyncEventIn, check_base: bool) -> dict:
    return fault_operations.report_fault(db, user, FaultCreate(**event.payload), fault_id=event.fault_id)


def _apply_fault_action(db: Session, user: User, event: SyncEventIn, check_base: bool) -> dict:
    fault_id = _require_fault_id(event)
    action = str(event.payload.get("action", ""))
    fault = db.get(Fault, fault_id)
    if check_base and fault and event.base_status and fault.status != event.base_status:
        raise HTTPException(
            status_code=409,
            detail=f"The fault moved from {event.base_status} to {fault.status} while this device was offline",
        )
    return fault_operations.fault_action(db, user, fault_id, action)


def _apply_diagnosis(db: Session, user: User, event: SyncEventIn, check_base: bool) -> dict:
    return fault_operations.record_diagnosis(
        db, user, _require_fault_id(event), DiagnosisCreate(**event.payload),
        diagnosis_id=event.payload.get("diagnosis_id"),
    )


def _apply_intervention(db: Session, user: User, event: SyncEventIn, check_base: bool) -> dict:
    return fault_operations.record_intervention(
        db, user, _require_fault_id(event), InterventionCreate(**event.payload),
        intervention_id=event.payload.get("intervention_id"),
    )


def _apply_operator_update(db: Session, user: User, event: SyncEventIn, check_base: bool) -> dict:
    return fault_operations.add_operator_update(db, user, _require_fault_id(event), str(event.payload.get("note", "")))


APPLIERS: dict[str, Callable[[Session, User, SyncEventIn, bool], dict]] = {
    "FAULT_REPORTED": _apply_fault_reported,
    "FAULT_ACTION": _apply_fault_action,
    "DIAGNOSIS_RECORDED": _apply_diagnosis,
    "INTERVENTION_RECORDED": _apply_intervention,
    "OPERATOR_UPDATE": _apply_operator_update,
}


def _validation_detail(exc: ValidationError) -> str:
    first = exc.errors()[0] if exc.errors() else {}
    field = ".".join(str(part) for part in first.get("loc", ()))
    return f"Invalid payload: {field} {first.get('msg', '')}".strip()


def _apply(db: Session, user: User, event: SyncEventIn, *, check_base: bool, origin: dict) -> tuple[str, int, str, dict]:
    """Apply one event inside the current transaction. Returns (status, code, detail, result)."""
    applier = APPLIERS.get(event.event_type)
    if applier is None:
        return "REJECTED", 422, f"Unsupported offline event type {event.event_type}", {}
    try:
        with offline_origin(origin):
            result = applier(db, user, event, check_base)
        db.flush()
        return "APPLIED", 200, "", result
    except HTTPException as exc:
        db.rollback()
        status = "CONFLICT" if exc.status_code == 409 else "REJECTED"
        return status, exc.status_code, str(exc.detail), {}
    except ValidationError as exc:
        db.rollback()
        return "REJECTED", 422, _validation_detail(exc), {}


def event_view(record: SyncEvent, duplicate: bool = False) -> dict:
    return {
        "event_id": record.event_id,
        "fault_id": record.fault_id,
        "event_type": record.event_type,
        "status": "DUPLICATE" if duplicate else record.status,
        "stored_status": record.status,
        "status_code": record.status_code,
        "detail": record.detail,
        "result": json.loads(record.result or "{}"),
        "device_id": record.device_id,
        "sequence_number": record.sequence_number,
        "base_status": record.base_status,
        "payload": json.loads(record.payload or "{}"),
        "client_timestamp": record.client_timestamp,
        "received_at": record.received_at.isoformat() if record.received_at else None,
        "applied_at": record.applied_at.isoformat() if record.applied_at else None,
        "actor_id": record.actor_id,
        "resolved_by_id": record.resolved_by_id,
        "resolved_at": record.resolved_at.isoformat() if record.resolved_at else None,
        "resolution_note": record.resolution_note,
    }


def ingest(db: Session, user: User, events: list[SyncEventIn]) -> dict:
    require_roles(user, *SYNC_ROLES)
    if len(events) > MAX_BATCH_SIZE:
        raise HTTPException(status_code=413, detail=f"Send at most {MAX_BATCH_SIZE} events per batch")
    user_id = user.id
    device_id = next((event.device_id for event in events if event.device_id), "")
    batch = SyncBatch(id=str(uuid.uuid4()), actor_id=user_id, device_id=device_id, event_count=len(events))
    db.add(batch)
    db.commit()

    counts = {"APPLIED": 0, "CONFLICT": 0, "REJECTED": 0, "DUPLICATE": 0}
    held_by_fault: dict[str, str] = {}
    results = []
    # Device sequence numbers give causal order: a fault is reported before it is
    # diagnosed, and actions on one fault apply in the order the user made them.
    for event in sorted(events, key=lambda item: (item.sequence_number, item.client_timestamp)):
        existing = db.get(SyncEvent, event.event_id)
        if existing:
            counts["DUPLICATE"] += 1
            results.append(event_view(existing, duplicate=True))
            continue
        received_at = utcnow()
        if event.actor_id and event.actor_id != user_id:
            status, code, detail, result = "REJECTED", 403, "Offline events must belong to the authenticated user", {}
        elif event.fault_id and event.fault_id in held_by_fault:
            status, code, detail, result = (
                "CONFLICT", 409,
                f"Held behind earlier offline change {held_by_fault[event.fault_id]} to this fault, which needs reconciliation",
                {},
            )
        else:
            acting_user = db.get(User, user_id)
            status, code, detail, result = _apply(db, acting_user, event, check_base=True, origin={
                "sync_event_id": event.event_id,
                "device_id": event.device_id,
                "client_timestamp": event.client_timestamp,
                "received_at": received_at.isoformat(),
            })
        if status == "CONFLICT" and event.fault_id:
            held_by_fault.setdefault(event.fault_id, event.event_id)
        record = SyncEvent(
            event_id=event.event_id,
            batch_id=batch.id,
            fault_id=event.fault_id,
            event_type=event.event_type,
            actor_id=user_id,
            device_id=event.device_id,
            sequence_number=event.sequence_number,
            base_status=event.base_status,
            payload=json.dumps(event.payload, default=str),
            client_timestamp=event.client_timestamp,
            received_at=received_at,
            status=status,
            status_code=code,
            detail=detail,
            result=json.dumps(result, default=str),
            applied_at=utcnow() if status == "APPLIED" else None,
        )
        db.add(record)
        db.commit()
        counts[status] += 1
        results.append(event_view(record))

    batch = db.get(SyncBatch, batch.id)
    batch.applied_count = counts["APPLIED"]
    batch.conflict_count = counts["CONFLICT"]
    batch.rejected_count = counts["REJECTED"]
    batch.duplicate_count = counts["DUPLICATE"]
    db.commit()
    return {
        "batch_id": batch.id,
        "results": results,
        "counts": counts,
        # Kept for older clients: ids the server has now processed for the first time.
        "accepted": [item["event_id"] for item in results if item["status"] != "DUPLICATE"],
        "duplicates": [item["event_id"] for item in results if item["status"] == "DUPLICATE"],
    }


def _can_resolve(db: Session, user: User, record: SyncEvent) -> bool:
    key = role_key(user)
    if record.actor_id == user.id or key in ORGANISATION_WIDE_RESOLVERS:
        return True
    if key in SECTION_RESOLVERS and record.fault_id:
        fault = db.get(Fault, record.fault_id)
        if fault:
            try:
                require_fault_scope(user, fault)
                return True
            except HTTPException:
                return False
    return False


def list_conflicts(db: Session, user: User) -> list[dict]:
    require_roles(user, *SYNC_ROLES)
    records = db.scalars(
        select(SyncEvent).where(SyncEvent.status == "CONFLICT").order_by(SyncEvent.received_at, SyncEvent.sequence_number)
    ).all()
    return [event_view(record) for record in records if _can_resolve(db, user, record)]


def resolve_conflict(db: Session, user: User, event_id: str, decision: str, note: str) -> dict:
    require_roles(user, *SYNC_ROLES)
    record = db.get(SyncEvent, event_id)
    if not record or not _can_resolve(db, user, record):
        raise HTTPException(status_code=404, detail="Conflict not found")
    if record.status != "CONFLICT":
        raise HTTPException(status_code=409, detail="This event is not awaiting reconciliation")
    note = note.strip()
    resolver_id = user.id
    if decision == "DISCARD":
        if not note:
            raise HTTPException(status_code=422, detail="Explain why the offline change is being discarded")
        record.status = "RESOLVED_DISCARDED"
    else:
        # Re-apply as the original author so their permissions still govern the change.
        author = db.get(User, record.actor_id)
        event = SyncEventIn(
            event_id=record.event_id, fault_id=record.fault_id, event_type=record.event_type,
            device_id=record.device_id, client_timestamp=record.client_timestamp,
            sequence_number=record.sequence_number, base_status=record.base_status,
            payload=json.loads(record.payload or "{}"),
        )
        status, code, detail, result = _apply(db, author, event, check_base=False, origin={
            "sync_event_id": record.event_id,
            "device_id": record.device_id,
            "client_timestamp": record.client_timestamp,
            "received_at": record.received_at.isoformat(),
            "resolved_by": resolver_id,
        })
        record = db.get(SyncEvent, event_id)
        if status != "APPLIED":
            record.status_code = code
            record.detail = detail
            db.commit()
            raise HTTPException(status_code=409, detail=f"The change still cannot be applied: {detail}")
        record.status = "RESOLVED_APPLIED"
        record.result = json.dumps(result, default=str)
        record.applied_at = utcnow()
    record.resolved_by_id = resolver_id
    record.resolved_at = utcnow()
    record.resolution_note = note
    if record.fault_id and db.get(Fault, record.fault_id):
        add_event(db, record.fault_id, "SYNC_CONFLICT_RESOLVED", resolver_id, {
            "sync_event_id": record.event_id,
            "event_type": record.event_type,
            "decision": decision,
            "note": note,
            "original_actor_id": record.actor_id,
        })
    db.commit()
    return event_view(record)


def history(db: Session, user: User, limit: int = 20) -> list[dict]:
    require_roles(user, *SYNC_ROLES)
    query = select(SyncBatch).order_by(SyncBatch.received_at.desc()).limit(min(max(limit, 1), 100))
    if role_key(user) != "system_administrator":
        query = query.where(SyncBatch.actor_id == user.id)
    batches = db.scalars(query).all()
    events_by_batch: dict[str, list[SyncEvent]] = {}
    if batches:
        for record in db.scalars(
            select(SyncEvent).where(SyncEvent.batch_id.in_([batch.id for batch in batches])).order_by(SyncEvent.sequence_number)
        ).all():
            events_by_batch.setdefault(record.batch_id, []).append(record)
    return [{
        "id": batch.id,
        "actor_id": batch.actor_id,
        "device_id": batch.device_id,
        "received_at": batch.received_at.isoformat(),
        "event_count": batch.event_count,
        "applied": batch.applied_count,
        "conflicts": batch.conflict_count,
        "rejected": batch.rejected_count,
        "duplicates": batch.duplicate_count,
        "events": [event_view(record) for record in events_by_batch.get(batch.id, [])],
    } for batch in batches]


def status_summary(db: Session, user: User) -> dict:
    require_roles(user, *SYNC_ROLES)
    by_status = dict(db.execute(select(SyncEvent.status, func.count()).group_by(SyncEvent.status)).all())
    mine = dict(db.execute(
        select(SyncEvent.status, func.count()).where(SyncEvent.actor_id == user.id).group_by(SyncEvent.status)
    ).all())
    return {
        "received_events": sum(by_status.values()),
        "authoritative": True,
        "conflicts": len(list_conflicts(db, user)),
        "by_status": by_status,
        "mine": mine,
        "server_time": utcnow().isoformat(),
    }
