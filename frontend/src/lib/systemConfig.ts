import { useQuery } from "@tanstack/react-query";
import { API_BASE } from "../offline/api";
import { networkFetch } from "../offline/network";

export type SystemConfig = { banner: string; features: { guided_demo: boolean; network_simulator: boolean } };

const FALLBACK: SystemConfig = { banner: "", features: { guided_demo: true, network_simulator: true } };

/** The banner and feature switches set in the admin console. Works before sign-in; offline, the defaults. */
export function useSystemConfig(): SystemConfig {
  const query = useQuery({
    queryKey: ["system-config"],
    queryFn: async () => {
      const response = await networkFetch(`${API_BASE}/api/v1/system/config`);
      if (!response.ok) throw new Error("config unavailable");
      return (await response.json()) as SystemConfig;
    },
    staleTime: 60_000,
    refetchInterval: 300_000,
    retry: false,
  });
  return query.data ?? FALLBACK;
}

/** "View as": the developer's own session, kept while looking at someone else's screens (read-only). */
export const VIEW_AS_RETURN = "kpc-view-as-return";
type Saved = { token: string | null; user: string | null; viewer: string; viewing: string };

export function viewingAs(): Saved | null {
  try {
    return JSON.parse(localStorage.getItem(VIEW_AS_RETURN) || "null") as Saved | null;
  } catch {
    return null;
  }
}

export function startViewAs(result: { access_token: string; user: { display_name?: string }; viewer: string }) {
  localStorage.setItem(VIEW_AS_RETURN, JSON.stringify({
    token: localStorage.getItem("kpc-token"), user: localStorage.getItem("kpc-user"),
    viewer: result.viewer, viewing: result.user.display_name ?? "",
  } satisfies Saved));
  localStorage.setItem("kpc-token", result.access_token);
  localStorage.setItem("kpc-user", JSON.stringify(result.user));
  window.location.assign("/dashboard");
}

export function stopViewAs() {
  const saved = viewingAs();
  localStorage.removeItem(VIEW_AS_RETURN);
  if (saved?.token && saved.user) {
    localStorage.setItem("kpc-token", saved.token);
    localStorage.setItem("kpc-user", saved.user);
    window.location.assign("/admin?tab=developer");
  } else {
    localStorage.removeItem("kpc-token");
    localStorage.removeItem("kpc-user");
    window.location.assign("/");
  }
}
