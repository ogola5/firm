"""Type-appropriate wording for the generic demo history (illustrative, not real KPC records).

The original seed gave every piece of equipment the same four causes and the same
"synthetic" text, so a pump could show "sensor drift" as its top cause. This replaces
that text with cases that make sense for each type of equipment. It only touches rows
that still hold the generic text, so it is safe to run on every start (and fixes an
existing database such as the one on Render).
"""
from __future__ import annotations

import re
from dataclasses import dataclass

from sqlalchemy import select

from app.models import Diagnosis, Equipment, Fault, Intervention, KnowledgeEntry, ProcedureUpdate
from app.services.catalogue import type_name, type_of

GENERIC_DESCRIPTION = "Synthetic demonstration fault record."
GENERIC_CAUSES = {"Loose terminal connection", "Sensor drift", "Blocked filter", "Incorrect controller parameter"}
GENERIC_FIX = "Correct the confirmed cause using the approved maintenance procedure and verify operation."
GENERIC_FAILED = "Initial adjustment did not resolve the reported symptom."
GENERIC_PROCEDURE_FIX = "Address the confirmed cause, record before-and-after checks, and verify stable operation."


@dataclass(frozen=True)
class Case:
    symptom: str      # in the words Operations use when reporting
    seen: str         # what the reporter saw
    cause: str
    category: str     # services/catalogue.py CAUSE_CATEGORIES
    check: str        # what to check first
    fix: str
    action: str       # services/catalogue.py ACTION_TYPES
    tried: str        # an attempt that did not fix it
    tried_kind: str
    why_not: str


CASES: dict[str, list[Case]] = {
    "MOV": [
        Case("Won't open / close", "Valve did not respond to the open command from SCADA; local operation worked.",
             "Remote/local selector contact worn", "component_failed",
             "If local works but remote does not, check the selector switch contacts before the actuator.",
             "Replaced the remote/local selector switch and tested remote open and close", "replace",
             "Replaced the actuator control card", "replace", "No change: the fault was upstream of the card."),
        Case("Won't open / close", "Valve stopped part-way and showed a torque trip.",
             "Valve stem sticking, torque switch tripped", "mechanical_damage",
             "Read the torque trip indication and check the stem for dirt before touching the torque setting.",
             "Cleaned and lubricated the stem, reset the torque trip, stroked the valve fully twice", "clean",
             "Raised the torque switch setting", "adjust", "Moved once then tripped again; more torque risks damaging the valve."),
        Case("Wrong or no reading", "Valve position on SCADA did not match the local indicator.",
             "Position feedback potentiometer worn", "wear",
             "Compare the local position indicator with SCADA at fully open and fully closed.",
             "Replaced the feedback potentiometer and re-set the end positions", "replace",
             "Re-scaled the position signal at the RTU", "adjust", "Matched at one end only; the potentiometer was worn mid-travel."),
    ],
    "CV": [
        Case("Noise, vibration or heat", "Loud knocking from the line 3 manifold when the pump stopped.",
             "Check valve disc worn, slamming on closure", "wear",
             "Listen at the valve body on pump stop; knocking at the moment of stop points to the disc.",
             "Replaced the disc and hinge pin during the planned line shutdown", "replace",
             "Slowed the pump stop ramp", "adjust", "Softer, but the knocking remained."),
        Case("Leaking", "Product weeping at the check valve cover joint.",
             "Cover gasket failed", "leak_seal",
             "Clean the joint and watch where the weep starts; the cover joint or the body.",
             "Replaced the cover gasket and torqued the bolts in sequence", "replace",
             "Tightened the cover bolts", "tighten", "Slowed the weep for a day, then it returned."),
    ],
    "STR": [
        Case("Blocked or low flow", "Transfer flow dropped by half; high differential pressure across the strainer.",
             "Strainer basket blocked with sediment", "contamination",
             "Read the differential pressure gauge; above the marked line means clean the basket.",
             "Isolated, drained and cleaned the basket; recorded the DP before and after", "clean",
             "Increased the pump speed", "adjust", "Flow barely changed and the pump ran hotter."),
        Case("Leaking", "Product dripping from the strainer lid after cleaning.",
             "Lid O-ring damaged during cleaning", "leak_seal",
             "Check the O-ring seat for nicks before refitting the lid.", "Replaced the lid O-ring and refitted", "replace",
             "Tightened the lid clamp", "tighten", "Still dripping: the O-ring was cut."),
    ],
    "PUMP": [
        Case("Won't start", "Pump would not start from the local panel; alarms would not reset.",
             "Protection trip latched in the vibration monitor", "trip_latched",
             "Look at the vibration monitor display first: a latched channel blocks the start even when SCADA looks clear.",
             "Reset the latched channel at the vibration monitor, cleared alarms, started locally", "reset",
             "Reset from SCADA", "reset", "Did not clear: the latch is held in the vibration monitor."),
        Case("Noise, vibration or heat", "High vibration alarm on the drive-end bearing; noise at the skid.",
             "Coupling misalignment", "mechanical_damage",
             "Compare drive-end and non-drive-end vibration; a big difference after recent work points to alignment.",
             "Re-aligned the coupling with the laser kit and recorded the readings", "adjust",
             "Greased the bearings", "repair", "Quieter for a few hours, then the noise returned."),
        Case("Leaking", "Product dripping from the mechanical seal.",
             "Mechanical seal faces worn", "leak_seal",
             "Check the seal flush line is clear before blaming the seal.", "Replaced the mechanical seal", "replace",
             "Cleared the seal flush line", "clean", "Flush was clear; the seal itself was worn."),
        Case("Stopped / tripped", "Pump tripped on motor overload after a few minutes.",
             "Discharge valve partly closed, pump running off its curve", "external",
             "Check the discharge valve position and pressure against the duty point before resetting.",
             "Opened the discharge valve fully, reset the overload, ran and watched the current", "reset",
             "Reset the overload and restarted", "reset", "Tripped again after five minutes."),
    ],
    "VFD": [
        Case("Stopped / tripped", "Drive tripped on overtemperature in the afternoon.",
             "Cooling fan failed and cabinet filter blocked", "component_failed",
             "Check the cooling fan runs and the cabinet filter is clean before resetting.",
             "Replaced the cooling fan and cabinet filter, reset and ran under load", "replace",
             "Reset the drive", "reset", "Tripped again after 20 minutes on overtemperature."),
        Case("Won't start", "Drive showed ready but did not respond to the run command.",
             "Run-enable interlock wire loose at the terminal", "loose_connection",
             "Check the run-enable input LED on the drive while the command is given.",
             "Re-terminated the run-enable wire and tested start and stop", "tighten",
             "Re-loaded the drive parameters", "adjust", "No change: the input never reached the drive."),
    ],
    "LT": [
        Case("Wrong or no reading", "Tank level jumped about overnight while the dip showed it steady.",
             "Water in the transmitter housing", "contamination",
             "Compare with a manual dip; open the housing and look for water, especially after cold nights.",
             "Dried the housing, replaced the cover seal and added a desiccant pack", "repair",
             "Re-calibrated the transmitter", "adjust", "Fine by day, drifted again at night: calibration was not the problem."),
        Case("Wrong or no reading", "Level reading frozen at one value.",
             "Signal cable damaged at the tank wall", "loose_connection",
             "Measure the loop current at the transmitter and at the marshalling cabinet.",
             "Replaced the damaged section of signal cable and tested the loop", "replace",
             "Replaced the transmitter", "replace", "Same frozen reading: the fault was in the cable."),
    ],
    "PT": [
        Case("Wrong or no reading", "Discharge pressure read zero with the pump running.",
             "Impulse line blocked", "contamination",
             "Close the root valve, vent the impulse line and see whether product flows.",
             "Cleared the impulse line and re-zeroed the transmitter", "clean",
             "Replaced the transmitter", "replace", "Still zero: the line to it was blocked."),
        Case("Wrong or no reading", "Pressure reading drifting slowly upward over days.",
             "Transmitter zero drift", "setting",
             "Check the reading with the root valve closed and vented: it should read zero.",
             "Re-zeroed and checked the span against a test gauge", "adjust",
             "Changed the SCADA scaling", "adjust", "Hid the drift for a while; the transmitter needed re-zeroing."),
    ],
    "TT": [
        Case("Wrong or no reading", "Temperature reading jumping between normal and a very high value.",
             "Loose sensor wire at the head", "loose_connection",
             "Open the head and check the sensor terminals for a loose screw.", "Re-terminated the sensor wires", "tighten",
             "Replaced the temperature element", "replace", "No change: the fault was at the terminals."),
    ],
    "FT": [
        Case("Wrong or no reading", "Line flow meter reading lower than the tank movement shows.",
             "Meter needs re-calibration after wear", "setting",
             "Compare the meter total with the tank movement over one transfer.",
             "Re-calibrated with the prover and recorded the new meter factor", "adjust",
             "Cleaned the meter strainer", "clean", "Strainer was clean; the meter factor had drifted."),
        Case("Communication lost", "Flow meter value missing on SCADA; meter display normal.",
             "Communication card failed", "communication",
             "Check the meter's comms LEDs and the cable at the RTU.", "Replaced the meter communication card", "replace",
             "Restarted the RTU", "reset", "Other values came back; the meter stayed missing."),
    ],
    "FC": [
        Case("Wrong or no reading", "Flow computer totals not matching the meters.",
             "Wrong meter factor entered after maintenance", "setting",
             "Compare the meter factors in the flow computer with the last proving certificate.",
             "Corrected the meter factor and recorded the change", "adjust",
             "Restarted the flow computer", "reset", "Same totals: the configuration was wrong."),
    ],
    "PLC": [
        Case("Communication lost", "SCADA lost all values from the PLC; PLC still controlling locally.",
             "Network switch port failed", "communication",
             "Check the link LED on the switch port and try another port.",
             "Moved the PLC to a spare port and replaced the switch later", "replace",
             "Restarted the PLC", "reset", "Came back for a few minutes, then dropped again."),
        Case("Stopped / tripped", "PLC went to stop mode during a thunderstorm.",
             "Power supply dip; PLC UPS battery worn", "power_supply",
             "Check the UPS log and battery test result.", "Replaced the UPS batteries and restarted the PLC", "replace",
             "Restarted the PLC only", "reset", "Ran until the next supply dip."),
    ],
    "RTU": [
        Case("Communication lost", "Station dropped off SCADA; local workstation still running.",
             "Communication module hung after a supply dip", "communication",
             "Check the RTU comms LEDs and the UPS log for a supply dip at the time of the drop.",
             "Power-cycled the communication module only and confirmed polling resumed", "reset",
             "Restarted the SCADA server connection", "reset", "Server side was fine; the RTU was not answering."),
        Case("Communication lost", "Values from the station updating only intermittently.",
             "Loose connector on the radio cable", "loose_connection",
             "Check the cable connectors at the RTU and the radio.", "Re-made the connector and weather-proofed it", "tighten",
             "Changed the polling rate", "adjust", "Still intermittent."),
    ],
    "RAD": [
        Case("Communication lost", "Telemetry link down after heavy rain.",
             "Water in the antenna connector", "contamination",
             "Check the antenna connector and the signal strength reading.", "Dried and re-sealed the antenna connector", "repair",
             "Restarted the radio", "reset", "Link stayed down."),
    ],
    "HMI": [
        Case("Wrong or no reading", "SCADA workstation screens frozen; values not updating.",
             "Workstation lost connection to the server after an update", "communication",
             "Check the clock and the connection status at the bottom of the screen.",
             "Restarted the SCADA client service and checked the server connection", "reset",
             "Restarted the whole workstation", "reset", "Froze again within the hour until the service was fixed."),
    ],
    "TX": [
        Case("Noise, vibration or heat", "Transformer louder than usual and hot to the touch.",
             "Cooling fins blocked and one fan failed", "component_failed",
             "Check the winding temperature indicator and that the cooling fans run.", "Cleaned the fins and replaced the failed fan", "replace",
             "Reduced the load", "adjust", "Cooler, but the fan was still not running."),
    ],
    "AC": [
        Case("Stopped / tripped", "Instrument air compressor tripped on high temperature.",
             "Cooler fouled and oil low", "contamination",
             "Check the oil level and the cooler fins before resetting.", "Cleaned the cooler, topped up oil, reset", "clean",
             "Reset the trip", "reset", "Tripped again after half an hour."),
        Case("Leaking", "Air pressure dropping overnight with the compressor off.",
             "Air leak at a pipe fitting", "leak_seal",
             "Listen along the header and use soapy water on the fittings.", "Re-made the leaking fitting", "repair",
             "Adjusted the pressure switch", "adjust", "The compressor just ran more; the leak remained."),
    ],
}
FALLBACK = CASES["MOV"]


def case_for(tag: str, index: int) -> Case:
    cases = CASES.get(type_of(tag), FALLBACK)
    return cases[index % len(cases)]


def _number(identifier: str) -> int:
    digits = re.findall(r"\d+", identifier)
    return int(digits[-1]) if digits else 0


def refresh_generic_demo(db) -> int:
    """Rewrite generic demo text with type-appropriate cases. Returns how many faults changed."""
    changed = 0
    faults = db.scalars(select(Fault).where(Fault.id.like("FAULT-%"), Fault.description == GENERIC_DESCRIPTION)).all()
    for fault in faults:
        equipment = db.get(Equipment, fault.equipment_id)
        if not equipment:
            continue
        case = case_for(equipment.tag, _number(fault.id))
        fault.symptom, fault.description = case.symptom, case.seen
        for diagnosis in db.scalars(select(Diagnosis).where(Diagnosis.fault_id == fault.id)):
            if diagnosis.possible_cause in GENERIC_CAUSES:
                diagnosis.possible_cause, diagnosis.cause_category = case.cause, case.category
                diagnosis.quick_check = diagnosis.diagnostic_method = case.check
                diagnosis.observations, diagnosis.test_results = case.seen, "Illustrative demonstration result."
        for item in db.scalars(select(Intervention).where(Intervention.fault_id == fault.id)):
            if item.outcome == "SUCCESS" and item.corrective_action == GENERIC_FIX:
                item.corrective_action = case.fix
                if item.action_type != "temporary":
                    item.action_type = case.action
            elif item.outcome == "FAILED" and item.corrective_action == GENERIC_FAILED:
                item.corrective_action, item.action_type, item.notes = case.tried, case.tried_kind, case.why_not
        for update in db.scalars(select(ProcedureUpdate).where(ProcedureUpdate.fault_id == fault.id)):
            if update.confirmed_cause in GENERIC_CAUSES:
                update.title = f"{case.symptom} on {type_name(type_of(equipment.tag)).lower()}: {case.cause[0].lower()}{case.cause[1:]}"
                update.observed_symptom, update.confirmed_cause = case.symptom, case.cause
                update.diagnostic_procedure = f"1. {case.check}\nDon't bother with: {case.tried.lower()}. {case.why_not}"
                update.corrective_action = case.fix
        changed += 1
    for entry in db.scalars(select(KnowledgeEntry).where(KnowledgeEntry.title.like("Synthetic diagnostic procedure%"))):
        equipment = db.get(Equipment, entry.equipment_id) if entry.equipment_id else None
        case = case_for(equipment.tag if equipment else "", _number(entry.id))
        kind = type_name(type_of(equipment.tag)) if equipment else "General"
        entry.title = f"{kind}: {case.symptom.lower()} ({case.cause[0].lower()}{case.cause[1:]})"
        entry.symptom, entry.confirmed_cause = case.symptom, case.cause
        entry.diagnostic_procedure, entry.corrective_action = case.check, case.fix
    db.commit()
    return changed
