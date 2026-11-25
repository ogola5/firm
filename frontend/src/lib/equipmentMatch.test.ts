import { describe, expect, it } from "vitest";
import { rankEquipment } from "./equipmentMatch";

const registry = [
  { tag: "11-MOV-601", name: "Tank 601 inlet valve", aliases: "t601 inlet mov motorised valve actuator" },
  { tag: "11-MOV-602", name: "Tank 601 outlet valve", aliases: "t601 outlet mov motorised valve actuator" },
  { tag: "11-MOV-501", name: "Tank 501 inlet valve", aliases: "t501 inlet mov motorised valve actuator" },
  { tag: "11-LT-601", name: "Tank 601 level transmitter", aliases: "t601 level gauge lt" },
  { tag: "PUMP-102", name: "Booster pump B", aliases: "booster pump b p102" },
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

  it("returns nothing for unrelated or empty text", () => {
    expect(rankEquipment(registry, "the")).toEqual([]);
    expect(rankEquipment(registry, "compressor 9")).toEqual([]);
  });
});
