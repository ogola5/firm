"""Pick-lists, the drawing register and drawing differences (services/drawings.py)."""
from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import db_dep
from app.deps import current_user
from app.models import Drawing, DrawingDifference, DrawingEquipment, Equipment, User, utcnow
from app.schemas import DrawingDifferenceIn
from app.services.access import TECHNICAL_ROLES, require_equipment_scope, require_roles, role_key
from app.services.audit import audit_user_change
from app.services.catalogue import catalogue
from app.services.drawings import difference_payload, differences_for_equipment, drawing_payload, drawings_for_equipment, find_drawing_id
from app.services.workspace import ANALYTICS_ORG_WIDE

router = APIRouter()

VERIFIERS = ("technician_ct", "chief_engineer")
DRAWING_OFFICE = ("system_administrator", "maintenance_manager")  # stand-in until the drawing office has accounts


class DifferenceReview(BaseModel):
    decision: str  # VERIFIED or REJECTED
    note: str = Field(default="", max_length=2000)


class DifferenceIncorporated(BaseModel):
    revision: str = Field(min_length=1, max_length=40)


class DrawingCreate(BaseModel):
    number: str = Field(min_length=2, max_length=80)
    title: str = Field(min_length=2, max_length=200)
    revision: str = ""
    discipline: str = ""
    equipment_tags: list[str] = []
    document_url: str | None = None


class DrawingUpdate(BaseModel):
    revision: str | None = None
    document_url: str | None = None


@router.get("/api/v1/catalogue")
def pick_lists(user: User = Depends(current_user)):
    return catalogue()


def _equipment(db: Session, user: User, equipment_id: str) -> Equipment:
    equipment = db.get(Equipment, equipment_id)
    if not equipment:
        raise HTTPException(status_code=404, detail="Equipment not found")
    require_equipment_scope(user, equipment)
    return equipment


@router.get("/api/v1/equipment/{equipment_id}/drawings")
def equipment_drawings(equipment_id: str, user: User = Depends(current_user), db: Session = Depends(db_dep)):
    _equipment(db, user, equipment_id)
    return {"drawings": drawings_for_equipment(db, equipment_id),
            "differences": differences_for_equipment(db, equipment_id, include_closed=True)}


@router.post("/api/v1/equipment/{equipment_id}/drawing-differences", status_code=201)
def report_difference(equipment_id: str, req: DrawingDifferenceIn, user: User = Depends(current_user), db: Session = Depends(db_dep)):
    """Record a difference outside a visit write-up (e.g. found on a walk-round)."""
    require_roles(user, *TECHNICAL_ROLES)
    _equipment(db, user, equipment_id)
    if not req.description.strip():
        raise HTTPException(status_code=422, detail="Say what differs from the drawing")
    item = DrawingDifference(
        id=str(uuid.uuid4()), equipment_id=equipment_id, drawing_id=find_drawing_id(db, req.drawing_number),
        drawing_number_text=req.drawing_number.strip(), description=req.description.strip(), permanence=req.permanence,
        reported_by_id=user.id, reported_at=utcnow(),
    )
    db.add(item)
    db.commit()
    return difference_payload(db, item)


@router.get("/api/v1/drawing-differences")
def difference_queue(status: str = "REPORTED", user: User = Depends(current_user), db: Session = Depends(db_dep)):
    """Section chiefs: differences to verify. Drawing office / managers: verified red-lines waiting for a new revision."""
    key = role_key(user)
    require_roles(user, *VERIFIERS, *ANALYTICS_ORG_WIDE, "general_manager_om")
    query = select(DrawingDifference).join(Equipment, DrawingDifference.equipment_id == Equipment.id)
    if status != "ALL":
        query = query.where(DrawingDifference.status == status)
    if key in VERIFIERS:
        query = query.where(Equipment.section == user.section)
    rows = db.scalars(query.order_by(DrawingDifference.reported_at.desc())).all()
    return {"differences": [difference_payload(db, item) for item in rows],
            "can_verify": key in VERIFIERS, "can_incorporate": key in DRAWING_OFFICE}


def _difference(db: Session, difference_id: str) -> DrawingDifference:
    item = db.get(DrawingDifference, difference_id)
    if not item:
        raise HTTPException(status_code=404, detail="Difference not found")
    return item


@router.post("/api/v1/drawing-differences/{difference_id}/review")
def review_difference(difference_id: str, req: DifferenceReview, user: User = Depends(current_user), db: Session = Depends(db_dep)):
    require_roles(user, *VERIFIERS)
    item = _difference(db, difference_id)
    equipment = db.get(Equipment, item.equipment_id)
    if not equipment or equipment.section != user.section:
        raise HTTPException(status_code=404, detail="Difference not found")
    if item.reported_by_id == user.id:
        raise HTTPException(status_code=409, detail="Someone else must verify a difference you reported")
    if item.status != "REPORTED":
        raise HTTPException(status_code=409, detail="This difference has already been checked")
    if req.decision not in ("VERIFIED", "REJECTED"):
        raise HTTPException(status_code=422, detail="Decision must be VERIFIED or REJECTED")
    if req.decision == "REJECTED" and len(req.note.strip()) < 5:
        raise HTTPException(status_code=422, detail="Say why it is not a difference")
    item.status, item.verified_by_id, item.verified_at, item.review_note = req.decision, user.id, utcnow(), req.note.strip()
    db.commit()
    return difference_payload(db, item)


@router.post("/api/v1/drawing-differences/{difference_id}/incorporated")
def mark_incorporated(difference_id: str, req: DifferenceIncorporated, user: User = Depends(current_user), db: Session = Depends(db_dep)):
    """The drawing office has issued a revision that shows the installation as it is."""
    require_roles(user, *DRAWING_OFFICE)
    item = _difference(db, difference_id)
    if item.status != "VERIFIED":
        raise HTTPException(status_code=409, detail="Only verified differences can be marked as drawn")
    item.status, item.incorporated_revision, item.incorporated_at = "INCORPORATED", req.revision.strip(), utcnow()
    if item.drawing_id:
        drawing = db.get(Drawing, item.drawing_id)
        if drawing:
            drawing.revision = req.revision.strip()
    db.commit()
    return difference_payload(db, item)


@router.get("/api/v1/drawings")
def drawing_register(search: str = "", user: User = Depends(current_user), db: Session = Depends(db_dep)):
    if role_key(user) in ("hr_officer", "managing_director"):
        raise HTTPException(status_code=403, detail="This role cannot view drawings")
    query = select(Drawing).order_by(Drawing.number)
    if search:
        query = query.where(Drawing.number.ilike(f"%{search}%") | Drawing.title.ilike(f"%{search}%"))
    drawings = db.scalars(query.limit(200)).all()
    tags: dict[str, list[str]] = {}
    for drawing_id, tag in db.execute(select(DrawingEquipment.drawing_id, Equipment.tag).join(Equipment, DrawingEquipment.equipment_id == Equipment.id)):
        tags.setdefault(drawing_id, []).append(tag)
    digitised = sum(item.status == "DIGITISED" for item in drawings)
    return {"drawings": [drawing_payload(item, tags.get(item.id, [])) for item in drawings],
            "digitised": digitised, "total": len(drawings),
            "note": "KPC is digitising its drawings. Each entry links to the digitised file once it is available."}


@router.post("/api/v1/drawings", status_code=201)
def register_drawing(req: DrawingCreate, user: User = Depends(current_user), db: Session = Depends(db_dep)):
    require_roles(user, "system_administrator")
    if find_drawing_id(db, req.number):
        raise HTTPException(status_code=409, detail="This drawing number is already registered")
    drawing = Drawing(id=str(uuid.uuid4()), number=req.number.strip(), title=req.title.strip(), revision=req.revision.strip(),
                      discipline=req.discipline.strip(), document_url=req.document_url or None,
                      status="DIGITISED" if req.document_url else "PAPER", created_at=utcnow())
    db.add(drawing)
    db.flush()
    for tag in req.equipment_tags:
        equipment = db.scalar(select(Equipment).where(Equipment.tag.ilike(tag.strip())))
        if not equipment:
            raise HTTPException(status_code=422, detail=f"Unknown equipment tag: {tag}")
        db.add(DrawingEquipment(drawing_id=drawing.id, equipment_id=equipment.id))
    audit_user_change(db, user.id, "DRAWING_REGISTERED", user, {"number": drawing.number})
    db.commit()
    return drawing_payload(drawing, req.equipment_tags)


@router.patch("/api/v1/drawings/{drawing_id}")
def update_drawing(drawing_id: str, req: DrawingUpdate, user: User = Depends(current_user), db: Session = Depends(db_dep)):
    """Link the digitised file when it is ready (by hand now; KPC's document system later)."""
    require_roles(user, "system_administrator")
    drawing = db.get(Drawing, drawing_id)
    if not drawing:
        raise HTTPException(status_code=404, detail="Drawing not found")
    if req.revision is not None:
        drawing.revision = req.revision.strip()
    if req.document_url is not None:
        drawing.document_url = req.document_url.strip() or None
        drawing.status = "DIGITISED" if drawing.document_url else "PAPER"
    db.commit()
    return drawing_payload(drawing)
