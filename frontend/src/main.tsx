import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, NavLink, Route, Routes, useNavigate } from "react-router-dom";
import { AlertTriangle, BookOpen, Gauge, LogOut, Radio, RefreshCw, Search, ShieldCheck, Wrench } from "lucide-react";
import { db } from "./db";
import { normalizeUser, type User } from "./auth";
import "./styles.css";

const API = "http://localhost:8000";

type DemoAccount = { username: string; role_label: string; section: string };

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
  const [accounts, setAccounts] = useState<DemoAccount[]>([]);
  const navigate = useNavigate();
  useEffect(() => {
    fetch(`${API}/api/v1/auth/demo-accounts`).then((response) => response.json()).then(setAccounts).catch(() => setAccounts([]));
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
            onLogin(result.user);
            navigate("/dashboard");
          } catch {
            setError("Login unavailable. Confirm the backend is running.");
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

  const peopleOnly = user.role === "hr_officer";
  const executiveOnly = user.role === "managing_director" || user.role === "management";
  const canSeeMaintenance = !peopleOnly && !executiveOnly;
  const canManageUsers = user.role === "system_administrator";
  const canSeePeople = canManageUsers || peopleOnly;
  const canReviewProcedures = ["technician_ct", "chief_engineer", "supervisor"].includes(user.role);

  return (
    <div className="app-shell">
      <aside>
        <div className="side-brand"><Wrench size={22} /><strong>KPC Maintenance</strong></div>
        <nav>
          <NavLink to="/dashboard"><Gauge size={18} /> {executiveOnly ? "Executive summary" : peopleOnly ? "Workforce overview" : "Dashboard"}</NavLink>
          {canSeeMaintenance && (user.permissions || []).includes("equipment.read") && <NavLink to="/equipment"><Search size={18} /> Equipment</NavLink>}
          {canSeeMaintenance && (user.permissions || []).includes("faults.read") && <NavLink to="/faults"><AlertTriangle size={18} /> Faults</NavLink>}
          {canSeeMaintenance && (user.permissions || []).includes("knowledge.read") && <NavLink to="/knowledge"><BookOpen size={18} /> Knowledge</NavLink>}
          {canSeeMaintenance && canReviewProcedures && <NavLink to="/approvals"><ShieldCheck size={18} /> Procedure review</NavLink>}
          {canSeePeople && <NavLink to="/people"><ShieldCheck size={18} /> {canManageUsers ? "User management" : "People directory"}</NavLink>}
        </nav>
        <div className="side-user">
          <div className={`status-dot ${online ? "online" : "offline"}`} />
          <div><strong>{user.display_name}</strong><span>{user.role_label}{user.section ? ` · ${user.section}` : ""}</span></div>
          <button className="icon-button" onClick={onLogout} aria-label="Log out"><LogOut size={17} /></button>
        </div>
      </aside>
      <main>
        <header>
          <div className="network-status"><Radio size={15} /> {online ? "Connected" : "Offline mode"}</div>
          <button className="secondary" onClick={syncNow}><RefreshCw size={16} /> Sync now <span className="count">{pending}</span></button>
        </header>
        <Routes>
          <Route path="/dashboard" element={<Dashboard user={user} />} />
          {canSeeMaintenance && (user.permissions || []).includes("equipment.read") && <Route path="/equipment" element={<Equipment user={user} />} />}
          {canSeeMaintenance && (user.permissions || []).includes("faults.read") && <Route path="/faults" element={<Faults user={user} />} />}
          {canSeeMaintenance && (user.permissions || []).includes("knowledge.read") && <Route path="/knowledge" element={<Knowledge user={user} />} />}
          {canSeeMaintenance && canReviewProcedures && <Route path="/approvals" element={<ProcedureReview user={user} />} />}
          {canSeePeople && <Route path="/people" element={<People user={user} />} />}
          <Route path="*" element={<Dashboard user={user} />} />
        </Routes>
      </main>
    </div>
  );
}

function Dashboard({ user }: { user: User }) {
  const [data, setData] = useState<Record<string, unknown> | null>(null);
  useEffect(() => {
    if (user.role !== "hr_officer") api("/api/v1/analytics/overview").then(setData).catch(() => setData(null));
  }, [user.role]);
  if (user.role === "hr_officer") return <section className="page"><div className="page-heading"><div><p className="eyebrow">PEOPLE AND APPRAISAL EVIDENCE</p><h2>Workforce overview</h2><p className="muted">HR can review attributed work contributions and time measures without opening individual fault records.</p></div></div><People user={user} compact /><RecognitionPanel /></section>;
  if (!data) return <section className="page"><h2>{user.role === "managing_director" ? "Executive summary" : user.role === "hr_officer" ? "Workforce overview" : "Management overview"}</h2><div className="empty">Summary data is unavailable. Reconnect and try again.</div></section>;
  const categories = (data.by_category as Record<string, number>) || {};
  const executive = user.role === "managing_director" || user.role === "management";
  const workflow = data.workflow as WorkflowReport | undefined;
  return (
    <section className="page">
      <div className="page-heading"><div><p className="eyebrow">ILLUSTRATIVE DEMONSTRATION DATA</p><h2>{executive ? "Executive summary" : user.role === "general_manager_om" ? "Operations & Maintenance workflow" : user.section ? `${user.section} overview` : "Operational overview"}</h2><p className="muted">{String(data.view_level || "Summary")} · not verified operating performance</p></div></div>
      <div className="metrics">
        <Metric label="Total faults" value={String(data.total_faults)} />
        <Metric label="Open faults" value={String(data.open_faults)} />
        <Metric label="Resolved faults" value={String(data.resolved_faults)} />
        <Metric label={executive ? "Resolved rate" : "Approved knowledge"} value={executive ? `${String(data.resolved_rate_percent ?? 0)}%` : String(data.approved_knowledge)} />
      </div>
      {!executive && <div className="grid-two">
        <div className="panel"><h3>Faults by category</h3>{Object.entries(categories).map(([name, value]) => <Bar key={name} label={name} value={value} max={Math.max(...Object.values(categories))} />)}</div>
        <div className="panel"><h3>Maintenance performance</h3>
          <dl className="kpis"><div><dt>Mean acknowledgement</dt><dd>{String(data.mean_time_acknowledge_minutes ?? "—")} min</dd></div><div><dt>Mean restoration</dt><dd>{String(data.mean_time_restore_hours ?? "—")} h</dd></div><div><dt>Knowledge entries</dt><dd>{String(data.knowledge_entries)}</dd></div></dl>
        </div>
      </div>}
      {workflow && <WorkflowPanel workflow={workflow} />}
      {["maintenance_manager", "general_manager_om", "system_administrator"].includes(user.role) && <PeopleSummary />}
      {["maintenance_manager", "general_manager_om", "hr_officer", "supervisor", "system_administrator"].includes(user.role) && <RecognitionPanel />}
      {executive && <div className="panel"><h3>Access level</h3><p>Enterprise summary KPIs only. Individual fault timelines, equipment records, and employee directory details are restricted to operational and HR roles.</p></div>}
    </section>
  );
}

type WorkflowReport = {
  stages?: Record<string, number>;
  handoffs_by_section?: Record<string, Record<string, number>>;
  critical_window_minutes?: Record<string, number | null>;
  resolution_comparison?: Record<string, number | string | null>;
  wrong_section_first_assignments?: number;
  wrong_first_assignment_rate_percent?: number | null;
  mean_report_to_triage_minutes?: number | null;
  mean_report_to_acknowledge_minutes?: number | null;
  mean_report_to_restore_hours?: number | null;
  timing_note?: string;
};

function WorkflowPanel({ workflow }: { workflow: WorkflowReport }) {
  const stages = workflow.stages || {};
  const handoffs = workflow.handoffs_by_section || {};
  const critical = workflow.critical_window_minutes || {};
  const comparison = workflow.resolution_comparison || {};
  const flow = [
    ["Operations reports", "reported"],
    ["Systems Automation triages", "triaged"],
    ["Section assigned", "assigned"],
    ["Section acknowledges", "acknowledged"],
    ["Fault restored", "restored"],
  ] as const;
  const metrics = [
    ["Wrong first-section assignments", `${String(workflow.wrong_section_first_assignments ?? 0)} (${String(workflow.wrong_first_assignment_rate_percent ?? "—")}%)`],
    ["Report to triage", workflow.mean_report_to_triage_minutes == null ? "—" : `${workflow.mean_report_to_triage_minutes} min`],
    ["Report to acknowledgement", workflow.mean_report_to_acknowledge_minutes == null ? "—" : `${workflow.mean_report_to_acknowledge_minutes} min`],
    ["Report to restoration", workflow.mean_report_to_restore_hours == null ? "—" : `${workflow.mean_report_to_restore_hours} h`],
  ];
  return (
    <div className="panel workflow-panel">
      <h3>Operations → Maintenance handoffs</h3>
      <p className="muted">See the intake, triage, section response and restoration path. This is a workflow baseline, not a downtime-reduction claim.</p>
      <div className="workflow-stages">{flow.map(([label, key]) => <div key={key}><span>{label}</span><strong>{String(stages[key] ?? 0)}</strong></div>)}</div>
      <div className="critical-window">
        <h4>Critical window — median minutes</h4>
        <div>{[
          ["Report → triage", critical.report_to_triage_median],
          ["Triage → acknowledge", critical.triage_to_acknowledge_median],
          ["Acknowledge → diagnose", critical.acknowledge_to_diagnose_median],
          ["Diagnose → restore", critical.diagnose_to_restore_median],
          ["Restore → close", critical.restore_to_close_median],
        ].map(([label, value]) => <span key={String(label)}><small>{String(label)}</small><strong>{value == null ? "—" : `${String(value)} min`}</strong></span>)}</div>
        <p className="muted">First-fault median: {comparison.first_fault_median_minutes == null ? "—" : `${String(comparison.first_fault_median_minutes)} min`} · Repeat-fault median: {comparison.repeat_fault_median_minutes == null ? "—" : `${String(comparison.repeat_fault_median_minutes)} min`} · Target: {String(comparison.repeat_target_reduction_percent ?? 60)}% faster than comparable first faults. {String(comparison.baseline_status || "")}</p>
      </div>
      <div className="grid-two">
        <div>
          <h4>Section handoffs</h4>
          <div className="table"><table><thead><tr><th>Section</th><th>Ops reports</th><th>Automation triage</th><th>Assigned</th><th>Repeat direct</th><th>Acknowledged</th><th>Restored</th><th>Knowledge uses</th></tr></thead><tbody>
            {Object.entries(handoffs).map(([section, row]) => <tr key={section}><td><strong>{section}</strong></td><td>{String(row.operations_reports ?? 0)}</td><td>{String(row.systems_automation_triage ?? 0)}</td><td>{String(row.assigned_to_section ?? 0)}</td><td>{String(row.repeat_direct_routes ?? 0)}</td><td>{String(row.section_acknowledgements ?? 0)}</td><td>{String(row.restorations ?? 0)}</td><td>{String(row.knowledge_reuses ?? 0)}</td></tr>)}
          </tbody></table></div>
        </div>
        <div>
          <h4>Handoff timing</h4>
          <dl className="kpis">{metrics.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
          <p className="muted">{workflow.timing_note || "Durations use recorded timestamps."}</p>
        </div>
      </div>
    </div>
  );
}

function RecognitionPanel() {
  const [recognition, setRecognition] = useState<Record<string, unknown> | null>(null);
  useEffect(() => {
    api("/api/v1/recognition/leaderboard").then(setRecognition).catch(() => setRecognition(null));
  }, []);
  if (!recognition) return null;
  const leaderboard = (recognition.leaderboard || []) as DataRow[];
  return (
    <div className="panel recognition-panel">
      <div className="section-heading"><div><p className="eyebrow">{String(recognition.platform)}</p><h3>Contributor recognition</h3></div><span className="status approved">Verified contribution</span></div>
      <p className="muted">{String(recognition.recognition_rule)} · {String(recognition.integration_status)}</p>
      <div className="recognition-list">{leaderboard.slice(0, 8).map((row) => <article key={String(row.rank)}>
        <span className="recognition-rank">#{String(row.rank)}</span>
        <div><strong>{String(row.employee_name)}</strong><small>{String(row.role)} · {String(row.section || "Cross-section")}</small></div>
        <div className="recognition-metrics"><strong>{String(row.points)} pts</strong><small>{String(row.verified_reuses)} verified reuse · {String(row.approved_procedures)} approved · {String(row.approved_revisions)} revisions</small></div>
      </article>)}</div>
    </div>
  );
}

function PeopleSummary() {
  const [summary, setSummary] = useState<Record<string, unknown> | null>(null);
  useEffect(() => { api("/api/v1/users/summary").then(setSummary).catch(() => setSummary(null)); }, []);
  if (!summary) return null;
  const sections = (summary.by_section || {}) as Record<string, number>;
  return <div className="panel workforce-summary"><h3>Workforce summary · counts only</h3><p>{String(summary.active_accounts)} active of {String(summary.total_accounts)} synthetic demonstration accounts</p><div className="workforce-counts">{Object.entries(sections).map(([section, count]) => <span key={section}>{section}: <strong>{count}</strong></span>)}</div></div>;
}

function People({ user, compact = false }: { user: User; compact?: boolean }) {
  const [people, setPeople] = useState<Array<Record<string, unknown>>>([]);
  const [roles, setRoles] = useState<Array<Record<string, unknown>>>([]);
  const [appraisal, setAppraisal] = useState<Record<string, unknown> | null>(null);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [role, setRole] = useState("technician_st");
  const [section, setSection] = useState("Electrical");
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function loadUsers() {
    setPeople(await api("/api/v1/users"));
  }
  useEffect(() => {
    loadUsers().catch(() => setError("The people directory is not available for this role."));
    if (user.role === "system_administrator") api("/api/v1/access/roles").then(setRoles).catch(() => setError("Role definitions could not be loaded."));
  }, [user.role]);

  async function loadAppraisal() {
    const params = new URLSearchParams();
    if (startDate) params.set("start_date", startDate);
    if (endDate) params.set("end_date", endDate);
    const suffix = params.toString();
    setAppraisal(await api(`/api/v1/hr/appraisal${suffix ? `?${suffix}` : ""}`));
  }

  useEffect(() => {
    if (user.role === "hr_officer") loadAppraisal().catch(() => setError("Appraisal evidence is unavailable for this period."));
  }, [user.role]);

  const selectedRole = roles.find((item) => item.code === role);
  const sectionRequired = Boolean(selectedRole?.section_required);

  async function createAccount(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    setMessage("");
    try {
      const result = await api("/api/v1/users", { method: "POST", body: JSON.stringify({ username, display_name: displayName, role, section: sectionRequired ? section : "", password }) });
      setMessage(`Created ${result.username} as ${result.role_label}.`);
      setUsername("");
      setDisplayName("");
      setPassword("");
      await loadUsers();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Account creation failed.");
    }
  }

  async function toggleActive(person: Record<string, unknown>) {
    setError("");
    try {
      await api(`/api/v1/users/${String(person.id)}/status`, { method: "PATCH", body: JSON.stringify({ active: !person.active }) });
      await loadUsers();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Status update failed.");
    }
  }

  return (
    <section className={compact ? "" : "page"}>
      {!compact && <div className="page-heading"><div><p className="eyebrow">{user.role === "hr_officer" ? "PEOPLE AND APPRAISAL EVIDENCE" : "ROLE-BASED ACCESS"}</p><h2>{user.role === "system_administrator" ? "User management" : "People directory"}</h2><p className="muted">{user.role === "hr_officer" ? "Contribution evidence is attributed to employees; HR does not receive individual fault narratives." : "Names, roles, section membership and account status only."}</p></div></div>}
      {user.role === "hr_officer" && <section className="panel appraisal-panel">
        <div className="section-heading"><div><h3>Maintenance contribution evidence</h3><p className="muted">Use this evidence with context; report volume is shown for reference only and does not earn recognition points.</p></div></div>
        <div className="date-filter">
          <label>From<input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} /></label>
          <label>To<input type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} /></label>
          <button className="secondary" onClick={() => loadAppraisal().catch(() => setError("Appraisal evidence could not be refreshed."))}>Apply period</button>
        </div>
        {appraisal && <>
          <p className="muted">{String(appraisal.data_type)} · {String(appraisal.point_definition)}</p>
          <div className="table"><table><thead><tr><th>Employee</th><th>Role / section</th><th>Reports*</th><th>Diagnoses</th><th>Successful / failed interventions</th><th>Procedure updates approved</th><th>Colleague reuses</th><th>Mean ack / restore</th><th>Illustrative points†</th></tr></thead><tbody>
            {((appraisal.rows || []) as Array<Record<string, unknown>>).map((item) => <tr key={String(item.employee_id)}>
              <td><strong>{String(item.employee_name)}</strong></td>
              <td>{String(item.role)}<br /><span className="muted">{String(item.section || "Cross-section")}</span></td>
              <td>{String(item.faults_reported_context_only)}</td>
              <td>{String(item.diagnoses_recorded)}</td>
              <td>{String(item.successful_interventions)} / {String(item.failed_interventions)}</td>
              <td>{String(item.procedure_updates_approved)} / {String(item.procedure_updates_authored)}</td>
              <td>{String(item.colleague_reuses)}</td>
              <td>{item.mean_acknowledgement_minutes == null ? "—" : `${String(item.mean_acknowledgement_minutes)} min`} / {item.mean_report_to_restore_hours == null ? "—" : `${String(item.mean_report_to_restore_hours)} h`}</td>
              <td>{String(item.illustrative_recognition_points)}</td>
            </tr>)}
          </tbody></table></div>
          <p className="muted">* Context only, not rewarded. † Illustrative prototype weighting, not an approved KPC appraisal score.</p>
        </>}
      </section>}
      {user.role === "system_administrator" && <form className="panel quick-report" onSubmit={createAccount}>
        <h3>Create demo account</h3>
        <div className="form-grid">
          <label>Display name<input value={displayName} onChange={(event) => setDisplayName(event.target.value)} required /></label>
          <label>Username<input value={username} onChange={(event) => setUsername(event.target.value)} required /></label>
          <label>Role<select value={role} onChange={(event) => setRole(event.target.value)}>{roles.map((item) => <option key={String(item.code)} value={String(item.code)}>{String(item.label)}</option>)}</select></label>
          {sectionRequired && <label>Section<select value={section} onChange={(event) => setSection(event.target.value)}>{["Systems Automation", "Electrical", "Instrumentation", "Mechanical"].map((item) => <option key={item}>{item}</option>)}</select></label>}
          <label>Temporary password<input type="password" minLength={8} value={password} onChange={(event) => setPassword(event.target.value)} required /></label>
        </div>
        <button className="primary" type="submit">Create account</button>
        {message && <p className="confirmation">{message}</p>}
      </form>}
      {error && <p className="error">{error}</p>}
      <div className="table panel"><table><thead><tr><th>Name</th><th>Username</th><th>Role</th><th>Section</th><th>Status</th>{user.role === "system_administrator" && <th>Action</th>}</tr></thead><tbody>
        {people.map((person) => <tr key={String(person.id)}><td><strong>{String(person.display_name)}</strong></td><td>{String(person.username)}</td><td>{String(person.role_label)}</td><td>{String(person.section || "—")}</td><td>{person.active ? "Active" : "Inactive"}</td>{user.role === "system_administrator" && <td><button className="secondary" onClick={() => toggleActive(person)}>{person.active ? "Deactivate" : "Reactivate"}</button></td>}</tr>)}
      </tbody></table></div>
    </section>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="metric"><span>{label}</span><strong>{value}</strong></div>;
}

function Bar({ label, value, max }: { label: string; value: number; max: number }) {
  return <div className="bar-row"><span>{label}</span><div className="track"><div style={{ width: `${(value / max) * 100}%` }} /></div><strong>{value}</strong></div>;
}

function Equipment({ user }: { user: User }) {
  const [search, setSearch] = useState("");
  const [items, setItems] = useState<Array<Record<string, unknown>>>([]);
  useEffect(() => {
    api(`/api/v1/equipment?search=${encodeURIComponent(search)}`).then(async (rows) => {
      setItems(rows);
      await db.equipment.clear();
      await db.equipment.bulkPut(rows as never[]);
    }).catch(async () => {
      const cached = await db.equipment.toArray();
      const sectionScoped = ["technician_st", "technician_pt", "technician_ct", "assistant_engineer", "engineer", "senior_engineer", "chief_engineer"].includes(user.role);
      setItems(cached.filter((item) => (!sectionScoped || item.section === user.section) && (!search || `${item.tag} ${item.name}`.toLowerCase().includes(search.toLowerCase()))));
    });
  }, [search, user.role, user.section]);
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
  const [selectedId, setSelectedId] = useState("");
  const [error, setError] = useState("");
  const [repeatInsight, setRepeatInsight] = useState<Record<string, unknown> | null>(null);

  async function loadFaults(preferredId = "") {
    const rows = await api("/api/v1/faults");
    setFaults(rows);
    await db.faults.clear();
    await db.faults.bulkPut(rows as never[]);
    if (preferredId) setSelectedId(preferredId);
    else if (!selectedId && rows.length) setSelectedId(String(rows[0].id));
  }

  useEffect(() => {
    api("/api/v1/equipment").then(setEquipment).catch(() => setEquipment([]));
    loadFaults().catch(async () => {
      const cached = await db.faults.toArray();
      const sectionScoped = ["technician_st", "technician_pt", "technician_ct", "assistant_engineer", "engineer", "senior_engineer", "chief_engineer"].includes(user.role);
      const equipment = await db.equipment.toArray();
      const sectionEquipment = new Set(equipment.filter((item) => item.section === user.section).map((item) => item.id));
      const visible = cached.filter((item) => !sectionScoped || item.assigned_section === user.section || sectionEquipment.has(String(item.equipment_id)));
      setFaults(visible);
      if (!selectedId && visible.length) setSelectedId(String(visible[0].id));
      setError("Showing cached fault summaries. Open a connection to load investigation history.");
    });
  }, [user.role, user.section]);

  useEffect(() => {
    if (!equipmentId) {
      setRepeatInsight(null);
      return;
    }
    api(`/api/v1/intelligence/equipment/${encodeURIComponent(equipmentId)}`)
      .then(setRepeatInsight)
      .catch(() => setRepeatInsight(null));
  }, [equipmentId]);

  async function report() {
    if (!equipmentId) return;
    const payload = { equipment_id: equipmentId, category: "Electrical", symptom, severity, description: "Reported through fast-report workflow", operational_impact: "" };
    try {
      const created = await api("/api/v1/faults", { method: "POST", body: JSON.stringify(payload) });
      setMessage(`Fault reported: ${created.reference}`);
      setSelectedId(created.id);
      await loadFaults(created.id);
    } catch {
      const eventId = crypto.randomUUID();
      await db.pendingEvents.put({ event_id: eventId, event_type: "FAULT_REPORTED", actor_id: user.id, client_timestamp: new Date().toISOString(), sequence_number: 1, sync_status: "PENDING", payload });
      setMessage("Fault saved offline and queued for synchronisation.");
    }
  }

  return (
    <section className="page">
      <div className="page-heading"><div><p className="eyebrow">FAULT WORKFLOW</p><h2>Faults</h2></div></div>
      {(user.permissions || []).includes("faults.report") && <div className="panel quick-report"><h3>Fast report</h3><div className="form-grid"><label>Equipment<select value={equipmentId} onChange={(e) => setEquipmentId(e.target.value)}><option value="">Select equipment</option>{equipment.map((e) => <option key={String(e.id)} value={String(e.id)}>{String(e.tag)} — {String(e.name)}</option>)}</select></label><label>Symptom<select value={symptom} onChange={(e) => setSymptom(e.target.value)}>{["Unexpected trip", "Intermittent alarm", "Unstable reading", "Failure to start"].map((v) => <option key={v}>{v}</option>)}</select></label><label>Severity<select value={severity} onChange={(e) => setSeverity(e.target.value)}>{["Low", "Medium", "High", "Critical"].map((v) => <option key={v}>{v}</option>)}</select></label></div><button className="primary" onClick={report}>Submit fault</button>{message && <p className="confirmation">{message}</p>}</div>}
      {repeatInsight && Number(repeatInsight.repeat_count || 0) > 0 && <div className="repeat-banner">
        <strong>SEEN BEFORE:</strong> Same equipment has {String(repeatInsight.repeat_count)} occurrence(s) in the last 90 days.
        <span>Last: {repeatInsight.last_occurrence ? new Date(String(repeatInsight.last_occurrence.date)).toLocaleDateString() : "—"} · Suggested section: {String(repeatInsight.suggested_section)}</span>
        <span>Routing: skip normal triage and assign directly to the responsible standby section.</span>
      </div>}
      {error && <p className="error">{error}</p>}
      <p className="muted">Select a report to see equipment history, prior fixes, unsuccessful attempts and the current work record.</p>
      <div className="table panel"><table><thead><tr><th>Reference</th><th>Equipment</th><th>Symptom</th><th>Severity</th><th>Status</th><th>Section</th></tr></thead><tbody>{faults.map((f) => <tr key={String(f.id)} className={selectedId === String(f.id) ? "selected-row" : "clickable-row"} onClick={() => setSelectedId(String(f.id))} tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter") setSelectedId(String(f.id)); }}><td><strong>{String(f.reference)}</strong></td><td>{String(f.equipment_tag)}</td><td>{String(f.symptom)}</td><td><span className={`severity ${String(f.severity).toLowerCase()}`}>{String(f.severity)}</span></td><td>{String(f.status)}</td><td>{String(f.assigned_section || "Unassigned")}</td></tr>)}</tbody></table></div>
      {selectedId && <FaultDetail key={selectedId} user={user} faultId={selectedId} onRefresh={loadFaults} />}
    </section>
  );
}

type DataRow = Record<string, unknown>;
type FaultContext = {
  fault: DataRow;
  timeline: DataRow[];
  diagnoses: DataRow[];
  interventions: DataRow[];
  previous_faults: DataRow[];
  approved_procedures: DataRow[];
  legacy_knowledge: DataRow[];
  procedure_updates: DataRow[];
  reuse_records: DataRow[];
  ranked_causes: DataRow[];
  repeat_routing: DataRow;
};

function FaultDetail({ user, faultId, onRefresh }: { user: User; faultId: string; onRefresh: () => Promise<void> }) {
  const [context, setContext] = useState<FaultContext | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [diagnosis, setDiagnosis] = useState({ possible_cause: "", diagnostic_method: "", observations: "", test_results: "", confidence: "", quick_check: "", fix_summary: "", workaround: false, risk_level: "Normal" });
  const [intervention, setIntervention] = useState({ diagnosis_id: "", corrective_action: "", tools_materials: "", outcome: "SUCCESS", notes: "" });
  const [procedure, setProcedure] = useState({ title: "", observed_symptom: "", confirmed_cause: "", diagnostic_procedure: "", corrective_action: "", safety: "" });
  const [triageSection, setTriageSection] = useState("");
  const [triageComment, setTriageComment] = useState("");
  const [revisionOf, setRevisionOf] = useState("");
  const canUpdateFault = (user.permissions || []).includes("faults.update");
  const canInvestigate = ["technician_st", "technician_pt", "technician_ct", "assistant_engineer", "engineer", "senior_engineer", "chief_engineer"].includes(user.role);
  const canContribute = (user.permissions || []).includes("knowledge.contribute");
  const canTriage = (user.permissions || []).includes("faults.triage") || (user.permissions || []).includes("faults.triage.section");

  async function reload() {
    const loaded = await api(`/api/v1/faults/${encodeURIComponent(faultId)}/context`) as FaultContext;
    setContext(loaded);
    setTriageSection((current) => current || String(loaded.fault.assigned_section || loaded.fault.suggested_section || ""));
  }

  useEffect(() => {
    reload().catch((reason) => setError(reason instanceof Error ? reason.message : "Investigation history could not be loaded."));
  }, [faultId]);

  async function performAction(action: string) {
    setError("");
    setMessage("");
    try {
      await api(`/api/v1/faults/${encodeURIComponent(faultId)}/action?action=${action}`, { method: "POST" });
      setMessage(`Fault ${action.replace("_", " ")} recorded.`);
      await reload();
      await onRefresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Fault action failed.");
    }
  }

  async function submitDiagnosis(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    try {
      await api(`/api/v1/faults/${encodeURIComponent(faultId)}/diagnoses`, {
        method: "POST",
        body: JSON.stringify({
          ...diagnosis,
          confidence: diagnosis.confidence ? Number(diagnosis.confidence) : null,
        }),
      });
      setDiagnosis({ possible_cause: "", diagnostic_method: "", observations: "", test_results: "", confidence: "", quick_check: "", fix_summary: "", workaround: false, risk_level: "Normal" });
      setMessage("Diagnosis recorded. It remains unverified until an intervention confirms it.");
      await reload();
      await onRefresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Diagnosis could not be saved.");
    }
  }

  async function submitIntervention(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    try {
      await api(`/api/v1/faults/${encodeURIComponent(faultId)}/interventions`, {
        method: "POST",
        body: JSON.stringify({ ...intervention, diagnosis_id: intervention.diagnosis_id || null }),
      });
      setIntervention({ diagnosis_id: "", corrective_action: "", tools_materials: "", outcome: "SUCCESS", notes: "" });
      setMessage("Intervention recorded; failed attempts remain in the history.");
      await reload();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Intervention could not be saved.");
    }
  }

  async function submitProcedure(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    try {
      const path = revisionOf
        ? `/api/v1/procedure-updates/${encodeURIComponent(revisionOf)}/revisions`
        : `/api/v1/faults/${encodeURIComponent(faultId)}/procedure-updates`;
      await api(path, { method: "POST", body: JSON.stringify(procedure) });
      setProcedure({ title: "", observed_symptom: "", confirmed_cause: "", diagnostic_procedure: "", corrective_action: "", safety: "" });
      setRevisionOf("");
      setMessage(revisionOf ? "A new immutable procedure version has been submitted." : "Work-procedure update submitted for chief technical review.");
      await reload();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Work-procedure update could not be submitted.");
    }
  }

  async function reuseProcedure(procedureUpdateId: string) {
    setError("");
    try {
      await api(`/api/v1/faults/${encodeURIComponent(faultId)}/procedure-reuse`, {
        method: "POST",
        body: JSON.stringify({ procedure_update_id: procedureUpdateId }),
      });
      setMessage("Procedure use recorded. Confirm whether it helped after restoring the fault.");
      await reload();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Procedure reuse could not be recorded.");
    }
  }

  async function confirmReuse(reuseId: string, outcome: string) {
    setError("");
    try {
      await api(`/api/v1/procedure-reuse/${encodeURIComponent(reuseId)}/outcome`, {
        method: "POST",
        body: JSON.stringify({ outcome }),
      });
      setMessage(`Procedure reuse confirmed as ${outcome.toLowerCase()}.`);
      await reload();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Procedure outcome could not be confirmed.");
    }
  }

  async function submitTriage(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    try {
      await api(`/api/v1/faults/${encodeURIComponent(faultId)}/triage`, {
        method: "POST",
        body: JSON.stringify({
          assigned_section: triageSection || String(context?.fault.suggested_section || ""),
          triage_comment: triageComment,
        }),
      });
      setMessage("Triage and section assignment recorded.");
      setTriageComment("");
      await reload();
      await onRefresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Triage could not be saved.");
    }
  }

  if (!context) return <div className="panel"><h3>Fault work history</h3>{error ? <p className="error">{error}</p> : <p className="muted">Loading fault history…</p>}</div>;
  const fault = context.fault;
  const statusValue = String(fault.status);
  const hasSuccessfulIntervention = context.interventions.some((item) => item.outcome === "SUCCESS");
  const canSubmitProcedure = canContribute && ["RESTORED", "CLOSED"].includes(statusValue) && hasSuccessfulIntervention;
  const updateActions = user.permissions || [];
  const restrictedTriage = ["technician_ct", "chief_engineer"].includes(user.role);
  const triageOptions = ["Systems Automation", "Electrical", "Instrumentation", "Mechanical"].filter((section) => !restrictedTriage || section === user.section);
  const unresolvedReuse = context.reuse_records.filter((item) => item.actor_id === user.id && !item.outcome);

  return (
    <div className="fault-detail">
      <div className="panel">
        <div className="section-heading"><div><p className="eyebrow">WORK ORDER CONTEXT</p><h3>{String(fault.reference)} · {String(fault.equipment_tag)}</h3><p>{String(fault.symptom)} · {String(fault.description || "No additional report details")}</p></div><span className="status">{statusValue}</span></div>
        <p className="muted">Assigned section: {String(fault.assigned_section || "Unassigned")} · Reported {new Date(String(fault.created_at)).toLocaleString()}</p>
        {context.previous_faults.length > 0 && <p className="repeat-alert">Seen before on this equipment: {context.previous_faults.length} earlier report(s). Review the diagnosis and intervention history before repeating work.</p>}
        {canTriage && <form className="triage-form" onSubmit={submitTriage}>
          <strong>Systems Automation triage and routing</strong><span className="muted">Suggested section from the equipment record: {String(fault.suggested_section || "Not set")}</span>
          <div className="form-grid"><label>Assign to section<select value={triageSection || String(fault.assigned_section || fault.suggested_section || "")} onChange={(event) => setTriageSection(event.target.value)} required>{triageOptions.map((section) => <option key={section} value={section}>{section}</option>)}</select></label><label>Triage note<input value={triageComment} onChange={(event) => setTriageComment(event.target.value)} /></label></div>
          <button className="secondary" type="submit">Save triage and assignment</button>
        </form>}
        {canUpdateFault && <div className="action-row">
          {["REPORTED", "TRIAGED", "ASSIGNED"].includes(statusValue) && updateActions.includes("faults.update") && <button className="secondary" onClick={() => performAction("acknowledge")}>Acknowledge</button>}
          {statusValue === "ACKNOWLEDGED" && updateActions.includes("faults.update") && <button className="secondary" onClick={() => performAction("on_site")}>On site</button>}
          {["ON_SITE", "ACKNOWLEDGED"].includes(statusValue) && updateActions.includes("faults.update") && <button className="secondary" onClick={() => performAction("diagnose")}>Mark diagnosed</button>}
          {!["RESTORED", "CLOSED"].includes(statusValue) && updateActions.includes("faults.restore") && <button className="primary" onClick={() => performAction("restore")}>Mark restored</button>}
          {statusValue === "RESTORED" && updateActions.includes("faults.close") && <button className="primary" onClick={() => performAction("close")}>Close fault</button>}
        </div>}
        {message && <p className="confirmation">{message}</p>}
        {error && <p className="error">{error}</p>}
      </div>

      {context.ranked_causes && context.ranked_causes.length > 0 && <div className="panel ranked-causes">
        <div className="section-heading"><div><p className="eyebrow">RANKED TROUBLESHOOTING</p><h3>Most likely causes and confirmed fixes</h3></div><span className="muted">{context.repeat_routing?.triage_action === "DIRECT_TO_SECTION" ? "Repeat route: direct to standby" : "Standard section route"}</span></div>
        <div className="cause-list">
          {context.ranked_causes.map((cause, index) => <article className={`cause-card ${cause.recurrence_warning ? "workaround-warning" : ""}`} key={String(cause.possible_cause)}>
            <div className="cause-rank">{index + 1}</div>
            <div>
              <strong>{String(cause.possible_cause)}</strong>
              <p><b>Quick check:</b> {String(cause.quick_check || "No quick check recorded")}</p>
              <p><b>Fix:</b> {String(cause.fix || "No fix summary recorded")}</p>
              <div className="cause-metrics"><span>Confirmed {String(cause.confirmed_count || 0)}×</span><span>Failed {String(cause.failed_count || 0)}×</span><span>Recurrences {String(cause.recurrence_count || 0)}</span></div>
              {Boolean(cause.recurrence_warning) && <p className="warning-text">Recurring workaround: deeper investigation is required before this becomes a permanent fix.</p>}
              {Boolean(cause.supervisor_required) && <p className="risk-text">Risk level: {String(cause.risk_level)} — supervisor approval is required for this fix.</p>}
            </div>
          </article>)}
        </div>
      </div>}

      <div className="grid-two">
        <div className="panel"><h3>Reported history on this equipment</h3>
          {context.previous_faults.length ? context.previous_faults.map((item) => <article className="history-item" key={String(item.id)}>
            <strong>{String(item.reference)} · {String(item.status)}</strong><small>{new Date(String(item.created_at)).toLocaleDateString()} · {String(item.symptom)}</small>
            <p>{String(item.description || "No report details")}</p>
            {((item.diagnoses || []) as DataRow[]).map((entry, index) => <p key={`d-${index}`}><strong>Cause:</strong> {String(entry.possible_cause)} · {String(entry.verification_status)}</p>)}
            {((item.interventions || []) as DataRow[]).map((entry, index) => <p key={`i-${index}`} className={entry.outcome === "FAILED" ? "failed-attempt" : ""}><strong>{String(entry.outcome)}:</strong> {String(entry.corrective_action)} {String(entry.notes || "")}</p>)}
          </article>) : <p className="muted">No earlier reports for this equipment.</p>}
        </div>
        <div className="panel"><h3>Approved procedures for this equipment or symptom</h3>
          {context.approved_procedures.length ? context.approved_procedures.map((item) => <article className="history-item" key={String(item.id)}>
            <div className="card-top"><strong>{String(item.reference)} · v{String(item.version)}</strong><span className="status approved">APPROVED</span></div>
            <h4>{String(item.title)}</h4><p><strong>Cause:</strong> {String(item.confirmed_cause)}</p><p><strong>Check:</strong> {String(item.diagnostic_procedure)}</p><p><strong>Action:</strong> {String(item.corrective_action)}</p><small>Contributor: {String(item.author_name)}</small>
            {canInvestigate && <button className="secondary" onClick={() => reuseProcedure(String(item.id))}>Record use on this fault</button>}
          </article>) : <p className="muted">No approved work-procedure updates match this case yet.</p>}
          {context.legacy_knowledge.map((item) => <article className="history-item" key={String(item.id)}>
            <strong>{String(item.reference)} · v{String(item.version)} · approved library entry</strong><h4>{String(item.title)}</h4>
            <p><strong>Cause:</strong> {String(item.confirmed_cause)}</p><p><strong>Action:</strong> {String(item.corrective_action)}</p>
            {item.source_type === "LEGACY_PROCEDURE" && <><p><strong>Legacy reference:</strong> {String(item.legacy_reference || "Not recorded")}</p><p><strong>Applies to:</strong> {String(item.usage_scope || "Existing equipment or tool")}</p><ol className="instruction-steps">{String(item.step_by_step || "").split("\n").filter((step) => String(step).trim()).map((step, index) => <li key={index}>{step.replace(/^\d+\.\s*/, "")}</li>)}</ol></>}
          </article>)}
        </div>
      </div>

      {canInvestigate && <div className="grid-two">
        <form className="panel" onSubmit={submitDiagnosis}>
          <h3>Record possible cause and checks</h3>
          <label>Possible cause<input value={diagnosis.possible_cause} onChange={(event) => setDiagnosis({ ...diagnosis, possible_cause: event.target.value })} required /></label>
          <label>Diagnostic method<input value={diagnosis.diagnostic_method} onChange={(event) => setDiagnosis({ ...diagnosis, diagnostic_method: event.target.value })} required /></label>
          <label>Observations<textarea value={diagnosis.observations} onChange={(event) => setDiagnosis({ ...diagnosis, observations: event.target.value })} /></label>
          <label>Test results<textarea value={diagnosis.test_results} onChange={(event) => setDiagnosis({ ...diagnosis, test_results: event.target.value })} /></label>
          <label>Confidence (0–1)<input type="number" min="0" max="1" step="0.05" value={diagnosis.confidence} onChange={(event) => setDiagnosis({ ...diagnosis, confidence: event.target.value })} /></label>
          <label>Quick check<input value={diagnosis.quick_check} onChange={(event) => setDiagnosis({ ...diagnosis, quick_check: event.target.value })} placeholder="Fast test or verification step" /></label>
          <label>Recommended fix<input value={diagnosis.fix_summary} onChange={(event) => setDiagnosis({ ...diagnosis, fix_summary: event.target.value })} /></label>
          <label>Risk level<select value={diagnosis.risk_level} onChange={(event) => setDiagnosis({ ...diagnosis, risk_level: event.target.value })}><option>Normal</option><option>Caution</option><option>High</option></select></label>
          <label className="checkbox-label"><input type="checkbox" checked={diagnosis.workaround} onChange={(event) => setDiagnosis({ ...diagnosis, workaround: event.target.checked })} /> This is a workaround or temporary reset</label>
          <button className="primary" type="submit">Save diagnosis</button>
        </form>
        <form className="panel" onSubmit={submitIntervention}>
          <h3>Record each intervention</h3>
          <label>Related diagnosis<select value={intervention.diagnosis_id} onChange={(event) => setIntervention({ ...intervention, diagnosis_id: event.target.value })}><option value="">Not linked to a diagnosis</option>{context.diagnoses.map((item) => <option key={String(item.id)} value={String(item.id)}>{String(item.possible_cause)}</option>)}</select></label>
          <label>Action taken<textarea value={intervention.corrective_action} onChange={(event) => setIntervention({ ...intervention, corrective_action: event.target.value })} required /></label>
          <label>Tools / materials<input value={intervention.tools_materials} onChange={(event) => setIntervention({ ...intervention, tools_materials: event.target.value })} /></label>
          <label>Outcome<select value={intervention.outcome} onChange={(event) => setIntervention({ ...intervention, outcome: event.target.value })}><option value="SUCCESS">Successful</option><option value="FAILED">Failed — retain in history</option><option value="IN_PROGRESS">In progress</option></select></label>
          <label>Notes<textarea value={intervention.notes} onChange={(event) => setIntervention({ ...intervention, notes: event.target.value })} /></label>
          <button className="primary" type="submit">Save intervention</button>
        </form>
      </div>}

      <div className="grid-two">
        <div className="panel"><h3>Investigation and intervention log</h3>
          {context.diagnoses.map((item) => <article className="history-item" key={String(item.id)}><strong>Possible cause: {String(item.possible_cause)}</strong><small>{String(item.author_name)} · {String(item.verification_status)} · {new Date(String(item.created_at)).toLocaleString()}</small><p>{String(item.diagnostic_method)}</p><p>{String(item.observations)} {String(item.test_results)}</p></article>)}
          {context.interventions.map((item) => <article className={`history-item ${item.outcome === "FAILED" ? "failed-attempt" : ""}`} key={String(item.id)}><strong>{String(item.outcome)} intervention</strong><small>{String(item.actor_name)} · {new Date(String(item.created_at)).toLocaleString()}</small><p>{String(item.corrective_action)}</p><p>{String(item.tools_materials)} {String(item.notes)}</p></article>)}
          {!context.diagnoses.length && !context.interventions.length && <p className="muted">No investigation steps have been recorded for this report.</p>}
        </div>
        <div className="panel"><h3>Event and review timeline</h3>
          {context.timeline.map((item) => <article className="timeline-item" key={String(item.id)}><strong>{String(item.event_type).replace(/_/g, " ")}</strong><small>{String(item.actor_name)} · {new Date(String(item.created_at)).toLocaleString()}</small></article>)}
          {context.procedure_updates.map((item) => <article className="history-item" key={String(item.id)}><div className="card-top"><strong>{String(item.reference)} · v{String(item.version)}</strong><span className={`status ${String(item.status).toLowerCase()}`}>{String(item.status).replace(/_/g, " ")}</span></div><p>{String(item.title)} · by {String(item.author_name)}</p>
            {((item.reviews || []) as DataRow[]).map((review, index) => <p key={index}><strong>{String(review.decision).replace(/_/g, " ")}:</strong> {String(review.comments)} <small>— {String(review.reviewer_name)}</small></p>)}
            {canContribute && item.author_id === user.id && ["CLARIFICATION_REQUESTED", "APPROVED"].includes(String(item.status)) && <button className="secondary" onClick={() => {
              setRevisionOf(String(item.id));
              setProcedure({
                title: String(item.title), observed_symptom: String(item.observed_symptom), confirmed_cause: String(item.confirmed_cause),
                diagnostic_procedure: String(item.diagnostic_procedure), corrective_action: String(item.corrective_action), safety: String(item.safety || ""),
              });
            }}>Revise this version</button>}
          </article>)}
        </div>
      </div>

      {canSubmitProcedure && <form className="panel procedure-form" onSubmit={submitProcedure}>
        <h3>{revisionOf ? "Submit a new procedure version" : "Update the reusable work procedure"}</h3>
        {revisionOf && <p className="muted">Editing creates a new version; the prior version and review comments remain in the history.</p>}
        <div className="form-grid">
          <label>Procedure title<input value={procedure.title} onChange={(event) => setProcedure({ ...procedure, title: event.target.value })} required /></label>
          <label>Observed symptom<input value={procedure.observed_symptom} onChange={(event) => setProcedure({ ...procedure, observed_symptom: event.target.value })} required /></label>
          <label>Confirmed cause<input value={procedure.confirmed_cause} onChange={(event) => setProcedure({ ...procedure, confirmed_cause: event.target.value })} required /></label>
        </div>
        <label>Diagnostic procedure<textarea value={procedure.diagnostic_procedure} onChange={(event) => setProcedure({ ...procedure, diagnostic_procedure: event.target.value })} required /></label>
        <label>Corrective action<textarea value={procedure.corrective_action} onChange={(event) => setProcedure({ ...procedure, corrective_action: event.target.value })} required /></label>
        <label>Safety notes<textarea value={procedure.safety} onChange={(event) => setProcedure({ ...procedure, safety: event.target.value })} /></label>
        <button className="primary" type="submit">{revisionOf ? "Submit revision" : "Submit for chief technical review"}</button>
      </form>}

      {context.reuse_records.length > 0 && <div className="panel"><h3>Procedure reuse and outcome confirmation</h3>
        {context.reuse_records.map((item) => <article className="history-item" key={String(item.id)}>
          <strong>{String(item.procedure_reference)} · {String(item.procedure_title)}</strong><small>Used by {String(item.actor_name)} · {new Date(String(item.used_at)).toLocaleString()}</small>
          {item.outcome ? <p>Confirmed {String(item.outcome).toLowerCase()} by colleague.</p> : item.actor_id === user.id && ["RESTORED", "CLOSED"].includes(statusValue) && <div className="action-row"><button className="primary" onClick={() => confirmReuse(String(item.id), "SUCCESS")}>Confirm helpful</button><button className="secondary" onClick={() => confirmReuse(String(item.id), "FAILED")}>Confirm not helpful</button></div>}
        </article>)}
        {unresolvedReuse.length > 0 && !["RESTORED", "CLOSED"].includes(statusValue) && <p className="muted">Confirm whether the referenced procedure helped after the fault is restored.</p>}
      </div>}
    </div>
  );
}

function Knowledge({ user }: { user: User }) {
  const [items, setItems] = useState<Array<Record<string, unknown>>>([]);
  const [search, setSearch] = useState("");
  const [sourceFilter, setSourceFilter] = useState("ALL");
  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState({
    title: "",
    symptom: "",
    confirmed_cause: "",
    diagnostic_procedure: "",
    corrective_action: "",
    safety: "",
    usage_scope: "",
    legacy_reference: "",
    step_by_step: "",
  });
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    Promise.all([
      api(`/api/v1/knowledge?search=${encodeURIComponent(search)}${sourceFilter === "LEGACY_PROCEDURE" ? "&source_type=LEGACY_PROCEDURE" : sourceFilter === "FAULT_DERIVED" ? "&source_type=FAULT_DERIVED" : ""}`),
      api("/api/v1/procedure-updates/library"),
    ]).then(async ([legacy, procedures]) => {
      const procedureEntries = (procedures as DataRow[]).map((item) => ({
        ...item,
        source_type: "Work procedure",
        symptom: item.observed_symptom,
      }));
      const legacyEntries = (legacy as DataRow[]).map((item) => ({
        ...item,
        source_type: item.source_type === "LEGACY_PROCEDURE" ? "LEGACY_PROCEDURE" : "FAULT_DERIVED",
      }));
      setItems([
        ...(sourceFilter === "ALL" || sourceFilter === "FAULT_DERIVED" ? procedureEntries : []),
        ...(sourceFilter === "ALL" || sourceFilter === "LEGACY_PROCEDURE" || sourceFilter === "FAULT_DERIVED" ? legacyEntries : []),
      ]);
      await db.knowledge.clear();
      await db.knowledge.bulkPut(legacy as never[]);
    }).catch(async () => {
      const cached = await db.knowledge.filter((entry) => entry.status === "APPROVED").toArray();
      setItems(cached.filter((entry) => !search || `${entry.title} ${entry.symptom} ${entry.confirmed_cause}`.toLowerCase().includes(search.toLowerCase())).map((entry) => ({ ...entry, source_type: "Knowledge entry" })));
    });
  }, [search, sourceFilter, user.role, user.section]);

  async function createLegacyProcedure(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    setMessage("");
    try {
      await api("/api/v1/knowledge", {
        method: "POST",
        body: JSON.stringify({
          ...createForm,
          source_type: "LEGACY_PROCEDURE",
          instruction_type: "Legacy operating work instruction",
          equipment_id: null,
          confirmed_cause: createForm.confirmed_cause || "Existing equipment/tool operating instruction",
        }),
      });
      setCreateForm({
        title: "", symptom: "", confirmed_cause: "", diagnostic_procedure: "", corrective_action: "",
        safety: "", usage_scope: "", legacy_reference: "", step_by_step: "",
      });
      setMessage("Legacy work instruction submitted for review.");
      setShowCreate(false);
      setSourceFilter("LEGACY_PROCEDURE");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Legacy work instruction could not be submitted.");
    }
  }
  return (
    <section className="page">
      <div className="page-heading"><div><p className="eyebrow">MAINTENANCE KNOWLEDGE</p><h2>Approved procedures and knowledge</h2><p className="muted">Only approved and published entries appear in the reusable library.</p></div></div>
      <div className="knowledge-toolbar">
        <div className="search"><Search size={17} /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search symptom, cause or legacy reference" /></div>
        <div className="source-tabs" aria-label="Knowledge source">
          {["ALL", "LEGACY_PROCEDURE", "FAULT_DERIVED"].map((source) => <button key={source} className={sourceFilter === source ? "source-tab active" : "source-tab"} onClick={() => setSourceFilter(source)}>{source === "ALL" ? "All records" : source === "LEGACY_PROCEDURE" ? "Legacy work instructions" : "Fault-derived procedures"}</button>)}
        </div>
        {(user.permissions || []).includes("knowledge.contribute") && <button className="secondary" onClick={() => setShowCreate((value) => !value)}>{showCreate ? "Cancel" : "Add legacy instruction"}</button>}
      </div>
      {message && <p className="confirmation">{message}</p>}
      {error && <p className="error">{error}</p>}
      {showCreate && <form className="panel legacy-create" onSubmit={createLegacyProcedure}>
        <div className="page-heading"><div><p className="eyebrow">LEGACY / EXISTING EQUIPMENT</p><h3>Add step-by-step work instruction</h3></div></div>
        <div className="form-grid">
          <label>Instruction title<input value={createForm.title} onChange={(event) => setCreateForm({ ...createForm, title: event.target.value })} required /></label>
          <label>Legacy reference<input value={createForm.legacy_reference} onChange={(event) => setCreateForm({ ...createForm, legacy_reference: event.target.value })} placeholder="Document, tool or manual reference" /></label>
          <label>Equipment / tool scope<input value={createForm.usage_scope} onChange={(event) => setCreateForm({ ...createForm, usage_scope: event.target.value })} placeholder="Tag, model or work area" /></label>
        </div>
        <label>Operating or maintenance purpose<input value={createForm.symptom} onChange={(event) => setCreateForm({ ...createForm, symptom: event.target.value })} placeholder="What this instruction enables or maintains" /></label>
        <label>Step-by-step instructions<textarea value={createForm.step_by_step} onChange={(event) => setCreateForm({ ...createForm, step_by_step: event.target.value })} placeholder={"1. Verify permit and isolation.\n2. Inspect the equipment or tool.\n3. Perform the approved work.\n4. Record checks and restore safely."} required /></label>
        <div className="form-grid">
          <label>Diagnostic / normal checks<textarea value={createForm.diagnostic_procedure} onChange={(event) => setCreateForm({ ...createForm, diagnostic_procedure: event.target.value })} /></label>
          <label>Corrective action<textarea value={createForm.corrective_action} onChange={(event) => setCreateForm({ ...createForm, corrective_action: event.target.value })} /></label>
          <label>Safety requirements<textarea value={createForm.safety} onChange={(event) => setCreateForm({ ...createForm, safety: event.target.value })} /></label>
        </div>
        <button className="primary" type="submit">Submit legacy instruction</button>
      </form>}
      <div className="knowledge-grid">{items.map((item) => {
        const isLegacy = item.source_type === "LEGACY_PROCEDURE";
        const steps = String(item.step_by_step || "").split("\n").filter((step) => step.trim());
        return <article className={`knowledge-card ${isLegacy ? "legacy-card" : "fault-card"}`} key={`${String(item.source_type)}-${String(item.id)}`}>
          <div className="card-top"><span className="source-badge">{isLegacy ? "LEGACY WORK INSTRUCTION" : "FAULT-DERIVED PROCEDURE"}</span><small>{String(item.reference)} · v{String(item.version)}</small></div>
          {isLegacy && <><p className="legacy-meta"><strong>Legacy reference:</strong> {String(item.legacy_reference || "Not recorded")}<br /><strong>Applies to:</strong> {String(item.usage_scope || "Defined operating scope")}</p>
            {steps.length ? <ol className="instruction-steps">{steps.map((step, index) => <li key={index}>{step.replace(/^\d+\.\s*/, "")}</li>)}</ol> : <p className="muted">Step-by-step text has not been migrated.</p>}
          </>}
          {!isLegacy && <><h3>{String(item.title)}</h3><p><strong>Symptom:</strong> {String(item.symptom)}</p><p><strong>Cause:</strong> {String(item.confirmed_cause)}</p><p><strong>Diagnostic procedure:</strong> {String(item.diagnostic_procedure || "See linked fault history")}</p><p><strong>Action:</strong> {String(item.corrective_action)}</p>{Boolean(item.author_name) && <p><strong>Contributor:</strong> {String(item.author_name)}</p>}</>}
          {isLegacy && <div className="legacy-footer"><span className="status approved">{String(item.status)}</span><small>{String(item.instruction_type || "Legacy work instruction")}</small></div>}
        </article>;
      })}</div>
      {!items.length && <div className="empty">No approved knowledge matches this search.</div>}
    </section>
  );
}

function ProcedureReview({ user }: { user: User }) {
  const [updates, setUpdates] = useState<DataRow[]>([]);
  const [comments, setComments] = useState<Record<string, string>>({});
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const isSupervisor = user.role === "supervisor";

  async function loadQueue() {
    setUpdates(await api("/api/v1/procedure-updates/review-queue"));
  }

  useEffect(() => {
    loadQueue().catch((reason) => setError(reason instanceof Error ? reason.message : "The review queue is unavailable."));
  }, []);

  async function review(updateId: string, decision: string) {
    setError("");
    setMessage("");
    try {
      await api(`/api/v1/procedure-updates/${encodeURIComponent(updateId)}/review`, {
        method: "POST",
        body: JSON.stringify({ decision, comments: comments[updateId] || "" }),
      });
      setMessage(decision === "APPROVE" ? (isSupervisor ? "Procedure published to the approved library." : "Technical review approved; awaiting supervisor publication.") : "Clarification request recorded for the contributor.");
      await loadQueue();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Review action failed.");
    }
  }

  return (
    <section className="page">
      <div className="page-heading"><div><p className="eyebrow">VERSIONED WORK-PROCEDURE REVIEW</p><h2>{isSupervisor ? "Supervisor publication queue" : `${user.section} technical review`}</h2><p className="muted">{isSupervisor ? "Publish only after a section chief has completed technical review." : "Review evidence from your section; approve technically or request specific clarification."}</p></div></div>
      {message && <p className="confirmation">{message}</p>}
      {error && <p className="error">{error}</p>}
      {!updates.length && !error && <div className="empty">No work-procedure updates are waiting for your review.</div>}
      <div className="review-list">{updates.map((item) => {
        const evidence = (item.source_evidence || {}) as DataRow;
        const diagnoses = (evidence.diagnoses || []) as DataRow[];
        const interventions = (evidence.interventions || []) as DataRow[];
        return <article className="panel review-card" key={String(item.id)}>
          <div className="card-top"><span className="status submitted">{String(item.status).replace(/_/g, " ")}</span><small>{String(item.reference)} · v{String(item.version)} · {String(item.section)}</small></div>
          <h3>{String(item.title)}</h3>
          <p><strong>Contributor:</strong> {String(item.author_name)} · <strong>Source fault:</strong> {String(evidence.fault_reference || item.fault_id)}</p>
          <p><strong>Observed symptom:</strong> {String(item.observed_symptom)} · <strong>Reported status:</strong> {String(evidence.status || "—")}</p>
          <p><strong>Proposed cause:</strong> {String(item.confirmed_cause)}</p>
          <p><strong>Diagnostic procedure:</strong> {String(item.diagnostic_procedure)}</p>
          <p><strong>Corrective action:</strong> {String(item.corrective_action)}</p>
          <p><strong>Safety:</strong> {String(item.safety || "No additional notes supplied")}</p>
          <div className="source-evidence">
            <strong>Recorded diagnostic evidence</strong>
            {diagnoses.map((entry, index) => <p key={`diagnosis-${index}`}>{String(entry.possible_cause)} — {String(entry.verification_status)} · {String(entry.observations)} {String(entry.test_results)}</p>)}
            <strong>Interventions, including unsuccessful attempts</strong>
            {interventions.map((entry, index) => <p className={entry.outcome === "FAILED" ? "failed-attempt" : ""} key={`intervention-${index}`}><b>{String(entry.outcome)}:</b> {String(entry.corrective_action)} {String(entry.notes)}</p>)}
          </div>
          <label>Review notes<textarea value={comments[String(item.id)] || ""} onChange={(event) => setComments({ ...comments, [String(item.id)]: event.target.value })} placeholder="Required for a clarification request or rejection" /></label>
          <div className="action-row">
            <button className="primary" onClick={() => review(String(item.id), "APPROVE")}>{isSupervisor ? "Approve & publish" : "Approve technical review"}</button>
            <button className="secondary" onClick={() => review(String(item.id), "REQUEST_CLARIFICATION")}>Request clarification</button>
            <button className="secondary" onClick={() => review(String(item.id), "REJECT")}>Reject</button>
          </div>
        </article>;
      })}</div>
    </section>
  );
}

function App() {
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
    fetch(`${API}/api/v1/auth/me`, { headers: { Authorization: `Bearer ${token}` } })
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
        setUser(normalized);
      })
      .catch((error: unknown) => console.warn("Keeping the cached demo session; server validation is unavailable.", error));
  }, []);
  function logout() {
    localStorage.removeItem("kpc-token");
    localStorage.removeItem("kpc-user");
    setUser(null);
  }
  return user ? <Shell user={user} onLogout={logout} /> : <Login onLogin={setUser} />;
}

createRoot(document.getElementById("root")!).render(<BrowserRouter><App /></BrowserRouter>);
