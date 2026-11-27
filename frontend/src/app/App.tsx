import { useEffect, useState } from "react";
import { Route, Routes } from "react-router-dom";
import { Toaster } from "../components/ui/toaster";
import { normalizeUser, type User } from "../auth";
import { DemoMailbox } from "../features/account/DemoMailbox";
import { Tour } from "../features/tour/Tour";
import { Enrol } from "../features/account/Enrol";
import { ResetPassword } from "../features/account/ResetPassword";
import { API_BASE as API, SESSION_ENDED } from "../offline/api";
import { networkFetch } from "../offline/network";
import { queryClient } from "../lib/query";
import { Login, SIGNED_OUT_REASON } from "./Login";
import { registerServiceWorker } from "./pwa";
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
  useEffect(() => registerServiceWorker(), []);
  useEffect(() => {
    const token = localStorage.getItem("kpc-token");
    if (!user || !token) return;
    networkFetch(`${API}/api/v1/auth/me`, { headers: { Authorization: `Bearer ${token}` } })
      .then(async (response) => {
        if (localStorage.getItem("kpc-token") !== token) return null;
        if (response.status === 401) {
          const reason = await response.json().then((body: { detail?: unknown }) => String(body.detail ?? ""), () => "");
          endSession(reason);
          return null;
        }
        if (!response.ok) throw new Error(`Session refresh failed: ${response.status}`);
        return response.json();
      })
      .then((freshUser) => {
        // Ignore a late answer for a session the user has already left.
        if (!freshUser || localStorage.getItem("kpc-token") !== token) return;
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
  /** The server refused this session: sign out and tell the person why on the sign-in page. */
  function endSession(reason: string) {
    if (reason) sessionStorage.setItem(SIGNED_OUT_REASON, reason);
    logout();
  }
  useEffect(() => {
    const onEnded = (event: Event) => endSession(String((event as CustomEvent<string>).detail ?? ""));
    window.addEventListener(SESSION_ENDED, onEnded);
    return () => window.removeEventListener(SESSION_ENDED, onEnded);
  }, []);
  return (
    <>
    <Routes>
      {/* Demonstration only: where the prototype's emails go (no real mail is sent). */}
      <Route path="/mailbox" element={<DemoMailbox />} />
      {/* Guided demo for presentations (switches between demonstration accounts). */}
      <Route path="/tour" element={<Tour />} />
      {user
        ? <Route path="*" element={<Shell user={user} onLogout={logout} />} />
        : <>
          <Route path="/enrol" element={<Enrol onLogin={setUser} />} />
          <Route path="/reset-password" element={<ResetPassword />} />
          <Route path="*" element={<Login onLogin={setUser} />} />
        </>}
    </Routes>
    <Toaster />
    </>
  );
}
