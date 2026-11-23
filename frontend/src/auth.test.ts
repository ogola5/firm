import { describe, expect, it } from "vitest";
import { normalizeUser } from "./auth";

describe("normalizeUser", () => {
  it("adds role permissions to a pre-role-model cached user", () => {
    const user = normalizeUser({
      id: "USER-operations",
      username: "operations",
      display_name: "Demo Operations User",
      role: "Operations",
      section: "",
    });

    expect(user?.role).toBe("operations");
    expect(user?.permissions).toContain("faults.report");
    expect(user?.role_label).toBe("Operations");
  });

  it("keeps the authoritative permission list from a current session", () => {
    const user = normalizeUser({
      id: "USER-hr",
      username: "hr",
      role: "hr_officer",
      role_label: "HR Officer",
      permissions: ["people.read"],
    });

    expect(user?.permissions).toEqual(["people.read"]);
  });

  it("rejects malformed cached user data", () => {
    expect(normalizeUser({ role: "operations" })).toBeNull();
  });
});
