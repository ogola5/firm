"""Short pick-lists that make the library analysable (a simplified ISO 14224).

One pick per field, written the way technicians talk. Free text stays alongside.
"""
from __future__ import annotations

from fastapi import HTTPException

CAUSE_CATEGORIES: dict[str, str] = {
    "loose_connection": "Loose or broken connection",
    "component_failed": "Electrical or electronic part failed",
    "wear": "Wear or end of life",
    "setting": "Wrong setting, parameter or calibration",
    "contamination": "Dirt, water or blockage",
    "power_supply": "Power supply problem",
    "communication": "Communication or signal lost",
    "mechanical_damage": "Mechanical damage",
    "leak_seal": "Leak or seal failure",
    "modification": "Unrecorded change (differs from drawing)",
    "external": "Operating error or outside cause",
    "not_found": "Cause not found yet",
}

ACTION_TYPES: dict[str, str] = {
    "replace": "Replaced a part",
    "repair": "Repaired",
    "tighten": "Tightened or re-terminated",
    "adjust": "Adjusted, set or calibrated",
    "reset": "Reset or restarted",
    "clean": "Cleaned or cleared",
    "temporary": "Temporary fix or bypass",
    "inspect": "Checked or tested only",
    "other": "Other",
}

DIFFERENCE_PERMANENCE = {"PERMANENT": "Permanent change", "TEMPORARY": "Temporary (to be put back)"}


# Equipment types from the tag letters (11-MOV-601 -> MOV), in plain words.
TYPE_NAMES: dict[str, str] = {
    "MOV": "Motor-operated valves", "CV": "Check valves", "STR": "Strainers", "PUMP": "Pumps", "VFD": "Variable speed drives",
    "LT": "Level transmitters", "PT": "Pressure transmitters", "TT": "Temperature transmitters", "FT": "Flow meters",
    "FC": "Flow computers", "PLC": "PLCs", "RTU": "RTUs", "RAD": "Telemetry radios", "HMI": "SCADA workstations",
    "TX": "Transformers", "AC": "Air compressors",
}
TYPE_ALIASES = {"P": "PUMP"}


def type_of(tag: str) -> str:
    """Equipment type code from a tag, with aliases folded (11-P-501 and PUMP-101 are both PUMP)."""
    from app.services.analytics.facts import equipment_type

    code = equipment_type(tag or "")
    return TYPE_ALIASES.get(code, code)


def type_name(code: str) -> str:
    return TYPE_NAMES.get(code, code or "Other equipment")


def check_choice(value: str, options: dict[str, str], label: str) -> str:
    """'' is allowed (older write-ups); anything else must be on the list."""
    if value and value not in options:
        raise HTTPException(status_code=422, detail=f"Choose {label} from the list")
    return value


def catalogue() -> dict:
    return {
        "cause_categories": [{"value": key, "label": label} for key, label in CAUSE_CATEGORIES.items()],
        "action_types": [{"value": key, "label": label} for key, label in ACTION_TYPES.items()],
        "difference_permanence": [{"value": key, "label": label} for key, label in DIFFERENCE_PERMANENCE.items()],
    }
