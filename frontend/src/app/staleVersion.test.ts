import { describe, expect, it } from "vitest";
import { isStaleVersionError } from "./staleVersion";

describe("isStaleVersionError", () => {
  it("recognises a screen file from a previous version that no longer loads", () => {
    expect(isStaleVersionError(new TypeError("Failed to fetch dynamically imported module: https://x/assets/Dashboard-CthGBGhP.js"))).toBe(true);
    expect(isStaleVersionError(new TypeError("Importing a module script failed."))).toBe(true); // Safari
    expect(isStaleVersionError(new TypeError("error loading dynamically imported module"))).toBe(true); // Firefox
  });

  it("ignores ordinary errors, so they are not hidden by a reload", () => {
    expect(isStaleVersionError(new Error("Network request failed"))).toBe(false);
    expect(isStaleVersionError(undefined)).toBe(false);
  });
});
