import { describe, expect, it } from "vitest";
import { overlap, similarFaults, stem, type Case, type CaseIndex } from "./similarity";

const vocabulary = {
  synonyms: { vfd: ["drive", "inverter"], drive: ["vfd", "inverter"], hot: ["overtemperature", "temperature", "heat"], trip: ["tripped", "overload"] },
  stopwords: ["the", "on", "in", "a"],
  suffixes: ["ing", "ed", "es", "s"],
};

const base: Case = {
  id: "", reference: "", equipment_id: null, equipment_tag: "", equipment_name: "", equipment_type: "", system_id: null, system_name: "",
  category: "", symptom: "", description: "", reported_at: "2026-11-01T00:00:00Z", causes: [], worked: [], did_not_work: [],
};

const index = (cases: Case[]): CaseIndex => ({
  generated_at: "", weights: [0.4, 0.25, 0.2, 0.15], min_score: 0.3, half_life_days: 120, related_equipment: 0.6, same_type: 0.5,
  type_aliases: { P: "PUMP" }, vocabulary, cases,
});

describe("offline similarity (same rules as the server)", () => {
  it("stems word forms like the server", () => {
    expect(stem("tripped", vocabulary.suffixes)).toBe("trip");
    expect(stem("leaking", vocabulary.suffixes)).toBe("leak");
    expect(stem("valves", vocabulary.suffixes)).toBe("valve");
    expect(stem("valve", vocabulary.suffixes)).toBe("valve");
    expect(stem("boxes", vocabulary.suffixes)).toBe("box");
    expect(stem("switches", vocabulary.suffixes)).toBe("switch");
  });

  it("understands shorthand: 'VFD hot trip' is about the drive that tripped on overtemperature", () => {
    expect(overlap("VFD hot trip", "Drive tripped on overtemperature", vocabulary)).toBeGreaterThanOrEqual(0.6);
    expect(overlap("VFD hot trip", "Tank level reading frozen", vocabulary)).toBe(0);
  });

  it("ranks related equipment and same-type (aliased) equipment, with reasons", () => {
    const target = { ...base, id: "T", equipment_id: "PUMP-401", equipment_tag: "11-P-401", equipment_type: "P", system_id: "L4",
      symptom: "Won't start", reported_at: "2026-11-20T00:00:00Z" };
    const drive = { ...base, id: "D", reference: "R-D", equipment_id: "VFD-401", equipment_tag: "11-VFD-401", equipment_type: "VFD",
      system_id: "L4", system_name: "Line 4 pump A unit", symptom: "Won't start", worked: ["Reset the drive"] };
    const otherPump = { ...base, id: "P", reference: "R-P", equipment_id: "PUMP-101", equipment_tag: "PUMP-101", equipment_type: "PUMP",
      symptom: "Leaking", worked: ["Replaced the seal"] };
    const later = { ...drive, id: "L", reported_at: "2026-11-25T00:00:00Z" };
    const results = similarFaults(target, index([drive, otherPump, later]), 5, new Date("2026-11-21T00:00:00Z"));
    expect(results.map((row) => row.fault_id)).toEqual(["D", "P"]); // the later one is not "earlier"
    expect(results[0].reasons).toContain("Related equipment (11-VFD-401, same Line 4 pump A unit)");
    expect(results[1].reasons).toContain("Same type of equipment (PUMP)");
  });
});
