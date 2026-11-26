"""The bell: a person's own notifications (never anyone else's)."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import update
from sqlalchemy.orm import Session

from app.db import db_dep
from app.deps import current_user
from app.models import Notification, User, utcnow
from app.services import notifications

router = APIRouter()


@router.get("/api/v1/notifications")
def my_notifications(limit: int = 50, user: User = Depends(current_user), db: Session = Depends(db_dep)):
    return notifications.listing(db, user, max(1, min(limit, 200)))


@router.post("/api/v1/notifications/{notification_id}/read")
def mark_read(notification_id: str, user: User = Depends(current_user), db: Session = Depends(db_dep)):
    item = db.get(Notification, notification_id)
    if not item or item.user_id != user.id:
        raise HTTPException(status_code=404, detail="Notification not found")
    if item.read_at is None:
        item.read_at = utcnow()
        db.commit()
    return notifications.payload(item)


@router.post("/api/v1/notifications/read-all")
def mark_all_read(user: User = Depends(current_user), db: Session = Depends(db_dep)):
    db.execute(update(Notification).where(Notification.user_id == user.id, Notification.read_at.is_(None)).values(read_at=utcnow()))
    db.commit()
    return {"unread": 0}
