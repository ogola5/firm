/**
 * Offline sign-in for previously authenticated demonstration users.
 *
 * After a successful online login the device keeps a PBKDF2-SHA-256 verifier of
 * the password (never the password itself), the user profile and the server
 * session token. While offline, the same username and password unlock that
 * cached session for up to OFFLINE_SESSION_DAYS since the last online sign-in.
 * Offline sessions can only read cached data and queue changes; the server
 * re-checks every queued change, and an expired token must be renewed online
 * before anything is synchronised.
 */
import { db, type OfflineSession } from "../db";

export const PBKDF2_ITERATIONS = 210_000;
export const OFFLINE_SESSION_DAYS = 7;

const encoder = new TextEncoder();

const toBase64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const fromBase64 = (value: string) => Uint8Array.from(atob(value), (char) => char.charCodeAt(0));

async function deriveVerifier(password: string, salt: Uint8Array, iterations: number): Promise<string> {
  const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, key, 256);
  return toBase64(new Uint8Array(bits));
}

function constantTimeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return difference === 0;
}

export function tokenExpiry(token: string): string | null {
  try {
    const payload = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))) as { exp?: number };
    return payload.exp ? new Date(payload.exp * 1000).toISOString() : null;
  } catch {
    return null;
  }
}

export async function rememberOfflineSession(
  username: string, password: string, user: Record<string, unknown>, token: string,
  iterations = PBKDF2_ITERATIONS,
): Promise<void> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const session: OfflineSession = {
    username: username.toLowerCase(),
    salt: toBase64(salt),
    verifier: await deriveVerifier(password, salt, iterations),
    iterations,
    user,
    token,
    token_expires_at: tokenExpiry(token),
    verified_online_at: new Date().toISOString(),
  };
  await db.offlineSessions.put(session);
}

export class OfflineLoginError extends Error {}

export async function offlineLogin(
  username: string, password: string, now = Date.now(),
): Promise<{ user: Record<string, unknown>; token: string; tokenExpired: boolean }> {
  const session = await db.offlineSessions.get(username.toLowerCase());
  if (!session) {
    throw new OfflineLoginError("This account has not signed in on this device while connected, so it cannot be used offline.");
  }
  const ageDays = (now - Date.parse(session.verified_online_at)) / 86_400_000;
  if (ageDays > OFFLINE_SESSION_DAYS) {
    throw new OfflineLoginError(`Offline access expired. Sign in while connected (offline access lasts ${OFFLINE_SESSION_DAYS} days).`);
  }
  const candidate = await deriveVerifier(password, fromBase64(session.salt), session.iterations);
  if (!constantTimeEqual(candidate, session.verifier)) throw new OfflineLoginError("Wrong email or password.");
  const tokenExpired = Boolean(session.token_expires_at && Date.parse(session.token_expires_at) <= now);
  return { user: session.user, token: session.token, tokenExpired };
}

export async function forgetOfflineSession(username: string): Promise<void> {
  await db.offlineSessions.delete(username.toLowerCase());
}
