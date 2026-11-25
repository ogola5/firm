from __future__ import annotations

from fastapi import Depends, Header, HTTPException
from jose import JWTError, jwt
from sqlalchemy.orm import Session

from app.core.config import settings
from app.db import db_dep
from app.models import User
from app.services.accounts import ACTIVE, password_version


def current_user(authorization: str = Header(default=""), db: Session = Depends(db_dep)) -> User:
    if not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing demo session")
    token = authorization[7:]
    try:
        payload = jwt.decode(token, settings.jwt_secret, algorithms=["HS256"])
    except JWTError as exc:
        raise HTTPException(status_code=401, detail="Invalid demo session") from exc
    user = db.get(User, payload.get("sub"))
    if not user or not user.active or user.account_status != ACTIVE:
        raise HTTPException(status_code=401, detail="Inactive or invalid demo session")
    # A password change ends every session started with the old password.
    if payload.get("pv", 0) != password_version(user):
        raise HTTPException(status_code=401, detail="Your password was changed. Sign in again.")
    return user
