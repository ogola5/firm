import { describe, expect, it } from "vitest";
import { rankEquipment } from "./equipmentMatch";

const registry = [
  { tag: "11-MOV-601", name: "Tank 601 inlet valve", aliases: "t601 inlet mov motorised valve actuator" },
  { tag: "11-MOV-602", name: "Tank 601 outlet valve", aliases: "t601 outlet mov motorised valve actuator" },
  { tag: "11-MOV-501", name: "Tank 501 inlet valve", aliases: "t501 inlet mov motorised valve actuator" },
  { tag: "11-LT-601", name: "Tank 601 level transmitter", aliases: "t601 level gauge lt" },
  { tag: "PUMP-102", name: "Booster pump B", aliases: "booster pump b p102" },
  { tag: "11-P-401", name: "Line 4 main pump A (pump 401)", aliases: "line 4 pump a line4 pump a pump 401 main pump line 4 p401" },
  { tag: "11-P-402", name: "Line 4 main pump B (pump 402)", aliases: "line 4 pump b line4 pump b pump 402 main pump line 4 p402" },
  { tag: "11-LOP-401", name: "Line 4 pump A lube oil pumps panel", aliases: "lop panel line 4 lube oil pumps lop pump 401 panel 4" },
  { tag: "11-VFD-401", name: "Line 4 pump A variable speed drive", aliases: "line 4 pump a vfd drive panel 4 p401 vfd" },
];

const first = (query: string) => rankEquipment(registry, query)[0]?.tag;

describe("equipment matching", () => {
  it("matches plain descriptions, short forms and tags the way the server does", () => {
    expect(first("tank 601 inlet valve")).toBe("11-MOV-601");
    expect(first("T601 inlet")).toBe("11-MOV-601");
    expect(first("tank 601 outlet")).toBe("11-MOV-602");
    expect(first("mov 501")).toBe("11-MOV-501");
    expect(first("11-mov-501")).toBe("11-MOV-501");
    expect(first("tank 601 level")).toBe("11-LT-601");
    expect(first("booster pump b")).toBe("PUMP-102");
  });

  it("finds the pump itself, not its panel or drive, and tells pump A from pump B", () => {
    expect(first("line 4 pump a")).toBe("11-P-401");
    expect(first("line 4 pump b")).toBe("11-P-402");
    expect(first("pump 401")).toBe("11-P-401");
    expect(first("line 4 pump a lop panel")).toBe("11-LOP-401");
    expect(first("pump a vfd")).toBe("11-VFD-401");
  });

  it("returns nothing for unrelated or empty text", () => {
    expect(rankEquipment(registry, "the")).toEqual([]);
    expect(rankEquipment(registry, "compressor 9")).toEqual([]);
  });
});
