"""Drawing register and drawing differences (as-found changes / red-lines).

Years of breakdown repairs mean some installations no longer match their
drawings. A technician records the difference at write-up; the section chief
verifies it; from then on it is printed on every job card for that equipment,
and it waits in the red-line list until the drawing office issues a revision.

The register is a placeholder for KPC's digitisation programme: a drawing is
PAPER until a `document_url` is linked (by hand now, by a connector later).
"""
from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Drawing, DrawingDifference, DrawingEquipment, Equipment, User

STATUS_LABELS = {
    "REPORTED": "Reported, waiting for the section chief to verify",
    "VERIFIED": "Verified: the installation differs from the drawing",
    "REJECTED": "Checked: not a difference",
    "INCORPORATED": "Drawing updated",
}


def find_drawing_id(db: Session, number: str) -> str | None:
    number = (number or "").strip()
    if not number:
        return None
    return db.scalar(select(Drawing.id).where(Drawing.number.ilike(number)))


def drawing_payload(item: Drawing, equipment_tags: list[str] | None = None) -> dict:
    return {
        "id": item.id, "number": item.number, "title": item.title, "revision": item.revision,
        "discipline": item.discipline, "status": item.status,
        "status_label": "Digitised" if item.status == "DIGITISED" else "Paper only (awaiting digitisation)",
        "document_url": item.document_url, "source": item.source, "equipment_tags": equipment_tags or [],
    }


def drawings_for_equipment(db: Session, equipment_id: str) -> list[dict]:
    rows = db.scalars(
        select(Drawing).join(DrawingEquipment, DrawingEquipment.drawing_id == Drawing.id)
        .where(DrawingEquipment.equipment_id == equipment_id).order_by(Drawing.number)
    ).all()
    return [drawing_payload(item) for item in rows]


def difference_payload(db: Session, item: DrawingDifference) -> dict:
    equipment = db.get(Equipment, item.equipment_id)
    drawing = db.get(Drawing, item.drawing_id) if item.drawing_id else None
    reporter = db.get(User, item.reported_by_id)
    verifier = db.get(User, item.verified_by_id) if item.verified_by_id else None
    return {
        "id": item.id,
        "equipment_id": item.equipment_id,
        "equipment_tag": equipment.tag if equipment else "",
        "equipment_name": equipment.name if equipment else "",
        "section": equipment.section if equipment else "",
        "drawing_number": drawing.number if drawing else item.drawing_number_text,
        "drawing_revision": drawing.revision if drawing else "",
        "drawing_in_register": bool(drawing),
        "description": item.description,
        "permanence": item.permanence,
        "fault_id": item.fault_id,
        "reported_by": reporter.display_name if reporter else "",
        "reported_at": item.reported_at.isoformat(),
        "status": item.status,
        "status_label": STATUS_LABELS.get(item.status, item.status),
        "verified_by": verifier.display_name if verifier else None,
        "verified_at": item.verified_at.isoformat() if item.verified_at else None,
        "review_note": item.review_note,
        "incorporated_revision": item.incorporated_revision,
    }


def differences_for_equipment(db: Session, equipment_id: str, *, include_closed: bool = False) -> list[dict]:
    """Verified first, then those still waiting; rejected and already-incorporated ones only on request."""
    statuses = ("VERIFIED", "REPORTED") + (("INCORPORATED", "REJECTED") if include_closed else ())
    rows = db.scalars(select(DrawingDifference).where(
        DrawingDifference.equipment_id == equipment_id, DrawingDifference.status.in_(statuses),
    ).order_by(DrawingDifference.reported_at.desc())).all()
    order = {status: index for index, status in enumerate(statuses)}
    return [difference_payload(db, item) for item in sorted(rows, key=lambda row: order[row.status])]
