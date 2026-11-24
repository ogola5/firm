/**
 * Network access, reachability and the demonstration network simulator.
 *
 * Every API request goes through `networkFetch`, so the simulator exercises the
 * real offline code paths (local persistence, outbox, retries) rather than only
 * changing a status badge.
 */

export type NetworkMode = "online" | "offline" | "intermittent";

export class NetworkUnavailableError extends Error {
  constructor(message = "The maintenance server cannot be reached. Your work is kept on this device.") {
    super(message);
    this.name = "NetworkUnavailableError";
  }
}

export type ConnectionState = {
  mode: NetworkMode;
  browserOnline: boolean;
  serverReachable: boolean;
  lastCheckedAt: string | null;
  /** True when requests are expected to reach the server. */
  online: boolean;
};

const MODE_KEY = "kpc-network-mode";
const INTERMITTENT_FAILURE_RATE = 0.5;

const storage = (): Storage | undefined => (typeof localStorage === "undefined" ? undefined : localStorage);
const browserOnline = () => (typeof navigator === "undefined" ? true : navigator.onLine);

function readMode(): NetworkMode {
  const stored = storage()?.getItem(MODE_KEY);
  return stored === "offline" || stored === "intermittent" ? stored : "online";
}

let mode: NetworkMode = readMode();
let serverReachable = true;
let lastCheckedAt: string | null = null;
let random: () => number = Math.random;
const listeners = new Set<() => void>();

function notify() {
  listeners.forEach((listener) => listener());
}

export function subscribeConnection(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function connectionState(): ConnectionState {
  const online = mode !== "offline" && browserOnline() && serverReachable;
  return { mode, browserOnline: browserOnline(), serverReachable, lastCheckedAt, online };
}

export function getNetworkMode(): NetworkMode {
  return mode;
}

export function setNetworkMode(next: NetworkMode) {
  mode = next;
  storage()?.setItem(MODE_KEY, next);
  notify();
}

/** Test hook: make intermittent failures deterministic. */
export function setRandomSource(source: () => number) {
  random = source;
}

function markReachable(value: boolean) {
  lastCheckedAt = new Date().toISOString();
  if (value !== serverReachable) {
    serverReachable = value;
    notify();
  }
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function networkFetch(input: string, init?: RequestInit): Promise<Response> {
  if (mode === "offline") throw new NetworkUnavailableError("Offline (network simulator). Your work is kept on this device.");
  if (mode === "intermittent") {
    await delay(150 + random() * 600);
    if (random() < INTERMITTENT_FAILURE_RATE) {
      throw new NetworkUnavailableError("Connection dropped (network simulator: intermittent). Your work is kept on this device.");
    }
  }
  try {
    const response = await fetch(input, init);
    markReachable(true);
    return response;
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    markReachable(false);
    throw new NetworkUnavailableError();
  }
}

/** Checks actual API reachability rather than trusting navigator.onLine. */
export async function checkReachability(apiBase: string, timeoutMs = 4000): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await networkFetch(`${apiBase}/api/v1/health`, { signal: controller.signal, cache: "no-store" });
    markReachable(response.ok);
    return response.ok;
  } catch {
    markReachable(false);
    return false;
  } finally {
    clearTimeout(timer);
  }
}

if (typeof window !== "undefined") {
  window.addEventListener("online", notify);
  window.addEventListener("offline", notify);
}
