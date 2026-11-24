from __future__ import annotations

from fastapi import Depends, Header, HTTPException
from jose import JWTError, jwt
from sqlalchemy.orm import Session

from app.core.config import settings
from app.db import db_dep
from app.models import User


def current_user(authorization: str = Header(default=""), db: Session = Depends(db_dep)) -> User:
    if not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing demo session")
    token = authorization[7:]
    try:
        payload = jwt.decode(token, settings.jwt_secret, algorithms=["HS256"])
    except JWTError as exc:
        raise HTTPException(status_code=401, detail="Invalid demo session") from exc
    user = db.get(User, payload.get("sub"))
    if not user or not user.active:
        raise HTTPException(status_code=401, detail="Inactive or invalid demo session")
    return user
