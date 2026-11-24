from __future__ import annotations

from datetime import datetime
from datetime import timedelta
from datetime import timezone
from fastapi import Depends
from fastapi import HTTPException
from jose import jwt
from sqlalchemy import select
from sqlalchemy.orm import Session
import bcrypt
from fastapi import APIRouter

from app.core.config import settings
from app.db import db_dep
from app.deps import current_user
from app.models import User
from app.schemas import LoginRequest
from app.services.access import role_definition, user_payload

router = APIRouter()

@router.post("/api/v1/auth/login")
def login(req: LoginRequest, db: Session = Depends(db_dep)):
    user = db.scalar(select(User).where(User.username == req.username))
    if not user or not user.active or not bcrypt.checkpw(req.password.encode(), user.password_hash.encode()):
        raise HTTPException(status_code=401, detail="Invalid username or password")
    token = jwt.encode({"sub": user.id, "exp": datetime.now(timezone.utc) + timedelta(hours=12)}, settings.jwt_secret, algorithm="HS256")
    return {"access_token": token, "token_type": "Bearer", "user": user_payload(user)}


@router.get("/api/v1/auth/demo-accounts")
def demo_accounts(db: Session = Depends(db_dep)):
    users = db.scalars(select(User).where(User.username.like("%"), User.id.like("USER-%")).order_by(User.role, User.section, User.username)).all()
    return [{"username": user.username, "role_label": role_definition(user)["label"], "section": user.section} for user in users if user.active]


@router.get("/api/v1/auth/me")
def me(user: User = Depends(current_user)):
    return user_payload(user)
