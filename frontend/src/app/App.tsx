import { useEffect, useState } from "react";
import { normalizeUser, type User } from "../auth";
import { API_BASE as API } from "../offline/api";
import { networkFetch } from "../offline/network";
import { queryClient } from "../lib/query";
import { Login } from "./Login";
import { Shell } from "./Shell";

export function App() {
  const [user, setUser] = useState<User | null>(() => {
    const saved = localStorage.getItem("kpc-user");
    if (!saved) return null;
    try {
      return normalizeUser(JSON.parse(saved));
    } catch (error) {
      console.warn("Ignoring malformed cached demo user.", error);
      return null;
    }
  });
  useEffect(() => {
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => undefined);
  }, []);
  useEffect(() => {
    const token = localStorage.getItem("kpc-token");
    if (!user || !token) return;
    networkFetch(`${API}/api/v1/auth/me`, { headers: { Authorization: `Bearer ${token}` } })
      .then(async (response) => {
        if (response.status === 401) {
          localStorage.removeItem("kpc-token");
          localStorage.removeItem("kpc-user");
          setUser(null);
          return null;
        }
        if (!response.ok) throw new Error(`Session refresh failed: ${response.status}`);
        return response.json();
      })
      .then((freshUser) => {
        if (!freshUser) return;
        const normalized = normalizeUser(freshUser);
        if (!normalized) throw new Error("The server returned an invalid user session");
        localStorage.setItem("kpc-user", JSON.stringify(normalized));
        // The server accepted the session again, so it is no longer an offline-only sign-in.
        localStorage.removeItem("kpc-offline-session");
        setUser(normalized);
      })
      .catch((error: unknown) => console.warn("Keeping the cached demo session; server validation is unavailable.", error));
  }, []);
  function logout() {
    localStorage.removeItem("kpc-token");
    localStorage.removeItem("kpc-user");
    // Never show one user's loaded data to the next person on a shared device.
    queryClient.clear();
    setUser(null);
  }
  return user ? <Shell user={user} onLogout={logout} /> : <Login onLogin={setUser} />;
}
