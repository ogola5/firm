from __future__ import annotations

from datetime import timedelta
from sqlalchemy import select
import bcrypt
import uuid

from app.db import SessionLocal
from app.models import Diagnosis, Equipment, Fault, FaultAssignment, FaultEvent, Intervention, KnowledgeEntry, KnowledgeReuse, KnowledgeReuseOutcome, ProcedureReview, ProcedureUpdate, User, utcnow
from app.services.access import ROLE_DEFINITIONS, SECTIONS
from app.services.audit import add_event


def seed_database():
    """Load the illustrative demonstration dataset into an empty database.

    Safe to call repeatedly: data is only created when no users exist.
    """
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
            state_rank = {
                "REPORTED": 0, "TRIAGED": 1, "ASSIGNED": 2, "ACKNOWLEDGED": 3,
                "ON_SITE": 4, "DIAGNOSED": 5, "RESTORED": 6, "CLOSED": 7,
            }[status_name]
            section_slug = equipment.section.lower().replace(" ", "-")
            add_event(db, fault.id, "FAULT_REPORTED", "USER-operations", {"severity": fault.severity}, date)
            if state_rank >= 1:
                add_event(db, fault.id, "FAULT_TRIAGED", "USER-automation", {}, date + timedelta(minutes=10))
            if state_rank >= 2:
                add_event(db, fault.id, "FAULT_ASSIGNED", "USER-automation", {
                    "assigned_section": equipment.section,
                    "suggested_section": equipment.section,
                    "repeat_routed_to_owner": i >= 30,
                }, date + timedelta(minutes=20))
            if state_rank >= 3:
                add_event(db, fault.id, "FAULT_ACKNOWLEDGE", f"USER-st-{section_slug}", {}, date + timedelta(minutes=35))
            if state_rank >= 4:
                add_event(db, fault.id, "FAULT_ON_SITE", f"USER-st-{section_slug}", {}, date + timedelta(hours=1))
            if state_rank >= 5:
                add_event(db, fault.id, "FAULT_DIAGNOSE", f"USER-pt-{section_slug}", {}, date + timedelta(hours=2))
            if state_rank >= 6:
                add_event(db, fault.id, "FAULT_RESTORE", f"USER-pt-{section_slug}", {}, date + timedelta(hours=4))
            if state_rank >= 7:
                add_event(db, fault.id, "FAULT_CLOSE", f"USER-ct-{section_slug}", {}, date + timedelta(hours=5))
        db.commit()

        for i in range(30):
            equipment = db.query(Equipment).filter(Equipment.id == f"EQ-{(i % 30) + 1:03d}").one()
            db.add(KnowledgeEntry(
                id=f"KNOW-{i + 1:04d}",
                reference=f"KN-DMO-{i + 1:04d}",
                equipment_id=equipment.id if i < 24 else None,
                title=f"Synthetic diagnostic procedure {i + 1}",
                symptom=["Intermittent alarm", "Unexpected trip", "Unstable reading", "Failure to start"][i % 4],
                confirmed_cause=["Loose terminal", "Sensor drift", "Blocked filter", "Incorrect parameter"][i % 4],
                diagnostic_procedure="Isolate the equipment under approved procedure, inspect relevant indicators and record test results.",
                corrective_action="Restore connections or replace the affected approved component.",
                safety="Follow applicable work permits, isolation and lockout procedures.",
                status="APPROVED" if i < 24 else ("SUBMITTED" if i < 28 else "REJECTED"),
                author_id="USER-electrical" if i % 2 else "USER-instrumentation",
                version=1,
                source_type="LEGACY_PROCEDURE" if i < 24 else "FAULT_DERIVED",
                instruction_type="Legacy operating work instruction" if i < 24 else "Fault-derived work procedure",
                usage_scope=f"{equipment.tag} and approved equivalent equipment" if i < 24 else "",
                legacy_reference=f"LEGACY-REF-{i + 1:03d}" if i < 24 else "",
                step_by_step="\n".join([
                    "1. Verify the applicable work permit and isolate the equipment or tool.",
                    "2. Inspect the external indicators and compare them with the approved normal setting.",
                    "3. Follow the fault-specific test sequence and record each result.",
                    "4. Apply the approved corrective action without bypassing interlocks.",
                    "5. Return the equipment to service and verify stable operation.",
                ]) if i < 24 else "",
                review_status="LEGACY_APPROVED" if i < 24 else "DIGITAL_REVIEW",
            ))
        db.commit()

    legacy_accounts = {
        "operations": ("operations", "Operations"),
        "automation": ("systems_automation", "Systems Automation"),
        "electrical": ("technician_st", "Electrical"),
        "instrumentation": ("technician_st", "Instrumentation"),
        "mechanical": ("technician_st", "Mechanical"),
        "supervisor": ("supervisor", ""),
        "management": ("general_manager_om", ""),
        "admin": ("system_administrator", ""),
    }
    for username, (role, section) in legacy_accounts.items():
        existing = db.scalar(select(User).where(User.username == username))
        if existing:
            existing.role = role
            existing.section = section

    demo_accounts = [
        ("hr", "hr_officer", ""),
        ("gm-om", "general_manager_om", ""),
        ("ceo", "managing_director", ""),
        ("maintenance-manager", "maintenance_manager", ""),
    ]
    for section in SECTIONS:
        section_slug = section.lower().replace(" ", "-")
        for short, role in (
            ("st", "technician_st"),
            ("pt", "technician_pt"),
            ("ct", "technician_ct"),
            ("assistant-engineer", "assistant_engineer"),
            ("engineer", "engineer"),
            ("senior-engineer", "senior_engineer"),
            ("chief-engineer", "chief_engineer"),
        ):
            demo_accounts.append((f"{short}-{section_slug}", role, section))

    for username, role, section in demo_accounts:
        if not db.scalar(select(User).where(User.username == username)):
            db.add(User(
                id=f"USER-{username}",
                username=username,
                display_name=f"Demo {ROLE_DEFINITIONS[role]['label']} ({section})" if section else f"Demo {ROLE_DEFINITIONS[role]['label']}",
                role=role,
                section=section,
                password_hash=bcrypt.hashpw(b"demo123", bcrypt.gensalt()).decode(),
            ))
    for section in SECTIONS:
        section_slug = section.lower().replace(" ", "-")
        placeholder_id = f"EQ-UNCONFIRMED-{section_slug}"
        if not db.get(Equipment, placeholder_id):
            db.add(Equipment(
                id=placeholder_id,
                tag=f"UNCONFIRMED-{section_slug.upper()}",
                name="Asset not yet identified",
                category="Unconfirmed",
                station="Unknown",
                location="Unknown",
                section=section,
                criticality="Unknown",
                description="Routing placeholder only; this is not an identified physical asset.",
            ))
    db.commit()

    for fault in db.scalars(select(Fault).where(Fault.id.like("FAULT-%"))).all():
        has_workflow_history = db.scalar(
            select(FaultEvent.id)
            .where(FaultEvent.fault_id == fault.id, FaultEvent.event_type != "FAULT_REPORTED")
            .limit(1)
        )
        if has_workflow_history:
            continue
        rank_by_status = {
            "REPORTED": 0, "TRIAGED": 1, "ASSIGNED": 2, "ACKNOWLEDGED": 3,
            "ON_SITE": 4, "DIAGNOSED": 5, "RESTORED": 6, "CLOSED": 7,
        }
        rank = rank_by_status.get(fault.status, 0)
        section_slug = fault.equipment.section.lower().replace(" ", "-")
        repeat_count = db.query(Fault).filter(
            Fault.equipment_id == fault.equipment_id,
            Fault.id != fault.id,
            Fault.created_at < fault.created_at,
        ).count()
        if rank >= 1:
            add_event(db, fault.id, "FAULT_TRIAGED", "USER-automation", {}, fault.created_at + timedelta(minutes=10))
        if rank >= 2:
            add_event(db, fault.id, "FAULT_ASSIGNED", "USER-automation", {
                "assigned_section": fault.assigned_section or fault.equipment.section,
                "suggested_section": fault.equipment.section,
                "repeat_count": repeat_count,
                "repeat_routed_to_owner": bool(repeat_count and fault.assigned_section == fault.equipment.section),
            }, fault.created_at + timedelta(minutes=20))
        if rank >= 3:
            add_event(db, fault.id, "FAULT_ACKNOWLEDGE", f"USER-st-{section_slug}", {}, fault.created_at + timedelta(minutes=35))
        if rank >= 4:
            add_event(db, fault.id, "FAULT_ON_SITE", f"USER-st-{section_slug}", {}, fault.created_at + timedelta(hours=1))
        if rank >= 5:
            add_event(db, fault.id, "FAULT_DIAGNOSE", f"USER-pt-{section_slug}", {}, fault.created_at + timedelta(hours=2))
        if rank >= 6:
            add_event(db, fault.id, "FAULT_RESTORE", f"USER-pt-{section_slug}", {}, fault.created_at + timedelta(hours=4))
        if rank >= 7:
            add_event(db, fault.id, "FAULT_CLOSE", f"USER-ct-{section_slug}", {}, fault.created_at + timedelta(hours=5))
    db.commit()

    if db.query(ProcedureUpdate).count() == 0:
        resolved_faults = db.scalars(
            select(Fault)
            .where(Fault.status.in_(("RESTORED", "CLOSED")))
            .order_by(Fault.created_at.desc())
            .limit(18)
        ).all()
        causes = ["Loose terminal connection", "Sensor drift", "Blocked filter", "Incorrect controller parameter"]
        authors = ("pt", "senior-engineer", "engineer", "assistant-engineer")
        for index, fault in enumerate(resolved_faults):
            section_slug = fault.equipment.section.lower().replace(" ", "-")
            author_id = f"USER-{authors[index % len(authors)]}-{section_slug}"
            cause = causes[index % len(causes)]
            diagnosis = Diagnosis(
                id=f"DIAG-DEMO-{index + 1:04d}",
                fault_id=fault.id,
                author_id=author_id,
                possible_cause=cause,
                diagnostic_method="Compare the alarm history with safe-to-check field indications and record the measured values.",
                observations="Synthetic observation recorded during the demonstration investigation.",
                test_results="Illustrative test result; verify against site procedures before use.",
                confidence=0.8,
                verification_status="CONFIRMED",
                created_at=fault.created_at + timedelta(hours=2),
            )
            db.add(diagnosis)
            # These models declare foreign keys without ORM relationships, so the
            # unit of work cannot order inserts; flush parents before children.
            db.flush()
            if index % 4 == 0:
                db.add(Intervention(
                    id=f"INT-DEMO-FAILED-{index + 1:04d}",
                    fault_id=fault.id,
                    diagnosis_id=diagnosis.id,
                    actor_id=author_id,
                    corrective_action="Initial adjustment did not resolve the reported symptom.",
                    tools_materials="Approved test equipment",
                    outcome="FAILED",
                    notes="Failed attempt retained in the history to prevent repeating an ineffective workaround.",
                    created_at=fault.created_at + timedelta(hours=2, minutes=20),
                ))
            db.add(Intervention(
                id=f"INT-DEMO-SUCCESS-{index + 1:04d}",
                fault_id=fault.id,
                diagnosis_id=diagnosis.id,
                actor_id=author_id,
                corrective_action="Correct the confirmed cause using the approved maintenance procedure and verify operation.",
                tools_materials="Approved tools and replacement materials, where required",
                outcome="SUCCESS",
                notes="Synthetic successful intervention; illustrative only.",
                created_at=fault.created_at + timedelta(hours=2, minutes=45),
            ))

            update_id = f"PROC-DEMO-{index + 1:04d}"
            if index < 9:
                update_status = "APPROVED"
            elif index < 12:
                update_status = "CHIEF_APPROVED"
            elif index < 15:
                update_status = "SUBMITTED"
            else:
                update_status = "CLARIFICATION_REQUESTED"
            update = ProcedureUpdate(
                id=update_id,
                reference=f"PU-DMO-{index + 1:04d}",
                fault_id=fault.id,
                author_id=author_id,
                section=fault.equipment.section,
                title=f"Response to {fault.symptom.lower()} on {fault.equipment.tag}",
                observed_symptom=fault.symptom,
                confirmed_cause=cause,
                diagnostic_procedure=diagnosis.diagnostic_method,
                corrective_action="Address the confirmed cause, record before-and-after checks, and verify stable operation.",
                safety="Follow the current permit, isolation and equipment-specific safety procedures.",
                version=1,
                lineage_id=update_id,
                status=update_status,
                created_at=fault.created_at + timedelta(hours=4, minutes=30),
                updated_at=fault.created_at + timedelta(hours=4, minutes=30),
            )
            db.add(update)
            db.flush()
            chief_id = f"USER-ct-{section_slug}"
            if update_status in ("CHIEF_APPROVED", "APPROVED", "CLARIFICATION_REQUESTED"):
                decision = "CLARIFICATION_REQUESTED" if update_status == "CLARIFICATION_REQUESTED" else "TECHNICAL_APPROVED"
                db.add(ProcedureReview(
                    id=f"PROC-REVIEW-CHIEF-{index + 1:04d}",
                    procedure_update_id=update_id,
                    reviewer_id=chief_id,
                    decision=decision,
                    comments="Please include the measured verification result." if decision == "CLARIFICATION_REQUESTED" else "Technical review complete.",
                    created_at=update.created_at + timedelta(minutes=10),
                ))
            if update_status == "APPROVED":
                db.add(ProcedureReview(
                    id=f"PROC-REVIEW-SUPERVISOR-{index + 1:04d}",
                    procedure_update_id=update_id,
                    reviewer_id="USER-supervisor",
                    decision="SUPERVISOR_APPROVED",
                    comments="Published after technical review.",
                    created_at=update.created_at + timedelta(minutes=20),
                ))

            if update_status == "APPROVED":
                reuse_fault = db.scalar(
                    select(Fault)
                    .where(Fault.equipment_id == fault.equipment_id, Fault.id != fault.id)
                    .order_by(Fault.created_at.desc())
                )
                if reuse_fault:
                    reuse_id = f"REUSE-DEMO-{index + 1:04d}"
                    db.add(KnowledgeReuse(
                        id=reuse_id,
                        procedure_update_id=update_id,
                        fault_id=reuse_fault.id,
                        actor_id=f"USER-st-{section_slug}",
                        used_at=reuse_fault.created_at + timedelta(minutes=30),
                    ))
                    db.flush()
                    if index % 3 != 0:
                        db.add(KnowledgeReuseOutcome(
                            reuse_id=reuse_id,
                            actor_id=f"USER-st-{section_slug}",
                            outcome="SUCCESS",
                            comments="The documented check helped resolve the repeat fault.",
                            confirmed_at=reuse_fault.created_at + timedelta(hours=4),
                        ))
        db.commit()
    migration_actor_id = db.scalar(select(User.id).where(User.username == "admin").limit(1))
    for fault in db.scalars(select(Fault).where(Fault.status.notin_(("RESTORED", "CLOSED")))).all():
        if fault.assignments or not fault.assigned_section and not fault.equipment:
            continue
        equipment_section = fault.equipment.section if fault.equipment else ""
        section = fault.assigned_section if fault.assigned_section in SECTIONS else equipment_section
        if section not in SECTIONS:
            continue
        db.add(FaultAssignment(
            id=str(uuid.uuid4()),
            fault_id=fault.id,
            section=section,
            assigned_by_id=migration_actor_id or fault.reporter_id,
            reason="Migrated active breakdown to section assignment",
        ))
        fault.assigned_section = section
    db.commit()
    db.close()
