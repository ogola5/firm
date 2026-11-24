import { Wrench } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { normalizeUser, type User } from "../auth";
import { API_BASE as API, ApiError, api, isOfflineError } from "../offline/api";
import { networkFetch } from "../offline/network";
import { offlineLogin, rememberOfflineSession } from "../offline/session";
import { getSyncEngine } from "../offline/sync";
import { NetworkSimulator } from "../offline/SyncCentre";

export type DemoAccount = { username: string; role_label: string; section: string };

export function Login({ onLogin }: { onLogin: (user: User) => void }) {
  const [username, setUsername] = useState("operations");
  const [password, setPassword] = useState("demo123");
  const [error, setError] = useState("");
  const [accounts, setAccounts] = useState<DemoAccount[]>([]);
  const navigate = useNavigate();
  useEffect(() => {
    networkFetch(`${API}/api/v1/auth/demo-accounts`).then((response) => response.json()).then(setAccounts).catch(() => setAccounts([]));
  }, []);
  return (
    <main className="login-shell">
      <section className="login-panel">
        <div className="brand-mark"><Wrench size={28} /></div>
        <p className="eyebrow">KPC / MI / 58</p>
        <h1>Maintenance Intelligence</h1>
        <p className="muted">Synthetic demonstration environment</p>
        <form onSubmit={async (event) => {
          event.preventDefault();
          setError("");
          try {
            const result = await api("/api/v1/auth/login", { method: "POST", body: JSON.stringify({ username, password }) });
            localStorage.setItem("kpc-token", result.access_token);
            localStorage.setItem("kpc-user", JSON.stringify(result.user));
            localStorage.removeItem("kpc-offline-session");
            // Keep a password verifier (not the password) so this account can sign in offline later.
            void rememberOfflineSession(username, password, result.user, result.access_token).catch(() => undefined);
            getSyncEngine().resumeAfterLogin();
            onLogin(result.user);
            navigate("/dashboard");
          } catch (reason) {
            if (reason instanceof ApiError) {
              setError(reason.status === 401 ? "Invalid username or password." : reason.message);
              return;
            }
            if (!isOfflineError(reason)) {
              setError("Login unavailable. Confirm the backend is running.");
              return;
            }
            try {
              const session = await offlineLogin(username, password);
              localStorage.setItem("kpc-token", session.token);
              localStorage.setItem("kpc-user", JSON.stringify(session.user));
              localStorage.setItem("kpc-offline-session", session.tokenExpired ? "token-expired" : "1");
              const cachedUser = normalizeUser(session.user);
              if (!cachedUser) throw new Error("The cached session is invalid.");
              onLogin(cachedUser);
              navigate("/dashboard");
            } catch (offlineReason) {
              setError(`No connection. ${offlineReason instanceof Error ? offlineReason.message : "Offline sign-in failed."}`);
            }
          }
        }}>
          <label>Demonstration account
            <select value={accounts.some((account) => account.username === username) ? username : ""} onChange={(e) => setUsername(e.target.value)}>
              <option value="">Enter username manually</option>
              {accounts.map((account) => <option key={account.username} value={account.username}>{account.role_label}{account.section ? ` — ${account.section}` : ""} (${account.username})</option>)}
            </select>
          </label>
          {!accounts.some((account) => account.username === username) && <label>Username<input autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} /></label>}
          <label>Password<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} /></label>
          {error && <p className="error">{error}</p>}
          <button className="primary" type="submit">Sign in</button>
        </form>
        <div className="login-simulator">
          <p className="eyebrow">DEMONSTRATION NETWORK</p>
          <NetworkSimulator compact />
          <p className="muted">Accounts that have signed in here while connected can also sign in offline.</p>
        </div>
      </section>
    </main>
  );
}
