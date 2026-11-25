import { describe, expect, it } from "vitest";
import { companyEmail, companyEmailProblem } from "./companyEmail";

describe("company email", () => {
  it("accepts KPC addresses and lower-cases them", () => {
    expect(companyEmailProblem("Jane.Wanjiru@KPC.co.ke")).toBeNull();
    expect(companyEmail.parse("  Jane.Wanjiru@KPC.co.ke ")).toBe("jane.wanjiru@kpc.co.ke");
  });

  it.each(["jane@gmail.com", "jane@kpc.co.ke.evil.com", "jane@mail.kpc.co.ke", "jane@@kpc.co.ke", "jane", "jane..w@kpc.co.ke", "jane+x@kpc.co.ke", ".jane@kpc.co.ke"])(
    "refuses %s", (value) => {
      expect(companyEmailProblem(value)).not.toBeNull();
    },
  );

  it("says why an outside address is refused", () => {
    expect(companyEmailProblem("jane@gmail.com")).toContain("@kpc.co.ke");
  });
});
