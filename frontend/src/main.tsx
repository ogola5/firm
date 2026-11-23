import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, NavLink, Route, Routes, useNavigate } from "react-router-dom";
import { AlertTriangle, BookOpen, Gauge, LogOut, Radio, RefreshCw, Search, ShieldCheck, Wrench } from "lucide-react";
import { db } from "./db";
import "./styles.css";

const API = "http://localhost:8000";

type User = { id: string; username: string; display_name: string; role: string; section: string };

async function api(path: string, options: RequestInit = {}) {
  const token = localStorage.getItem("kpc-token");
  const response = await fetch(`${API}${path}`, {
    ...options,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...options.headers },
  });
  if (!response.ok) throw new Error(await response.text());
  return response.json();
}

function Login({ onLogin }: { onLogin: (user: User) => void }) {
  const [username, setUsername] = useState("operations");
  const [password, setPassword] = useState("demo123");
  const [error, setError] = useState("");
  const navigate = useNavigate();
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
            onLogin(result.user);
            navigate("/dashboard");
          } catch {
            setError("Login unavailable. Confirm the backend is running.");
          }
        }}>
          <label>Demonstration account
            <select value={username} onChange={(e) => setUsername(e.target.value)}>
              {["operations", "automation", "electrical", "instrumentation", "mechanical", "supervisor", "management", "admin"].map((role) => <option key={role} value={role}>{role}</option>)}
            </select>
          </label>
          <label>Password<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} /></label>
          {error && <p className="error">{error}</p>}
          <button className="primary" type="submit">Sign in</button>
        </form>
      </section>
    </main>
  );
}

function Shell({ user, onLogout }: { user: User; onLogout: () => void }) {
  const [online, setOnline] = useState(navigator.onLine);
  const [pending, setPending] = useState(0);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    db.pendingEvents.where("sync_status").equals("PENDING").count().then(setPending);
    return () => { window.removeEventListener("online", update); window.removeEventListener("offline", update); };
  }, []);

  async function syncNow() {
    const events = await db.pendingEvents.where("sync_status").equals("PENDING").toArray();
    if (!events.length) return;
    try {
      await api("/api/v1/sync/events", { method: "POST", body: JSON.stringify(events) });
      await db.pendingEvents.bulkPut(events.map((event) => ({ ...event, sync_status: "SYNCED" as const })));
      setPending(0);
    } catch {
      setPending(events.length);
    }
  }

  return (
    <div className="app-shell">
      <aside>
        <div className="side-brand"><Wrench size={22} /><strong>KPC Maintenance</strong></div>
        <nav>
          <NavLink to="/dashboard"><Gauge size={18} /> Dashboard</NavLink>
          <NavLink to="/equipment"><Search size={18} /> Equipment</NavLink>
          <NavLink to="/faults"><AlertTriangle size={18} /> Faults</NavLink>
          <NavLink to="/knowledge"><BookOpen size={18} /> Knowledge</NavLink>
          {user.role === "Supervisor" && <NavLink to="/approvals"><ShieldCheck size={18} /> Approvals</NavLink>}
        </nav>
        <div className="side-user">
          <div className={`status-dot ${online ? "online" : "offline"}`} />
          <div><strong>{user.display_name}</strong><span>{user.role}</span></div>
          <button className="icon-button" onClick={onLogout} aria-label="Log out"><LogOut size={17} /></button>
        </div>
      </aside>
      <main>
        <header>
          <div className="network-status"><Radio size={15} /> {online ? "Connected" : "Offline mode"}</div>
          <button className="secondary" onClick={syncNow}><RefreshCw size={16} /> Sync now <span className="count">{pending}</span></button>
        </header>
        <Routes>
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/equipment" element={<Equipment />} />
          <Route path="/faults" element={<Faults user={user} />} />
          <Route path="/knowledge" element={<Knowledge />} />
          <Route path="/approvals" element={<Knowledge approvals />} />
          <Route path="*" element={<Dashboard />} />
        </Routes>
      </main>
    </div>
  );
}

function Dashboard() {
  const [data, setData] = useState<Record<string, number | string | Record<string, number> | null> | null>(null);
  useEffect(() => { api("/api/v1/analytics/overview").then(setData).catch(() => setData(null)); }, []);
  if (!data) return <section className="page"><h2>Management overview</h2><div className="empty">Backend data is unavailable. Cached view may be used after reconnecting.</div></section>;
  const categories = (data.by_category as Record<string, number>) || {};
  return (
    <section className="page">
      <div className="page-heading"><div><p className="eyebrow">ILLUSTRATIVE DEMONSTRATION DATA</p><h2>Operational overview</h2></div></div>
      <div className="metrics">
        <Metric label="Total faults" value={String(data.total_faults)} />
        <Metric label="Open faults" value={String(data.open_faults)} />
        <Metric label="Resolved faults" value={String(data.resolved_faults)} />
        <Metric label="Approved knowledge" value={String(data.approved_knowledge)} />
      </div>
      <div className="grid-two">
        <div className="panel"><h3>Faults by category</h3>{Object.entries(categories).map(([name, value]) => <Bar key={name} label={name} value={value} max={Math.max(...Object.values(categories))} />)}</div>
        <div className="panel"><h3>Maintenance performance</h3>
          <dl className="kpis"><div><dt>Mean acknowledgement</dt><dd>{String(data.mean_time_acknowledge_minutes ?? "—")} min</dd></div><div><dt>Mean restoration</dt><dd>{String(data.mean_time_restore_hours ?? "—")} h</dd></div><div><dt>Knowledge entries</dt><dd>{String(data.knowledge_entries)}</dd></div></dl>
        </div>
      </div>
    </section>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="metric"><span>{label}</span><strong>{value}</strong></div>;
}

function Bar({ label, value, max }: { label: string; value: number; max: number }) {
  return <div className="bar-row"><span>{label}</span><div className="track"><div style={{ width: `${(value / max) * 100}%` }} /></div><strong>{value}</strong></div>;
}

function Equipment() {
  const [search, setSearch] = useState("");
  const [items, setItems] = useState<Array<Record<string, unknown>>>([]);
  useEffect(() => {
    api(`/api/v1/equipment?search=${encodeURIComponent(search)}`).then(async (rows) => {
      setItems(rows);
      await db.equipment.clear();
      await db.equipment.bulkPut(rows as never[]);
    }).catch(async () => setItems(await db.equipment.toArray()));
  }, [search]);
  return (
    <section className="page">
      <div className="page-heading"><div><p className="eyebrow">SIMULATED ASSET REGISTRY</p><h2>Equipment</h2></div></div>
      <div className="toolbar"><div className="search"><Search size={17} /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search tag or name" /></div></div>
      <div className="table panel"><table><thead><tr><th>Tag</th><th>Name</th><th>Station</th><th>Section</th><th>Criticality</th></tr></thead><tbody>{items.map((item) => <tr key={String(item.id)}><td><strong>{String(item.tag)}</strong></td><td>{String(item.name)}</td><td>{String(item.station)}</td><td>{String(item.section)}</td><td><span className="tag">{String(item.criticality)}</span></td></tr>)}</tbody></table></div>
    </section>
  );
}

function Faults({ user }: { user: User }) {
  const [faults, setFaults] = useState<Array<Record<string, unknown>>>([]);
  const [equipment, setEquipment] = useState<Array<Record<string, unknown>>>([]);
  const [equipmentId, setEquipmentId] = useState("");
  const [symptom, setSymptom] = useState("Unexpected trip");
  const [severity, setSeverity] = useState("Medium");
  const [message, setMessage] = useState("");
  useEffect(() => {
    api("/api/v1/equipment").then(setEquipment).catch(() => setEquipment([]));
    api("/api/v1/faults").then((rows) => { setFaults(rows); db.faults.clear().then(() => db.faults.bulkPut(rows as never[])); }).catch(async () => setFaults(await db.faults.toArray()));
  }, []);

  async function report() {
    if (!equipmentId) return;
    const payload = { equipment_id: equipmentId, category: "Electrical", symptom, severity, description: "Reported through fast-report workflow", operational_impact: "" };
    try {
      const created = await api("/api/v1/faults", { method: "POST", body: JSON.stringify(payload) });
      setMessage(`Fault reported: ${created.reference}`);
    } catch {
      const eventId = crypto.randomUUID();
      await db.pendingEvents.put({ event_id: eventId, event_type: "FAULT_REPORTED", actor_id: user.id, client_timestamp: new Date().toISOString(), sequence_number: 1, sync_status: "PENDING", payload });
      setMessage("Fault saved offline and queued for synchronisation.");
    }
  }

  return (
    <section className="page">
      <div className="page-heading"><div><p className="eyebrow">FAULT WORKFLOW</p><h2>Faults</h2></div></div>
      {user.role === "Operations" && <div className="panel quick-report"><h3>Fast report</h3><div className="form-grid"><label>Equipment<select value={equipmentId} onChange={(e) => setEquipmentId(e.target.value)}><option value="">Select equipment</option>{equipment.map((e) => <option key={String(e.id)} value={String(e.id)}>{String(e.tag)} — {String(e.name)}</option>)}</select></label><label>Symptom<select value={symptom} onChange={(e) => setSymptom(e.target.value)}>{["Unexpected trip", "Intermittent alarm", "Unstable reading", "Failure to start"].map((v) => <option key={v}>{v}</option>)}</select></label><label>Severity<select value={severity} onChange={(e) => setSeverity(e.target.value)}>{["Low", "Medium", "High", "Critical"].map((v) => <option key={v}>{v}</option>)}</select></label></div><button className="primary" onClick={report}>Submit fault</button>{message && <p className="confirmation">{message}</p>}</div>}
      <div className="table panel"><table><thead><tr><th>Reference</th><th>Equipment</th><th>Symptom</th><th>Severity</th><th>Status</th><th>Section</th></tr></thead><tbody>{faults.map((f) => <tr key={String(f.id)}><td><strong>{String(f.reference)}</strong></td><td>{String(f.equipment_tag)}</td><td>{String(f.symptom)}</td><td><span className={`severity ${String(f.severity).toLowerCase()}`}>{String(f.severity)}</span></td><td>{String(f.status)}</td><td>{String(f.assigned_section || "Unassigned")}</td></tr>)}</tbody></table></div>
    </section>
  );
}

function Knowledge({ approvals = false }: { approvals?: boolean }) {
  const [items, setItems] = useState<Array<Record<string, unknown>>>([]);
  const [search, setSearch] = useState("");
  useEffect(() => {
    api(`/api/v1/knowledge?${approvals ? "status_filter=SUBMITTED" : `search=${encodeURIComponent(search)}`}`).then(async (rows) => { setItems(rows); await db.knowledge.clear(); await db.knowledge.bulkPut(rows as never[]); }).catch(async () => setItems((await db.knowledge.filter((entry) => approvals ? entry.status === "SUBMITTED" : true).toArray())));
  }, [search, approvals]);
  return (
    <section className="page">
      <div className="page-heading"><div><p className="eyebrow">MAINTENANCE KNOWLEDGE</p><h2>{approvals ? "Supervisor approvals" : "Knowledge library"}</h2></div></div>
      {!approvals && <div className="toolbar"><div className="search"><Search size={17} /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search symptom or cause" /></div></div>}
      <div className="knowledge-grid">{items.map((item) => <article className="knowledge-card" key={String(item.id)}><div className="card-top"><span className={`status ${String(item.status).toLowerCase()}`}>{String(item.status)}</span><small>{String(item.reference)} · v{String(item.version)}</small></div><h3>{String(item.title)}</h3><p><strong>Symptom:</strong> {String(item.symptom)}</p><p><strong>Cause:</strong> {String(item.confirmed_cause)}</p><p><strong>Action:</strong> {String(item.corrective_action)}</p>{approvals && <div className="card-actions"><button className="secondary">Request correction</button><button className="primary">Approve</button></div>}</article>)}</div>
    </section>
  );
}

function App() {
  const [user, setUser] = useState<User | null>(() => {
    const saved = localStorage.getItem("kpc-user");
    return saved ? JSON.parse(saved) : null;
  });
  useEffect(() => {
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => undefined);
  }, []);
  function logout() {
    localStorage.removeItem("kpc-token");
    localStorage.removeItem("kpc-user");
    setUser(null);
  }
  return user ? <Shell user={user} onLogout={logout} /> : <Login onLogin={setUser} />;
}

createRoot(document.getElementById("root")!).render(<BrowserRouter><App /></BrowserRouter>);
