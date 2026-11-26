import { describe, expect, it } from "vitest";
import { hasChanges, lineDiff } from "./lineDiff";

describe("lineDiff", () => {
  it("keeps unchanged steps and marks an added step", () => {
    const before = "1. Manual dip.\n2. Open the housing.";
    const after = "1. Manual dip.\n2. Open the housing.\n3. Check the cable gland.";
    expect(lineDiff(before, after)).toEqual([
      { type: "same", text: "1. Manual dip." },
      { type: "same", text: "2. Open the housing." },
      { type: "added", text: "3. Check the cable gland." },
    ]);
  });

  it("shows a reworded step as removed then added", () => {
    const diff = lineDiff("Replace the seal.", "Replace the seal; confirm vibration below 4.5 mm/s.");
    expect(diff.map((line) => line.type)).toEqual(["removed", "added"]);
    expect(hasChanges(diff)).toBe(true);
  });

  it("ignores blank lines and surrounding spaces", () => {
    expect(hasChanges(lineDiff("  Step one \n\nStep two", "Step one\nStep two\n"))).toBe(false);
  });

  it("handles empty texts", () => {
    expect(lineDiff("", "New safety note")).toEqual([{ type: "added", text: "New safety note" }]);
    expect(lineDiff("Old note", "")).toEqual([{ type: "removed", text: "Old note" }]);
  });
});
