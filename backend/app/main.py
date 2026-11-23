from __future__ import annotations

import os
import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional

import bcrypt
from fastapi import Depends, FastAPI, Header, HTTPException, Query, status
from fastapi.middleware.cors import CORSMiddleware
from jose import JWTError, jwt
from pydantic import BaseModel
from sqlalchemy import Column, DateTime, Float, ForeignKey, Integer, String, Text, create_engine, select
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column, relationship, sessionmaker

DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./kpc.db")
SECRET = os.getenv("DEMO_JWT_SECRET", "synthetic-demo-only-change-in-production")
engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {})
SessionLocal = sessionmaker(bind=engine, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class User(Base):
    __tablename__ = "users"
    id: Mapped[str] = mapped_column(String, primary_key=True)
    username: Mapped[str] = mapped_column(String, unique=True)
    display_name: Mapped[str] = mapped_column(String)
    role: Mapped[str] = mapped_column(String)
    section: Mapped[str] = mapped_column(String, default="")
    password_hash: Mapped[str] = mapped_column(String)
    active: Mapped[int] = mapped_column(Integer, default=1)


class Equipment(Base):
    __tablename__ = "equipment"
    id: Mapped[str] = mapped_column(String, primary_key=True)
    tag: Mapped[str] = mapped_column(String, unique=True)
    name: Mapped[str] = mapped_column(String)
    category: Mapped[str] = mapped_column(String)
    station: Mapped[str] = mapped_column(String)
    location: Mapped[str] = mapped_column(String)
    section: Mapped[str] = mapped_column(String)
    criticality: Mapped[str] = mapped_column(String)
    operational_status: Mapped[str] = mapped_column(String, default="Operational")
    manufacturer: Mapped[str] = mapped_column(String, default="Illustrative OEM")
    model: Mapped[str] = mapped_column(String, default="Demo Model")
    description: Mapped[str] = mapped_column(Text, default="")


class Fault(Base):
    __tablename__ = "faults"
    id: Mapped[str] = mapped_column(String, primary_key=True)
    reference: Mapped[str] = mapped_column(String, unique=True)
    equipment_id: Mapped[str] = mapped_column(ForeignKey("equipment.id"))
    reporter_id: Mapped[str] = mapped_column(ForeignKey("users.id"))
    category: Mapped[str] = mapped_column(String)
    symptom: Mapped[str] = mapped_column(String)
    severity: Mapped[str] = mapped_column(String)
    description: Mapped[str] = mapped_column(Text)
    operational_impact: Mapped[str] = mapped_column(String, default="")
    status: Mapped[str] = mapped_column(String, default="REPORTED")
    assigned_section: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    acknowledged_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    restored_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    equipment = relationship("Equipment")
    reporter = relationship("User")


class FaultEvent(Base):
    __tablename__ = "fault_events"
    id: Mapped[str] = mapped_column(String, primary_key=True)
    fault_id: Mapped[str] = mapped_column(ForeignKey("faults.id"))
    event_type: Mapped[str] = mapped_column(String)
    actor_id: Mapped[str] = mapped_column(String)
    payload: Mapped[str] = mapped_column(Text, default="{}")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class KnowledgeEntry(Base):
    __tablename__ = "knowledge_entries"
    id: Mapped[str] = mapped_column(String, primary_key=True)
    reference: Mapped[str] = mapped_column(String, unique=True)
    equipment_id: Mapped[Optional[str]] = mapped_column(ForeignKey("equipment.id"), nullable=True)
    title: Mapped[str] = mapped_column(String)
    symptom: Mapped[str] = mapped_column(String)
    confirmed_cause: Mapped[str] = mapped_column(Text)
    diagnostic_procedure: Mapped[str] = mapped_column(Text)
    corrective_action: Mapped[str] = mapped_column(Text)
    safety: Mapped[str] = mapped_column(Text, default="")
    status: Mapped[str] = mapped_column(String, default="DRAFT")
    author_id: Mapped[str] = mapped_column(String)
    version: Mapped[int] = mapped_column(Integer, default=1)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class SyncEvent(Base):
    __tablename__ = "sync_events"
    event_id: Mapped[str] = mapped_column(String, primary_key=True)
    fault_id: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    event_type: Mapped[str] = mapped_column(String)
    actor_id: Mapped[str] = mapped_column(String)
    payload: Mapped[str] = mapped_column(Text)
    client_timestamp: Mapped[str] = mapped_column(String)
    received_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


Base.metadata.create_all(engine)


class LoginRequest(BaseModel):
    username: str
    password: str


class FaultCreate(BaseModel):
    equipment_id: str
    category: str
    symptom: str
    severity: str = "Medium"
    description: str = ""
    operational_impact: str = ""
    event_id: str | None = None


class KnowledgeCreate(BaseModel):
    equipment_id: str | None = None
    title: str
    symptom: str
    confirmed_cause: str
    diagnostic_procedure: str
    corrective_action: str
    safety: str = ""


class TriageRequest(BaseModel):
    assigned_section: str
    triage_comment: str = ""


app = FastAPI(title="KPC Maintenance Prototype", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def db_dep():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def current_user(authorization: str = Header(default=""), db: Session = Depends(db_dep)):
    if not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing demo session")
    token = authorization[7:]
    try:
        payload = jwt.decode(token, SECRET, algorithms=["HS256"])
        user = db.get(User, payload["sub"])
        if not user or not user.active:
            raise HTTPException(status_code=401, detail="Inactive or invalid demo session")
        return user
    except JWTError as exc:
        raise HTTPException(status_code=401, detail="Invalid demo session") from exc


def add_event(db: Session, fault_id: str, event_type: str, actor_id: str, payload: dict):
    import json
    db.add(FaultEvent(id=str(uuid.uuid4()), fault_id=fault_id, event_type=event_type, actor_id=actor_id, payload=json.dumps(payload)))


@app.on_event("startup")
def seed_database():
    db = SessionLocal()
    if db.query(User).count() == 0:
        roles = [
            ("operations", "Operations"),
            ("automation", "Systems Automation"),
            ("electrical", "Electrical"),
            ("instrumentation", "Instrumentation"),
            ("mechanical", "Mechanical"),
            ("supervisor", "Supervisor"),
            ("management", "Management"),
            ("admin", "System Administrator"),
        ]
        for username, role in roles:
            db.add(User(
                id=f"USER-{username}",
                username=username,
                display_name=f"Demo {role} User",
                role=role,
                section=role if role in ("Electrical", "Instrumentation", "Mechanical") else "",
                password_hash=bcrypt.hashpw(b"demo123", bcrypt.gensalt()).decode(),
            ))

        stations = ["PS01", "PS02", "DEPOT01"]
        tags = ["10A-MOV-201", "PUMP-101", "VFD-101", "PLC-101", "RTU-201", "LT-301", "TX-201"]
        categories = ["Automation", "Mechanical", "Electrical", "Instrumentation"]
        sections = ["Systems Automation", "Mechanical", "Electrical", "Instrumentation"]
        for i in range(30):
            tag = tags[i] if i < len(tags) else f"DEMO-{i + 1:03d}"
            category = categories[i % len(categories)]
            db.add(Equipment(
                id=f"EQ-{i + 1:03d}",
                tag=tag,
                name=f"Synthetic {category} asset {i + 1}",
                category=category,
                station=stations[i % len(stations)],
                location=f"Area {chr(65 + i % 5)}-{i % 10 + 1}",
                section=sections[i % len(sections)],
                criticality=["Low", "Medium", "High", "Critical"][i % 4],
                description="Illustrative demonstration asset; not a real KPC operational record.",
            ))
        db.commit()

        first_equipment = db.query(Equipment).all()[0]
        for i in range(105):
            equipment = db.query(Equipment).filter(Equipment.id == f"EQ-{(i % 30) + 1:03d}").one()
            status_name = ["REPORTED", "TRIAGED", "ASSIGNED", "ACKNOWLEDGED", "ON_SITE", "DIAGNOSED", "RESTORED", "CLOSED"][i % 8]
            date = utcnow() - timedelta(days=i % 180)
            fault = Fault(
                id=f"FAULT-{i + 1:05d}",
                reference=f"KPC-DMO-{i + 1:05d}",
                equipment_id=equipment.id,
                reporter_id="USER-operations",
                category=equipment.category,
                symptom=["Intermittent alarm", "Unexpected trip", "Unstable reading", "Failure to start"][i % 4],
                severity=["Low", "Medium", "High", "Critical"][i % 4],
                description="Synthetic demonstration fault record.",
                status=status_name,
                assigned_section=equipment.section,
                created_at=date,
                acknowledged_at=date + timedelta(minutes=35) if i % 3 else None,
                restored_at=date + timedelta(hours=4) if status_name in ("RESTORED", "CLOSED") else None,
            )
            db.add(fault)
            add_event(db, fault.id, "FAULT_REPORTED", "USER-operations", {"severity": fault.severity})
        db.commit()

        for i in range(30):
            equipment = db.query(Equipment).filter(Equipment.id == f"EQ-{(i % 30) + 1:03d}").one()
            db.add(KnowledgeEntry(
                id=f"KNOW-{i + 1:04d}",
                reference=f"KN-DMO-{i + 1:04d}",
                equipment_id=equipment.id,
                title=f"Synthetic diagnostic procedure {i + 1}",
                symptom=["Intermittent alarm", "Unexpected trip", "Unstable reading", "Failure to start"][i % 4],
                confirmed_cause=["Loose terminal", "Sensor drift", "Blocked filter", "Incorrect parameter"][i % 4],
                diagnostic_procedure="Isolate the equipment under approved procedure, inspect relevant indicators and record test results.",
                corrective_action="Restore connections or replace the affected approved component.",
                safety="Follow applicable work permits, isolation and lockout procedures.",
                status="APPROVED" if i < 24 else ("SUBMITTED" if i < 28 else "REJECTED"),
                author_id="USER-electrical" if i % 2 else "USER-instrumentation",
                version=1,
            ))
        db.commit()
    db.close()


seed_database()


@app.post("/api/v1/auth/login")
def login(req: LoginRequest, db: Session = Depends(db_dep)):
    user = db.scalar(select(User).where(User.username == req.username))
    if not user or not bcrypt.checkpw(req.password.encode(), user.password_hash.encode()):
        raise HTTPException(status_code=401, detail="Invalid username or password")
    token = jwt.encode({"sub": user.id, "exp": datetime.now(timezone.utc) + timedelta(hours=12)}, SECRET, algorithm="HS256")
    return {"access_token": token, "token_type": "Bearer", "user": {"id": user.id, "username": user.username, "display_name": user.display_name, "role": user.role, "section": user.section}}


@app.get("/api/v1/auth/me")
def me(user: User = Depends(current_user)):
    return {"id": user.id, "username": user.username, "display_name": user.display_name, "role": user.role, "section": user.section}


@app.get("/api/v1/equipment")
def equipment_list(search: str = "", station: str = "", db: Session = Depends(db_dep)):
    query = select(Equipment)
    if search:
        needle = search.lower()
        query = query.where((Equipment.tag.ilike(f"%{needle}%")) | (Equipment.name.ilike(f"%{needle}%")))
    if station:
        query = query.where(Equipment.station == station)
    return [{"id": e.id, "tag": e.tag, "name": e.name, "category": e.category, "station": e.station, "location": e.location, "section": e.section, "criticality": e.criticality, "operational_status": e.operational_status} for e in db.scalars(query)]


@app.get("/api/v1/equipment/{equipment_id}")
def equipment_detail(equipment_id: str, db: Session = Depends(db_dep)):
    item = db.get(Equipment, equipment_id)
    if not item:
        raise HTTPException(status_code=404, detail="Equipment not found")
    return {"id": item.id, "tag": item.tag, "name": item.name, "category": item.category, "station": item.station, "location": item.location, "section": item.section, "criticality": item.criticality, "operational_status": item.operational_status, "manufacturer": item.manufacturer, "model": item.model, "description": item.description}


@app.get("/api/v1/equipment/{equipment_id}/history")
def equipment_history(equipment_id: str, db: Session = Depends(db_dep)):
    faults = db.scalars(select(Fault).where(Fault.equipment_id == equipment_id).order_by(Fault.created_at.desc())).all()
    return [{"id": f.id, "reference": f.reference, "symptom": f.symptom, "severity": f.severity, "status": f.status, "created_at": f.created_at.isoformat()} for f in faults]


@app.post("/api/v1/faults")
def report_fault(req: FaultCreate, user: User = Depends(current_user), db: Session = Depends(db_dep)):
    if user.role not in ("Operations", "System Administrator", "Supervisor"):
        raise HTTPException(status_code=403, detail="Only Operations may report faults")
    if not db.get(Equipment, req.equipment_id):
        raise HTTPException(status_code=404, detail="Equipment not found")
    count = db.query(Fault).count() + 1
    fault = Fault(
        id=str(uuid.uuid4()),
        reference=f"KPC-DMO-{count:05d}",
        equipment_id=req.equipment_id,
        reporter_id=user.id,
        category=req.category,
        symptom=req.symptom,
        severity=req.severity,
        description=req.description,
        operational_impact=req.operational_impact,
    )
    db.add(fault)
    db.flush()
    add_event(db, fault.id, "FAULT_REPORTED", user.id, req.model_dump())
    db.commit()
    return {"id": fault.id, "reference": fault.reference, "status": fault.status}


@app.get("/api/v1/faults")
def fault_list(status_filter: str = "", db: Session = Depends(db_dep)):
    query = select(Fault).order_by(Fault.created_at.desc())
    if status_filter:
        query = query.where(Fault.status == status_filter)
    faults = db.scalars(query.limit(200)).all()
    result = []
    for f in faults:
        result.append({"id": f.id, "reference": f.reference, "equipment_id": f.equipment_id, "equipment_tag": f.equipment.tag if f.equipment else "", "category": f.category, "symptom": f.symptom, "severity": f.severity, "status": f.status, "assigned_section": f.assigned_section, "created_at": f.created_at.isoformat()})
    return result


@app.get("/api/v1/faults/{fault_id}")
def fault_detail(fault_id: str, db: Session = Depends(db_dep)):
    f = db.get(Fault, fault_id)
    if not f:
        raise HTTPException(status_code=404, detail="Fault not found")
    return {"id": f.id, "reference": f.reference, "equipment_id": f.equipment_id, "equipment_tag": f.equipment.tag if f.equipment else "", "category": f.category, "symptom": f.symptom, "severity": f.severity, "description": f.description, "operational_impact": f.operational_impact, "status": f.status, "assigned_section": f.assigned_section, "created_at": f.created_at.isoformat()}


@app.get("/api/v1/faults/{fault_id}/timeline")
def fault_timeline(fault_id: str, db: Session = Depends(db_dep)):
    events = db.scalars(select(FaultEvent).where(FaultEvent.fault_id == fault_id).order_by(FaultEvent.created_at)).all()
    return [{"id": e.id, "event_type": e.event_type, "actor_id": e.actor_id, "payload": e.payload, "created_at": e.created_at.isoformat()} for e in events]


@app.post("/api/v1/faults/{fault_id}/triage")
def triage_fault(fault_id: str, req: TriageRequest, user: User = Depends(current_user), db: Session = Depends(db_dep)):
    f = db.get(Fault, fault_id)
    if not f:
        raise HTTPException(status_code=404, detail="Fault not found")
    f.assigned_section = req.assigned_section
    f.status = "ASSIGNED"
    add_event(db, fault_id, "FAULT_ASSIGNED", user.id, req.model_dump())
    db.commit()
    return {"reference": f.reference, "status": f.status, "assigned_section": f.assigned_section}


@app.post("/api/v1/faults/{fault_id}/action")
def fault_action(fault_id: str, action: str, user: User = Depends(current_user), db: Session = Depends(db_dep)):
    f = db.get(Fault, fault_id)
    if not f:
        raise HTTPException(status_code=404, detail="Fault not found")
    transitions = {"acknowledge": "ACKNOWLEDGED", "on_site": "ON_SITE", "diagnose": "DIAGNOSED", "restore": "RESTORED", "close": "CLOSED"}
    if action not in transitions:
        raise HTTPException(status_code=400, detail="Unknown fault action")
    f.status = transitions[action]
    if action == "acknowledge":
        f.acknowledged_at = utcnow()
    if action == "restore":
        f.restored_at = utcnow()
    add_event(db, fault_id, f"FAULT_{action.upper()}", user.id, {})
    db.commit()
    return {"reference": f.reference, "status": f.status}


@app.get("/api/v1/knowledge")
def knowledge_list(status_filter: str = "", search: str = "", db: Session = Depends(db_dep)):
    query = select(KnowledgeEntry)
    if status_filter:
        query = query.where(KnowledgeEntry.status == status_filter)
    if search:
        needle = f"%{search.lower()}%"
        query = query.where(KnowledgeEntry.title.ilike(needle) | KnowledgeEntry.symptom.ilike(needle) | KnowledgeEntry.confirmed_cause.ilike(needle))
    entries = db.scalars(query.limit(200)).all()
    return [{"id": e.id, "reference": e.reference, "equipment_id": e.equipment_id, "title": e.title, "symptom": e.symptom, "confirmed_cause": e.confirmed_cause, "corrective_action": e.corrective_action, "status": e.status, "version": e.version} for e in entries]


@app.post("/api/v1/knowledge")
def create_knowledge(req: KnowledgeCreate, user: User = Depends(current_user), db: Session = Depends(db_dep)):
    count = db.query(KnowledgeEntry).count() + 1
    entry = KnowledgeEntry(id=str(uuid.uuid4()), reference=f"KN-DMO-{count:04d}", equipment_id=req.equipment_id, title=req.title, symptom=req.symptom, confirmed_cause=req.confirmed_cause, diagnostic_procedure=req.diagnostic_procedure, corrective_action=req.corrective_action, safety=req.safety, status="DRAFT", author_id=user.id)
    db.add(entry)
    db.commit()
    return {"id": entry.id, "reference": entry.reference, "status": entry.status}


@app.post("/api/v1/knowledge/{knowledge_id}/status")
def knowledge_status(knowledge_id: str, target_status: str, user: User = Depends(current_user), db: Session = Depends(db_dep)):
    if user.role not in ("Supervisor", "System Administrator"):
        raise HTTPException(status_code=403, detail="Supervisor approval is required")
    entry = db.get(KnowledgeEntry, knowledge_id)
    if not entry:
        raise HTTPException(status_code=404, detail="Knowledge entry not found")
    if target_status not in ("SUBMITTED", "APPROVED", "REJECTED", "SUPERSEDED"):
        raise HTTPException(status_code=400, detail="Invalid knowledge status")
    entry.status = target_status
    entry.updated_at = utcnow()
    db.commit()
    return {"id": entry.id, "status": entry.status, "version": entry.version}


@app.get("/api/v1/intelligence/equipment/{equipment_id}")
def recurring_intelligence(equipment_id: str, db: Session = Depends(db_dep)):
    faults = db.scalars(select(Fault).where(Fault.equipment_id == equipment_id).order_by(Fault.created_at.desc())).all()
    recent = [f for f in faults if f.created_at.replace(tzinfo=timezone.utc) >= utcnow() - timedelta(days=90)]
    return {
        "repeat_count": len(recent),
        "seen_label": f"Seen {len(recent)} times in the last 90 days",
        "previous_occurrences": [{"reference": f.reference, "symptom": f.symptom, "category": f.category, "status": f.status, "date": f.created_at.isoformat()} for f in recent[:10]],
        "suggested_section": faults[0].equipment.section if faults else "Systems Automation",
        "ranking_note": "Deterministic history-based indication; not a confirmed root cause.",
    }


@app.get("/api/v1/analytics/overview")
def analytics(db: Session = Depends(db_dep)):
    faults = db.scalars(select(Fault)).all()
    categories = {}
    stations = {}
    sections = {}
    for f in faults:
        categories[f.category] = categories.get(f.category, 0) + 1
        sections[f.assigned_section or "Unassigned"] = sections.get(f.assigned_section or "Unassigned", 0) + 1
        if f.equipment:
            stations[f.equipment.station] = stations.get(f.equipment.station, 0) + 1
    open_count = sum(f.status not in ("RESTORED", "CLOSED") for f in faults)
    resolved_count = sum(f.status in ("RESTORED", "CLOSED") for f in faults)
    restore_times = [(f.restored_at - f.created_at).total_seconds() / 3600 for f in faults if f.restored_at]
    acknowledge_times = [(f.acknowledged_at - f.created_at).total_seconds() / 60 for f in faults if f.acknowledged_at]
    return {
        "total_faults": len(faults),
        "open_faults": open_count,
        "resolved_faults": resolved_count,
        "by_category": categories,
        "by_station": stations,
        "by_section": sections,
        "mean_time_acknowledge_minutes": round(sum(acknowledge_times) / len(acknowledge_times), 1) if acknowledge_times else None,
        "mean_time_restore_hours": round(sum(restore_times) / len(restore_times), 1) if restore_times else None,
        "knowledge_entries": db.query(KnowledgeEntry).count(),
        "approved_knowledge": db.query(KnowledgeEntry).filter(KnowledgeEntry.status == "APPROVED").count(),
        "data_type": "Illustrative synthetic demonstration statistics",
    }


@app.post("/api/v1/sync/events")
def sync_events(events: list[dict], db: Session = Depends(db_dep)):
    accepted = []
    duplicates = []
    for event in events:
        event_id = str(event.get("event_id", uuid.uuid4()))
        if db.get(SyncEvent, event_id):
            duplicates.append(event_id)
            continue
        db.add(SyncEvent(
            event_id=event_id,
            fault_id=event.get("fault_id"),
            event_type=str(event.get("event_type", "UNKNOWN")),
            actor_id=str(event.get("actor_id", "offline-user")),
            payload=str(event.get("payload", {})),
            client_timestamp=str(event.get("client_timestamp", utcnow().isoformat())),
        ))
        accepted.append(event_id)
    db.commit()
    return {"accepted": accepted, "duplicates": duplicates}


@app.get("/api/v1/sync/status")
def sync_status(db: Session = Depends(db_dep)):
    count = db.query(SyncEvent).count()
    return {"received_events": count, "authoritative": True, "conflicts": 0}
