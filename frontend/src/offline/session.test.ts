import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../db";
import { OFFLINE_SESSION_DAYS, OfflineLoginError, offlineLogin, rememberOfflineSession, tokenExpiry } from "./session";

const ITERATIONS = 1_000; // fast for tests; production uses PBKDF2_ITERATIONS
const future = Math.floor(Date.now() / 1000) + 3600;
const token = `x.${btoa(JSON.stringify({ sub: "USER-automation", exp: future }))}.y`;

beforeEach(async () => {
  await db.delete();
  await db.open();
});

describe("offline session", () => {
  it("unlocks a previously verified session without storing the password", async () => {
    await rememberOfflineSession("Automation", "demo123", { id: "USER-automation" }, token, ITERATIONS);
    const stored = await db.offlineSessions.get("automation");
    expect(JSON.stringify(stored)).not.toContain("demo123");
    const session = await offlineLogin("automation", "demo123");
    expect(session.user.id).toBe("USER-automation");
    expect(session.tokenExpired).toBe(false);
  });

  it("rejects a wrong password and unknown accounts", async () => {
    await rememberOfflineSession("automation", "demo123", { id: "USER-automation" }, token, ITERATIONS);
    await expect(offlineLogin("automation", "wrong")).rejects.toBeInstanceOf(OfflineLoginError);
    await expect(offlineLogin("operations", "demo123")).rejects.toThrow(/has not signed in on this device/);
  });

  it("expires offline access and reports an expired server token", async () => {
    await rememberOfflineSession("automation", "demo123", { id: "USER-automation" }, token, ITERATIONS);
    const later = Date.now() + (OFFLINE_SESSION_DAYS + 1) * 86_400_000;
    await expect(offlineLogin("automation", "demo123", later)).rejects.toThrow(/expired/);
    const afterTokenExpiry = (future + 60) * 1000;
    expect((await offlineLogin("automation", "demo123", afterTokenExpiry)).tokenExpired).toBe(true);
  });

  it("reads the JWT expiry", () => {
    expect(tokenExpiry(token)).toBe(new Date(future * 1000).toISOString());
    expect(tokenExpiry("garbage")).toBeNull();
  });
});
