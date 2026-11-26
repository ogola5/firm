"""Illustrative systems: equipment that works together, and what people know about each whole.

Safe to run on every start: creates missing systems and links equipment that has no system yet.
Synthetic demonstration content, not real KPC records.
"""
from __future__ import annotations

import uuid
from datetime import timedelta

from sqlalchemy import select

from app.models import Equipment, System, SystemChange, User, utcnow

SYSTEMS: list[dict] = [
    {
        "id": "SYS-L4-PUMP-A", "name": "Line 4 pump A unit", "station": "PS04", "legacy": True,
        "tags": ["11-P-401", "11-VFD-401", "11-LOP-401", "11-VMS-401", "11-RTU-401"],
        "description": "Main pump 401 with its variable speed drive, lube-oil pumps panel, vibration monitor and the station RTU "
                       "with its local workstation. The vibration monitor and local workstation predate the SCADA upgrade.",
        "connects": "The vibration monitor's trip relays hold the drive's run-permit: a latched channel blocks the start even when "
                    "SCADA shows no alarm. The lube-oil panel must report pressure before the drive accepts a start. "
                    "SCADA commands go through the station RTU; local start is at the workstation in the control room.",
        "limitations": "A SCADA reset does not clear a latched vibration channel; it must be reset at the monitor. "
                       "The local workstation hides some commands until alarms are cleared there.",
        "changes": [(900, "Vibration monitor trip relays re-wired from the old protection panel to drive panel 4 (not yet on the drawing).", "senior-engineer-electrical"),
                    (420, "Lube-oil pumps panel reset button replaced; it must now be held until it clicks.", "pt-electrical")],
    },
    {
        "id": "SYS-PS01-BOOSTER-A", "name": "Booster pump A", "station": "PS01", "legacy": False,
        "tags": ["PUMP-101", "VFD-101", "PT-102"],
        "description": "Booster pump A with its drive and discharge pressure transmitter.",
        "connects": "The discharge pressure transmitter feeds the drive's speed control; a wrong pressure reading changes pump speed.",
        "limitations": "", "changes": [],
    },
    {
        "id": "SYS-PS01-BOOSTER-B", "name": "Booster pump B", "station": "PS01", "legacy": False,
        "tags": ["PUMP-102", "VFD-102"],
        "description": "Booster pump B and its drive, the standby for pump A.", "connects": "", "limitations": "", "changes": [],
    },
    {
        "id": "SYS-PS02-T601", "name": "Tank 601 transfer system", "station": "PS02", "legacy": False,
        "tags": ["11-P-601", "11-MOV-601", "11-MOV-602", "11-LT-601", "11-STR-601", "11-PT-601", "11-TT-601"],
        "description": "Transfer pump, inlet and outlet valves, inlet strainer and the tank's level, pressure and temperature transmitters.",
        "connects": "The pump will not start unless the outlet valve reports open. A blocked strainer shows first as low flow and "
                    "high pump current, not as a strainer alarm.",
        "limitations": "", "changes": [],
    },
    {
        "id": "SYS-PS02-T501", "name": "Tank 501 transfer system", "station": "PS02", "legacy": False,
        "tags": ["11-P-501", "11-MOV-501", "11-LT-501", "11-STR-501"],
        "description": "Transfer pump, inlet valve, inlet strainer and level transmitter for tank 501.",
        "connects": "Same arrangement as tank 601: the pump start depends on the valve position feedback.", "limitations": "", "changes": [],
    },
    {
        "id": "SYS-PS02-CONTROL", "name": "Pump station 2 control and telemetry", "station": "PS02", "legacy": True,
        "tags": ["11-PLC-201", "RTU-201", "11-RAD-201", "11-HMI-01", "11-PLC-101"],
        "description": "Station PLC, tank farm PLC, RTU, telemetry radio and the control room SCADA workstation. "
                       "The radio link and tank farm PLC are older than the rest.",
        "connects": "The tank farm PLC talks to the station PLC over a serial link; the RTU collects both and sends them by radio. "
                    "If the radio drops, the station keeps running locally on the PLCs.",
        "limitations": "The serial link between the PLCs has no diagnostics on SCADA: if tank farm values freeze, check the link LEDs. "
                       "The radio loses signal in heavy rain if the antenna connector is not sealed.",
        "changes": [(1500, "Tank farm PLC added beside the station PLC, linked by serial cable (original drawings show one PLC).", "senior-engineer-systems-automation"),
                    (600, "Radio antenna moved to the new mast; connector weather-proofing added.", "pt-systems-automation")],
    },
    {
        "id": "SYS-PS02-UTILITIES", "name": "Pump station 2 power and instrument air", "station": "PS02", "legacy": False,
        "tags": ["TX-201", "11-AC-01"],
        "description": "Station transformer and the instrument air compressor.",
        "connects": "Valve actuators that use air stop moving if the compressor trips.", "limitations": "", "changes": [],
    },
    {
        "id": "SYS-DEPOT-LOADING", "name": "Depot loading and telemetry", "station": "DEPOT01", "legacy": True,
        "tags": ["PLC-101", "11-RTU-301", "LT-301"],
        "description": "Loading gantry PLC, depot RTU and the tank 301 level transmitter.",
        "connects": "The gantry PLC stops loading if the tank level signal is lost.",
        "limitations": "The gantry PLC is an older model; spare cards are scarce.",
        "changes": [(1100, "Loading gantry PLC firmware updated by the contractor; settings sheet kept at the depot office.", "ct-systems-automation")],
    },
]


def _user(db, username: str) -> str:
    return db.scalar(select(User.id).where(User.username == username)) or "USER-automation"


def seed_systems(db) -> None:
    now = utcnow()
    for spec in SYSTEMS:
        system = db.get(System, spec["id"])
        if not system:
            system = System(id=spec["id"], name=spec["name"], station=spec["station"], legacy=int(spec["legacy"]),
                            description=spec["description"], how_it_connects=spec["connects"],
                            known_limitations=spec["limitations"], updated_at=now - timedelta(days=30))
            db.add(system)
            db.flush()
            for days, text, who in spec["changes"]:
                db.add(SystemChange(id=str(uuid.uuid4()), system_id=system.id, changed_on=(now - timedelta(days=days)).date(),
                                    what_changed=text, recorded_by_id=_user(db, who), created_at=now - timedelta(days=days)))
        for equipment in db.scalars(select(Equipment).where(Equipment.tag.in_(spec["tags"]), Equipment.system_id.is_(None))):
            equipment.system_id = system.id
    db.commit()
