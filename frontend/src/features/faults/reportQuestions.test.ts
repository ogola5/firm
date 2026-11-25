import { describe, expect, it } from "vitest";
import { composeReport, looksHazardous, missingFollowUps, problemSentence, visibleFollowUps } from "./reportQuestions";

describe("fault report questions", () => {
  it("asks how far open only when the valve is stuck part-way", () => {
    expect(visibleFollowUps("Won't open / close", {}).map((item) => item.key)).toEqual(["from", "position"]);
    expect(visibleFollowUps("Won't open / close", { position: "Stuck part-way" }).map((item) => item.key)).toContain("percent");
  });

  it("writes the problem sentence from taps", () => {
    expect(problemSentence("Won't open / close", { from: "From SCADA", position: "Stuck part-way", percent: "40" }))
      .toBe("Fails to operate from SCADA; position now stuck part-way, about 40% open.");
    expect(problemSentence("Wrong or no reading", { which: "Tank 601 level", shows: "12.4 m", expected: "9 m", behaviour: "Frozen" }))
      .toBe("Tank 601 level shows 12.4 m; expected about 9 m; reading is frozen.");
    expect(problemSentence("Leaking", {})).toBe("");
  });

  it("requires a description for Other and alarm text for Alarm only", () => {
    expect(missingFollowUps("Other", {})).toEqual(["describe the problem"]);
    expect(missingFollowUps("Alarm only", { alarm: "TK601 HH level" })).toEqual([]);
  });

  it("suggests a hazard for a product leak that is spraying or not contained, or smoke", () => {
    expect(looksHazardous("Leaking", { what: "Product", amount: "Spraying or pooling" })).toBe(true);
    expect(looksHazardous("Leaking", { what: "Water", amount: "Spraying or pooling" })).toBe(false);
    expect(looksHazardous("Noise, vibration or heat", { signs: ["Smell or smoke"] })).toBe(true);
  });

  it("composes the full report with the hazard first", () => {
    const lines = composeReport({
      equipment: "11-MOV-601 · Tank 601 inlet valve", problem: "Won't open / close", answers: { from: "Both", position: "Fully closed" },
      seen: "Seen on SCADA just now.", effect: "Stopped (operation stopped or at risk)", state: "Changed over to standby", hazard: "yes",
      actions: ["Reset from SCADA", "Told the shift supervisor"], notes: "Line 3 transfer delayed", callback: "ext 2231",
    });
    expect(lines[0]).toContain("SAFETY");
    expect(lines).toContain("Fails to operate from SCADA and at the local panel; position now fully closed.");
    expect(lines).toContain("Already done: reset from SCADA, told the shift supervisor.");
    expect(lines.at(-1)).toBe("Reach the reporter on ext 2231.");
  });
});
