import { QueryClient } from "@tanstack/react-query";
import { ApiError, isOfflineError } from "../offline/api";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Our API layer (and the network simulator) decides what "offline" means,
      // so queries must not pause on navigator.onLine.
      networkMode: "always",
      staleTime: 30_000,
      refetchOnWindowFocus: false,
      retry: (failureCount, error: unknown) => {
        if (failureCount >= 2 || isOfflineError(error)) return false;
        return !(error instanceof ApiError && error.status < 500);
      },
    },
    mutations: { networkMode: "always" },
  },
});

export type MaybeCached<T> = { data: T; fromCache: boolean };

/** Loads from the server; when the server cannot be reached, returns the device copy instead. */
export async function withOfflineFallback<T>(
  online: () => Promise<T>,
  cached: () => Promise<T | undefined>,
): Promise<MaybeCached<T>> {
  try {
    return { data: await online(), fromCache: false };
  } catch (error) {
    if (!isOfflineError(error)) throw error;
    const local = await cached();
    if (local === undefined) throw error;
    return { data: local, fromCache: true };
  }
}

export function errorMessage(error: unknown, fallback = "Something went wrong."): string {
  return error instanceof Error && error.message ? error.message : fallback;
}
