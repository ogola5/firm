from __future__ import annotations

from fastapi import Depends
from fastapi import File
from fastapi import HTTPException
from fastapi import Query
from fastapi import UploadFile
from fastapi.responses import FileResponse
from pathlib import Path
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session
import uuid
from fastapi import APIRouter

from app.core.config import settings
from app.db import db_dep
from app.deps import current_user
from app.models import Fault, FaultAssignment, FaultAttachment, User
from app.services.access import INVESTIGATION_ROLES, TECHNICAL_ROLES, current_assignment, require_current_assignment, require_fault_scope, require_roles, role_key
from app.services.audit import add_event
from app.services.storage import attachment_storage

router = APIRouter()

@router.post("/api/v1/faults/{fault_id}/attachments")
async def upload_fault_attachment(
    fault_id: str,
    file: UploadFile = File(...),
    assignment_id: str | None = Query(default=None),
    user: User = Depends(current_user),
    db: Session = Depends(db_dep),
):
    require_roles(user, "operations", *INVESTIGATION_ROLES, "maintenance_manager", "general_manager_om", "supervisor", "system_administrator")
    fault = db.get(Fault, fault_id)
    if not fault:
        raise HTTPException(status_code=404, detail="Fault not found")
    require_fault_scope(user, fault)
    if fault.status == "CLOSED":
        raise HTTPException(status_code=409, detail="Evidence cannot be added to a closed breakdown")

    active_assignment = current_assignment(fault)
    attachment_assignment_id = assignment_id
    if role_key(user) in TECHNICAL_ROLES:
        if not active_assignment:
            raise HTTPException(status_code=409, detail="There is no active section assignment for this breakdown")
        require_current_assignment(user, fault)
        if assignment_id and assignment_id != active_assignment.id:
            raise HTTPException(status_code=422, detail="Evidence must be attached to the active section assignment")
        attachment_assignment_id = active_assignment.id
    elif assignment_id:
        target_assignment = db.get(FaultAssignment, assignment_id)
        if not target_assignment or target_assignment.fault_id != fault.id:
            raise HTTPException(status_code=404, detail="Section assignment not found")

    extension = Path(file.filename or "").suffix.lower()
    media_type = settings.allowed_attachment_types.get(extension)
    if not media_type:
        raise HTTPException(status_code=415, detail="Upload a PNG, JPEG, WebP, PDF, CSV, TXT, JSON or LOG file")
    supplied_type = (file.content_type or "").lower()
    accepted_types = {media_type}
    if extension == ".csv":
        accepted_types.add("text/plain")
    if supplied_type and supplied_type not in accepted_types and supplied_type != "application/octet-stream":
        raise HTTPException(status_code=415, detail="The uploaded file type does not match its extension")
    content = await file.read(settings.max_attachment_bytes + 1)
    if not content:
        raise HTTPException(status_code=422, detail="The uploaded file is empty")
    if len(content) > settings.max_attachment_bytes:
        raise HTTPException(status_code=413, detail="Each attachment must be 10 MiB or smaller")

    attachment_id = str(uuid.uuid4())
    storage_key = f"{uuid.uuid4().hex}{extension}"
    attachment_storage.save(storage_key, content)
    original_filename = (file.filename or "evidence").replace("\\", "/").rsplit("/", 1)[-1]
    original_filename = "".join(character for character in original_filename if character >= " " and character != "\x7f")[:255]
    if not original_filename:
        original_filename = f"evidence{extension}"
    attachment = FaultAttachment(
        id=attachment_id,
        fault_id=fault.id,
        assignment_id=attachment_assignment_id,
        uploader_id=user.id,
        original_filename=original_filename,
        storage_key=storage_key,
        content_type=media_type,
        size_bytes=len(content),
    )
    db.add(attachment)
    add_event(db, fault.id, "EVIDENCE_ATTACHED", user.id, {
        "attachment_id": attachment.id,
        "assignment_id": attachment.assignment_id,
        "filename": attachment.original_filename,
        "size_bytes": attachment.size_bytes,
    })
    try:
        db.commit()
    except SQLAlchemyError:
        db.rollback()
        attachment_storage.delete(storage_key)
        raise
    return {
        "id": attachment.id,
        "fault_id": attachment.fault_id,
        "assignment_id": attachment.assignment_id,
        "filename": attachment.original_filename,
        "content_type": attachment.content_type,
        "size_bytes": attachment.size_bytes,
    }


@router.get("/api/v1/faults/{fault_id}/attachments/{attachment_id}")
def download_fault_attachment(
    fault_id: str,
    attachment_id: str,
    user: User = Depends(current_user),
    db: Session = Depends(db_dep),
):
    fault = db.get(Fault, fault_id)
    if not fault:
        raise HTTPException(status_code=404, detail="Fault not found")
    require_fault_scope(user, fault)
    attachment = db.get(FaultAttachment, attachment_id)
    if not attachment or attachment.fault_id != fault.id:
        raise HTTPException(status_code=404, detail="Attachment not found")
    storage_path = attachment_storage.local_path(attachment.storage_key)
    if storage_path is None:
        raise HTTPException(status_code=404, detail="Attachment file is unavailable")
    return FileResponse(storage_path, media_type=attachment.content_type, filename=attachment.original_filename)
