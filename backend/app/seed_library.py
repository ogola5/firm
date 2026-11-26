"""Illustrative library content for the equipment types that fail most, so the first look is useful.

Each case is written the way it happened: what was seen, what was tried and failed,
what worked, and the procedure that came out of it. All of it is synthetic
demonstration data, not real KPC records. Every fault here is old enough (45+ days)
not to trigger the 30-day "came back after a fix" escalation.
"""
from __future__ import annotations

from datetime import timedelta

from sqlalchemy import select

from app.models import (
    Diagnosis, Equipment, EquipmentTypeOwner, Fault, Intervention, KnowledgeReuse, KnowledgeReuseOutcome, ProcedureReview,
    ProcedureUpdate, User, utcnow,
)
from app.services.audit import add_event

SAFE_ISOLATION = "Work under a permit. Isolate and lock off before opening any panel; prove dead."

# type, tag, knowledge owner, cases (oldest first), procedures, reuses.
LIBRARY: list[dict] = [
    {
        "type": "PUMP", "tag": "11-P-401", "owner": "senior-engineer-mechanical",
        "cases": [
            {"days": 400, "symptom": "Won't start", "by": "pt-mechanical",
             "description": "Line 4 pump A would not start from the local panel. Alarms would not reset and the start command was refused.",
             "cause": "Latched trip in the vibration monitor", "category": "trip_latched",
             "check": "Look at the vibration monitor display first: a latched channel blocks the start even when SCADA looks clear.",
             "failed": [("Reset from SCADA at the local workstation", "reset", "Did not clear: the latch is held in the vibration monitor, not in SCADA.")],
             "fixed": ("Reset the latched channel on the vibration monitor, cleared the remaining alarms at the workstation, started locally", "reset")},
            {"days": 210, "symptom": "Won't start", "by": "st-mechanical",
             "description": "Pump 401 refused to start after a power dip. Several alarms stayed active.",
             "cause": "Latched trip in the vibration monitor", "category": "trip_latched",
             "check": "Vibration monitor display first.",
             "failed": [], "fixed": ("Followed the procedure: vibration monitor reset, then local start", "reset")},
            {"days": 95, "symptom": "Noise, vibration or heat", "by": "pt-mechanical",
             "description": "High vibration alarm on pump 401 drive-end bearing; noise audible at the skid.",
             "cause": "Coupling misalignment after a seal change", "category": "mechanical_damage",
             "check": "Compare vibration on drive end and non-drive end; a big difference after recent work points to alignment.",
             "failed": [("Greased the bearings", "repair", "Noise reduced for a few hours, then returned.")],
             "fixed": ("Re-aligned the coupling with the laser kit and recorded the readings", "adjust")},
        ],
        "procedures": [{"case": 0, "author": "pt-mechanical",
                        "title": "Line 4 pump won't start after a trip: clear the latch at the vibration monitor",
                        "checks": "1. Check the vibration monitor display for a latched channel.\n2. Check the drive panel for a trip indication.\n3. Only then look at SCADA alarms.",
                        "fix": "1. Reset the latched channel at the vibration monitor.\n2. Clear remaining alarms at the local workstation.\n3. Take the station to local and start the pump.\n4. Hand back to the operator and watch for 15 minutes.",
                        "safety": "Confirm the cause of the original trip is understood before restarting; do not restart repeatedly.",
                        "tools": "Vibration monitor key, local workstation login, radio to the control room."}],
        "reuses": [{"procedure": 0, "case": 1, "by": "st-mechanical", "outcome": "SUCCESS"}],
    },
    {
        "type": "MOV", "tag": "11-MOV-601", "owner": "ct-electrical",
        "cases": [
            {"days": 640, "symptom": "Won't open / close", "by": "pt-electrical",
             "description": "Tank 601 inlet valve did not open from SCADA; local open worked.",
             "cause": "Remote/local selector contact worn", "category": "component_failed",
             "check": "If local works but remote does not, check the selector switch contacts before the actuator.",
             "failed": [("Replaced the actuator control card", "replace", "No change: the fault was upstream of the card.")],
             "fixed": ("Replaced the remote/local selector switch", "replace")},
            {"days": 150, "symptom": "Won't open / close", "by": "st-electrical",
             "description": "Valve stuck part-way (about 40%) and showed a torque trip.",
             "cause": "Torque switch tripped on a sticking valve stem", "category": "mechanical_damage",
             "check": "Read the torque trip indication; check the stem for dirt before touching the torque setting.",
             "failed": [("Raised the torque switch setting", "adjust", "Valve moved once then tripped again; raising torque risks damaging the valve.")],
             "fixed": ("Cleaned and lubricated the valve stem, reset the torque trip, stroked the valve fully twice", "clean")},
        ],
        "procedures": [{"case": 0, "author": "pt-electrical",
                        "title": "Tank valve opens locally but not from SCADA",
                        "checks": "1. Try local operation.\n2. If local works, check the remote/local selector contacts.\n3. Then the remote command wiring.",
                        "fix": "Replace the selector switch if its contacts are worn; test remote open and close.",
                        "safety": SAFE_ISOLATION}],
        "reuses": [],
    },
    {
        "type": "LT", "tag": "11-LT-601", "owner": "ct-systems-automation",
        "cases": [
            {"days": 330, "symptom": "Wrong or no reading", "by": "pt-systems-automation",
             "description": "Tank 601 level reading jumped about overnight; dip showed the tank steady.",
             "cause": "Condensation in the transmitter housing", "category": "contamination",
             "check": "Compare with a manual dip; open the housing and look for water, especially after cold nights.",
             "failed": [("Re-calibrated the transmitter", "adjust", "Looked fine in the day, drifted again at night: calibration was not the problem.")],
             "fixed": ("Dried the housing, replaced the cover seal and added a desiccant pack", "repair")},
            {"days": 120, "symptom": "Wrong or no reading", "by": "engineer-systems-automation",
             "description": "Same drifting level at night on tank 601.",
             "cause": "Condensation in the transmitter housing; cable gland not sealing", "category": "contamination",
             "check": "Check the cable gland as well as the cover seal.",
             "failed": [], "fixed": ("Dried the housing, replaced the cover seal and re-made the cable gland with a drip loop", "repair")},
        ],
        "procedures": [
            {"case": 0, "author": "pt-systems-automation",
             "title": "Level reading drifts at night: water in the transmitter housing",
             "checks": "1. Manual dip to confirm the tank is steady.\n2. Open the housing and check for water.",
             "fix": "Dry the housing, replace the cover seal, add a desiccant pack.",
             "safety": SAFE_ISOLATION},
            # A colleague's improvement: version 2 supersedes version 1.
            {"case": 1, "author": "engineer-systems-automation", "builds_on": 0,
             "reason": "Water also came in along the cable: added the cable gland check and the drip loop.",
             "title": "Level reading drifts at night: water in the housing or through the cable gland",
             "checks": "1. Manual dip to confirm the tank is steady.\n2. Open the housing and check for water.\n3. Check the cable gland: water often enters along the cable.",
             "fix": "Dry the housing, replace the cover seal, re-make the cable gland with a drip loop, add a desiccant pack.",
             "tools": "Cover seal kit, cable gland (M20), desiccant packs, loop calibrator.",
             "safety": SAFE_ISOLATION},
        ],
        "reuses": [],
    },
    {
        "type": "STR", "tag": "11-STR-501", "owner": "ct-mechanical",
        "cases": [
            {"days": 260, "symptom": "Blocked or low flow", "by": "st-mechanical",
             "description": "Transfer flow into tank 501 dropped by half; differential pressure across the strainer high.",
             "cause": "Strainer basket blocked with sediment", "category": "contamination",
             "check": "Read the differential pressure gauge; above the marked line means clean the basket.",
             "failed": [], "fixed": ("Isolated, drained and cleaned the strainer basket; recorded the DP before and after", "clean")},
            {"days": 70, "symptom": "Blocked or low flow", "by": "pt-mechanical",
             "description": "Low flow again on the tank 501 line.",
             "cause": "Strainer basket blocked with sediment", "category": "contamination",
             "check": "DP gauge first.", "failed": [],
             "fixed": ("Cleaned the basket using the procedure; DP back to normal", "clean")},
        ],
        "procedures": [{"case": 0, "author": "st-mechanical",
                        "title": "Low transfer flow: check and clean the inlet strainer",
                        "checks": "1. Read the strainer differential pressure.\n2. Compare with the marked limit.",
                        "fix": "Isolate, drain, remove and clean the basket, refit with a new gasket, record DP before and after.",
                        "safety": "Product line: drain to the closed system, wear gloves and goggles, have spill kit ready.",
                        "tools": "Basket lifting tool, new lid gasket, drain hose, spill kit."}],
        "reuses": [{"procedure": 0, "case": 1, "by": "pt-mechanical", "outcome": "SUCCESS"}],
    },
    {
        "type": "RTU", "tag": "11-RTU-401", "owner": "ct-systems-automation",
        "cases": [
            {"days": 300, "symptom": "Communication lost", "by": "pt-systems-automation",
             "description": "Line 4 station dropped off SCADA; local workstation still running.",
             "cause": "RTU communication module hung after a supply dip", "category": "communication",
             "check": "Check the RTU comms LED pattern and the UPS log for a supply dip at the time of the drop.",
             "failed": [("Restarted the SCADA server connection", "reset", "Server side was fine; the RTU itself was not answering.")],
             "fixed": ("Power-cycled the RTU communication module only (not the whole RTU), confirmed polling resumed", "reset")},
        ],
        "procedures": [{"case": 0, "author": "pt-systems-automation",
                        "title": "Station off SCADA after a supply dip: restart the RTU comms module",
                        "checks": "1. Comms LEDs on the RTU.\n2. UPS log for a supply dip.\n3. Ping from the workstation.",
                        "fix": "Power-cycle the comms module only; confirm polling at the control centre before leaving.",
                        "safety": "Tell the control centre before restarting; the station is blind while it restarts."}],
        "reuses": [],
    },
    {
        "type": "VFD", "tag": "11-VFD-401", "owner": "senior-engineer-electrical",
        "cases": [
            {"days": 180, "symptom": "Stopped / tripped", "by": "pt-electrical",
             "description": "Line 4 drive tripped on overtemperature during the afternoon.",
             "cause": "Drive cooling fan failed and filter blocked", "category": "component_failed",
             "check": "Check the cooling fan runs and the cabinet filter is clean before resetting.",
             "failed": [("Reset the drive", "reset", "Tripped again after 20 minutes on overtemperature.")],
             "fixed": ("Replaced the cooling fan and the cabinet filter, reset and ran under load", "replace")},
        ],
        "procedures": [], "reuses": [],
    },
]


def _user(db, username: str) -> str:
    return db.scalar(select(User.id).where(User.username == username)) or "USER-automation"


def seed_library(db) -> None:
    now = utcnow()
    for spec in LIBRARY:
        owner_id = _user(db, spec["owner"])
        if not db.get(EquipmentTypeOwner, spec["type"]):
            db.add(EquipmentTypeOwner(equipment_type=spec["type"], owner_id=owner_id, assigned_by_id=_user(db, "maintenance-manager"),
                                      assigned_at=now - timedelta(days=60)))
    db.commit()
    if db.get(Fault, "FAULT-LIB-0001"):
        return
    counter = 0
    procedure_counter = 0
    for spec in LIBRARY:
        equipment = db.scalar(select(Equipment).where(Equipment.tag == spec["tag"]))
        if not equipment:
            continue
        section_slug = equipment.section.lower().replace(" ", "-")
        fault_ids: list[str] = []
        for case in spec["cases"]:
            counter += 1
            reported = now - timedelta(days=case["days"], hours=counter % 7)
            restored = reported + timedelta(hours=3 + counter % 5)
            fault_id = f"FAULT-LIB-{counter:04d}"
            fault_ids.append(fault_id)
            actor = _user(db, case["by"])
            db.add(Fault(
                id=fault_id, reference=f"KPC-LIB-{counter:04d}", equipment_id=equipment.id, reporter_id="USER-operations",
                category=equipment.category, symptom=case["symptom"], severity="High", description=case["description"],
                operational_impact="Stopped: Operation stopped or at risk", status="CLOSED", assigned_section=equipment.section,
                created_at=reported, acknowledged_at=reported + timedelta(minutes=25), restored_at=restored,
                seen_via="SCADA", observed_at=reported - timedelta(minutes=10),
            ))
            db.flush()
            diagnosis = Diagnosis(
                id=f"DIAG-LIB-{counter:04d}", fault_id=fault_id, author_id=actor, possible_cause=case["cause"],
                diagnostic_method="Site checks recorded in the write-up.", observations=case["description"], test_results="",
                confidence=0.9, verification_status="CONFIRMED", cause_category=case["category"], quick_check=case["check"],
                fix_summary=case["fixed"][0], created_at=reported + timedelta(hours=1),
            )
            db.add(diagnosis)
            db.flush()
            for index, (action, kind, note) in enumerate(case["failed"]):
                db.add(Intervention(id=f"INT-LIB-F-{counter:04d}-{index}", fault_id=fault_id, diagnosis_id=diagnosis.id, actor_id=actor,
                                    corrective_action=action, tools_materials="", outcome="FAILED", action_type=kind, notes=note,
                                    created_at=reported + timedelta(hours=1, minutes=20 + index * 10)))
            db.add(Intervention(id=f"INT-LIB-S-{counter:04d}", fault_id=fault_id, diagnosis_id=diagnosis.id, actor_id=actor,
                                corrective_action=case["fixed"][0], tools_materials="", outcome="SUCCESS", action_type=case["fixed"][1],
                                notes="Illustrative demonstration record.", created_at=restored - timedelta(minutes=15)))
            add_event(db, fault_id, "FAULT_REPORTED", "USER-operations", {"severity": "High"}, reported)
            add_event(db, fault_id, "FAULT_ACKNOWLEDGE", actor, {}, reported + timedelta(minutes=25))
            add_event(db, fault_id, "FAULT_RESTORE", actor, {}, restored)
            add_event(db, fault_id, "FAULT_CLOSE", f"USER-ct-{section_slug}", {}, restored + timedelta(hours=1))
        db.flush()

        procedure_ids: list[str] = []
        for proc in spec["procedures"]:
            procedure_counter += 1
            fault_id = fault_ids[proc["case"]]
            fault = db.get(Fault, fault_id)
            base_id = procedure_ids[proc["builds_on"]] if "builds_on" in proc else None
            base = db.get(ProcedureUpdate, base_id) if base_id else None
            proc_id = f"PROC-LIB-{procedure_counter:04d}"
            approved_at = fault.restored_at + timedelta(days=2)
            db.add(ProcedureUpdate(
                id=proc_id, reference=f"PU-LIB-{procedure_counter:04d}", fault_id=fault_id, author_id=_user(db, proc["author"]),
                section=equipment.section, title=proc["title"], observed_symptom=fault.symptom,
                confirmed_cause=spec["cases"][proc["case"]]["cause"], diagnostic_procedure=proc["checks"],
                corrective_action=proc["fix"], safety=proc["safety"], tools_materials=proc.get("tools", ""),
                version=(base.version + 1) if base else 1, lineage_id=base.lineage_id if base else proc_id,
                previous_update_id=base.id if base else None, change_reason=proc.get("reason", ""), status="APPROVED",
                created_at=approved_at - timedelta(days=1), updated_at=approved_at,
            ))
            db.flush()
            db.add(ProcedureReview(id=f"PROC-LIB-REV-C-{procedure_counter:04d}", procedure_update_id=proc_id,
                                   reviewer_id=f"USER-ct-{section_slug}", decision="TECHNICAL_APPROVED",
                                   comments="Checked against the site write-up.", created_at=approved_at - timedelta(hours=6)))
            db.add(ProcedureReview(id=f"PROC-LIB-REV-S-{procedure_counter:04d}", procedure_update_id=proc_id,
                                   reviewer_id="USER-supervisor", decision="SUPERVISOR_APPROVED", comments="Published.",
                                   created_at=approved_at))
            if base:
                base.status = "SUPERSEDED"
                db.add(ProcedureReview(id=f"PROC-LIB-REV-X-{procedure_counter:04d}", procedure_update_id=base.id,
                                       reviewer_id="USER-supervisor", decision="SUPERSEDED",
                                       comments=f"Replaced by version {base.version + 1}.", created_at=approved_at))
            procedure_ids.append(proc_id)
        db.flush()

        for index, reuse in enumerate(spec["reuses"]):
            fault = db.get(Fault, fault_ids[reuse["case"]])
            reuse_id = f"REUSE-LIB-{spec['type']}-{index}"
            actor = _user(db, reuse["by"])
            db.add(KnowledgeReuse(id=reuse_id, procedure_update_id=procedure_ids[reuse["procedure"]], fault_id=fault.id,
                                  actor_id=actor, used_at=fault.created_at + timedelta(minutes=40)))
            db.flush()
            db.add(KnowledgeReuseOutcome(reuse_id=reuse_id, actor_id=actor, outcome=reuse["outcome"],
                                         comments="Followed the procedure; it worked.", confirmed_at=fault.restored_at))
    db.commit()
