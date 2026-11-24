import { NetworkUnavailableError, networkFetch } from "./network";

/** Empty by default: the app calls same-origin /api/... and the server proxies it. */
export const API_BASE: string = import.meta.env.VITE_API_URL ?? "";

export class ApiError extends Error {
  constructor(public status: number, public detail: string) {
    super(detail || `Request failed (${status})`);
    this.name = "ApiError";
  }
}

export function getToken(): string | null {
  return typeof localStorage === "undefined" ? null : localStorage.getItem("kpc-token");
}

export function isOfflineError(error: unknown): error is NetworkUnavailableError {
  return error instanceof NetworkUnavailableError;
}

async function errorDetail(response: Response): Promise<string> {
  const text = await response.text();
  try {
    const parsed = JSON.parse(text) as { detail?: unknown };
    if (typeof parsed.detail === "string") return parsed.detail;
    if (Array.isArray(parsed.detail)) {
      return parsed.detail.map((item) => (item as { msg?: string }).msg ?? String(item)).join("; ");
    }
  } catch {
    // not JSON
  }
  return text;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function api<T = any>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken();
  const response = await networkFetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      ...(options.body instanceof FormData ? {} : { "Content-Type": "application/json" }),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });
  if (!response.ok) throw new ApiError(response.status, await errorDetail(response));
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}
