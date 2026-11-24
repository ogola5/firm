import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, NavLink, Route, Routes, useNavigate, useSearchParams } from "react-router-dom";
import { AlertTriangle, BookOpen, ClipboardList, CloudOff, Gauge, History, LogOut, Plus, Radio, RefreshCw, Search, ShieldCheck, Wrench } from "lucide-react";
import { db } from "./db";
import { normalizeUser, type User } from "./auth";
import { API_BASE as API, ApiError, api, isOfflineError } from "./offline/api";
import { cacheEquipment, cacheFaultContext, cacheFaults, cachedFaultContext, refreshOfflineCache, searchCachedEquipment } from "./offline/cache";
import { useConnection, useSyncState } from "./offline/hooks";
import { networkFetch } from "./offline/network";
import { queueAttachment, queueDiagnosis, queueFaultAction, queueFaultReport, queueIntervention, queueOperatorUpdate } from "./offline/outbox";
import { offlineLogin, rememberOfflineSession } from "./offline/session";
import { getSyncEngine, requestBackgroundSync, setSyncActor, startAutoSync } from "./offline/sync";
import { NetworkSimulator, SyncCentre } from "./offline/SyncCentre";
import "./styles.css";

type DemoAccount = { username: string; role_label: string; section: string };

const OFFLINE_SAVED = "No connection: saved on this device and queued for synchronisation.";

function Login({ onLogin }: { onLogin: (user: User) => void }) {
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

function Shell({ user, onLogout }: { user: User; onLogout: () => void }) {
  const connection = useConnection();
  const online = connection.online;
  const { sync, pending, conflicts } = useSyncState(user.id);
  const offlineSession = localStorage.getItem("kpc-offline-session");

  useEffect(() => {
    setSyncActor(user.id);
    const stop = startAutoSync();
    return () => {
      stop();
      setSyncActor(null);
    };
  }, [user.id]);

  // Refresh the offline datasets whenever this session is (or becomes) connected.
  useEffect(() => {
    if (online) void refreshOfflineCache(user.permissions || []);
  }, [online, user.id]);

  useEffect(() => {
    if (pending) void requestBackgroundSync();
  }, [pending]);

  const statusLabel = connection.mode === "offline"
    ? "Offline (simulated)"
    : !connection.browserOnline ? "Offline mode"
      : !connection.serverReachable ? "Server unreachable"
        : connection.mode === "intermittent" ? "Intermittent (simulated)" : "Connected";

  const peopleOnly = user.role === "hr_officer";
  const executiveOnly = user.role === "managing_director" || user.role === "management";
  const canSeeMaintenance = !peopleOnly && !executiveOnly;
  const canManageUsers = user.role === "system_administrator";
  const canSeePeople = canManageUsers || peopleOnly;
  const canReviewProcedures = ["technician_ct", "chief_engineer", "supervisor"].includes(user.role);
  const technicianRoles = ["systems_automation", "technician_st", "technician_pt", "technician_ct", "assistant_engineer", "engineer", "senior_engineer", "chief_engineer"];
  const technicianView = technicianRoles.includes(user.role);

  return (
    <div className="app-shell">
      <aside>
        <div className="side-brand"><Wrench size={22} /><strong>KPC Maintenance</strong></div>
        <nav>
          <NavLink to="/dashboard">{user.role === "technician_ct" ? <Gauge size={18} /> : technicianView ? <ClipboardList size={18} /> : <Gauge size={18} />} {user.role === "technician_ct" ? "Section oversight" : technicianView ? "My work" : executiveOnly ? "Executive summary" : peopleOnly ? "Workforce overview" : "Dashboard"}</NavLink>
          {canSeeMaintenance && (user.permissions || []).includes("equipment.read") && <NavLink to="/equipment"><Search size={18} /> Equipment</NavLink>}
          {canSeeMaintenance && (user.permissions || []).includes("faults.read") && <NavLink to="/faults"><AlertTriangle size={18} /> {technicianView ? "Browse breakdowns" : "Faults"}</NavLink>}
          {canSeeMaintenance && (user.permissions || []).includes("knowledge.read") && <NavLink to="/knowledge"><BookOpen size={18} /> Knowledge</NavLink>}
          {canSeeMaintenance && canReviewProcedures && <NavLink to="/approvals"><ShieldCheck size={18} /> Procedure review</NavLink>}
          {canSeePeople && <NavLink to="/people"><ShieldCheck size={18} /> {canManageUsers ? "User management" : "People directory"}</NavLink>}
          {canSeeMaintenance && <NavLink to="/sync"><CloudOff size={18} /> Sync{conflicts ? ` (${conflicts})` : ""}</NavLink>}
        </nav>
        <div className="side-user">
          <div className={`status-dot ${online ? "online" : "offline"}`} />
          <div><strong>{user.display_name}</strong><span>{user.role_label}{user.section ? ` · ${user.section}` : ""}</span></div>
          <button className="icon-button" onClick={onLogout} aria-label="Log out"><LogOut size={17} /></button>
        </div>
      </aside>
      <main>
        <header>
          <div className="network-status" role="status">
            <Radio size={15} /> {statusLabel}
            {offlineSession && <span className="tag">Offline sign-in{offlineSession === "token-expired" ? " · sign in online to send changes" : ""}</span>}
            {sync.phase === "auth_required" && <span className="error"> Session expired: sign in while connected to send queued work.</span>}
            {sync.phase === "waiting_retry" && pending > 0 && <span className="muted"> · retrying automatically</span>}
          </div>
          <button className="secondary" onClick={() => void getSyncEngine().syncNow("manual")} disabled={sync.phase === "syncing"}>
            <RefreshCw size={16} /> {sync.phase === "syncing" ? "Syncing…" : "Sync now"} <span className="count" aria-label="Changes waiting">{pending}</span>
          </button>
        </header>
        <Routes>
          <Route path="/dashboard" element={<Dashboard user={user} />} />
          {canSeeMaintenance && (user.permissions || []).includes("equipment.read") && <Route path="/equipment" element={<Equipment user={user} />} />}
          {canSeeMaintenance && (user.permissions || []).includes("faults.read") && <Route path="/faults" element={<Faults user={user} />} />}
          {canSeeMaintenance && (user.permissions || []).includes("knowledge.read") && <Route path="/knowledge" element={<Knowledge user={user} />} />}
          {canSeeMaintenance && canReviewProcedures && <Route path="/approvals" element={<ProcedureReview user={user} />} />}
          {canSeePeople && <Route path="/people" element={<People user={user} />} />}
          {canSeeMaintenance && <Route path="/sync" element={<SyncCentre user={user} />} />}
          <Route path="*" element={<Dashboard user={user} />} />
        </Routes>
      </main>
    </div>
  );
}

function Dashboard({ user }: { user: User }) {
  const [data, setData] = useState<Record<string, unknown> | null>(null);
  useEffect(() => {
    if (user.role !== "hr_officer" && !["systems_automation", "technician_st", "technician_pt", "technician_ct", "assistant_engineer", "engineer", "senior_engineer", "chief_engineer"].includes(user.role)) {
      api("/api/v1/analytics/overview").then(setData).catch(() => setData(null));
    }
  }, [user.role]);
  if (user.role === "technician_ct") return <ChiefTechnicianDashboard user={user} />;
  if (user.role === "operations" || ["systems_automation", "technician_st", "technician_pt", "technician_ct", "assistant_engineer", "engineer", "senior_engineer", "chief_engineer"].includes(user.role)) return <PersonalWorkspace user={user} />;
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

function PersonalWorkspace({ user }: { user: User }) {
  const isOperator = user.role === "operations";
  const [items, setItems] = useState<Array<Record<string, unknown>>>([]);
  const [error, setError] = useState("");
  const [availability, setAvailability] = useState(user.availability_status);

  useEffect(() => {
    const path = isOperator ? "/api/v1/faults?history_scope=reported_by_me" : "/api/v1/faults?queue=mine";
    api(path).then((rows) => {
      setItems(isOperator ? rows.filter((item: Record<string, unknown>) => !["RESTORED", "CLOSED"].includes(String(item.status))) : rows);
      setError("");
    }).catch(() => setError("Could not load breakdowns. Reconnect and try again."));
  }, [isOperator]);

  function breakdownLink(item: Record<string, unknown>) {
    return `/faults?mode=history&fault=${encodeURIComponent(String(item.id))}`;
  }

  async function updateAvailability(value: "AVAILABLE" | "UNAVAILABLE") {
    const previous = availability;
    setAvailability(value);
    setError("");
    try {
      await api("/api/v1/me/availability", { method: "PATCH", body: JSON.stringify({ availability_status: value }) });
    } catch (reason) {
      setAvailability(previous);
      setError(reason instanceof Error ? reason.message : "Availability could not be updated.");
    }
  }

  function renderQueue() {
    if (!items.length) return <p className="muted">{isOperator ? "You have no active breakdowns that you reported." : "You have no active breakdowns assigned to you."}</p>;
    return <div className="technician-queue">{items.slice(0, 5).map((item) => (
      <NavLink className="technician-queue-item" key={String(item.id)} to={breakdownLink(item)}>
        <span className="queue-item-main">
          <strong>{String(item.reference)} · {String(item.equipment_tag || "Asset not identified")}</strong>
          <span>{String(item.symptom)} · {String(item.status)}</span>
          {item.equipment_confirmed === false && <small>Asset identity needs confirmation</small>}
        </span>
        <span className="tag">{String(item.assigned_section || "Needs triage")}</span>
      </NavLink>
    ))}</div>;
  }

  return (
    <section className="page technician-workspace personal-workspace">
      <div className="page-heading">
        <div><p className="eyebrow">{isOperator ? "OPERATIONS WORKSPACE" : `${user.section || "MAINTENANCE"} · TECHNICIAN WORKSPACE`}</p><h2>My work</h2><p className="muted">Your active work only. Browse breakdowns when you need the wider history.</p></div>
        <div className="technician-actions">
          <NavLink className="secondary" to="/faults?mode=history"><History size={17} /> Find previous work</NavLink>
          {(user.permissions || []).includes("faults.report") && <NavLink className="primary" to="/faults?mode=report"><Plus size={17} /> Report a breakdown</NavLink>}
          {["technician_st", "technician_pt"].includes(user.role) && <label className="availability-field">Availability<select value={availability} onChange={(event) => updateAvailability(event.target.value as "AVAILABLE" | "UNAVAILABLE")}><option value="AVAILABLE">Available</option><option value="UNAVAILABLE">Unavailable</option></select></label>}
        </div>
      </div>
      {error && <p className="error">{error}</p>}
      <div className="panel">
        <div className="section-heading"><div><h3>{isOperator ? "Reported by me" : "Assigned to me"}</h3><p className="muted">{isOperator ? "Follow up on the breakdowns you have reported." : "Continue the breakdown work you have taken ownership of."}</p></div><span className="count">{items.length}</span></div>
        {renderQueue()}
        {(isOperator || items.length > 5) && <NavLink className="text-button" to={isOperator ? "/faults?mode=history&scope=reported_by_me" : "/faults?mode=history&scope=mine"}>{isOperator ? "View your report history" : "View all your active work"}</NavLink>}
      </div>
      <NavLink className="workspace-knowledge" to="/knowledge"><BookOpen size={16} /> Open approved and legacy procedures</NavLink>
    </section>
  );
}

function ChiefTechnicianDashboard({ user }: { user: User }) {
  const [workspace, setWorkspace] = useState<Record<string, unknown> | null>(null);
  const [competencyDrafts, setCompetencyDrafts] = useState<Record<string, string>>({});
  const [savingUserId, setSavingUserId] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  async function reload() {
    const data = await api("/api/v1/chief/workspace") as Record<string, unknown>;
    setWorkspace(data);
    const team = (data.technicians || []) as Array<Record<string, unknown>>;
    setCompetencyDrafts(Object.fromEntries(team.map((person) => [
      String(person.id),
      ((person.competencies || []) as string[]).join(", "),
    ])));
  }

  useEffect(() => {
    reload().catch((reason) => setError(reason instanceof Error ? reason.message : "Section oversight could not be loaded."));
  }, []);

  async function saveCompetencies(userId: string) {
    setSavingUserId(userId);
    setError("");
    setMessage("");
    try {
      await api(`/api/v1/chief/team/${encodeURIComponent(userId)}/competencies`, {
        method: "PATCH",
        body: JSON.stringify({ competencies: (competencyDrafts[userId] || "").split(",") }),
      });
      setMessage("Technician competencies updated.");
      await reload();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Competencies could not be saved.");
    } finally {
      setSavingUserId("");
    }
  }

  if (!workspace) return <section className="page"><div className="page-heading"><div><p className="eyebrow">{user.section} · TECHNICAL SUPERVISION</p><h2>Section oversight</h2></div></div>{error ? <p className="error">{error}</p> : <p className="muted">Loading section work…</p>}</section>;
  const counts = (workspace.counts || {}) as Record<string, number>;
  const faults = (workspace.faults || []) as Array<Record<string, unknown>>;
  const team = (workspace.technicians || []) as Array<Record<string, unknown>>;
  const activeFaults = faults.filter((fault) => !["RESTORED", "CLOSED"].includes(String(fault.status)));
  const priorityRank: Record<string, number> = { Critical: 0, High: 1, Medium: 2, Low: 3 };
  const prioritize = (left: Record<string, unknown>, right: Record<string, unknown>) =>
    Number(right.overdue === true) - Number(left.overdue === true)
    || (priorityRank[String(left.severity)] ?? 4) - (priorityRank[String(right.severity)] ?? 4)
    || String(left.created_at).localeCompare(String(right.created_at));
  const sectionFaults = activeFaults.filter((fault) => fault.assigned_section === user.section).sort(prioritize);
  const reviewFaults = activeFaults.filter((fault) => fault.awaiting_review).sort(prioritize);
  const escalatedFaults = activeFaults.filter((fault) => fault.escalated).sort(prioritize);
  const faultLink = (fault: Record<string, unknown>) => `/faults?mode=history&fault=${encodeURIComponent(String(fault.id))}`;
  const metrics = [
    ["Awaiting assignment", counts.awaiting_assignment || 0],
    [`Active in ${user.section}`, counts.active_section || 0],
    ["Under investigation", counts.investigating || 0],
    ["Awaiting my review", counts.awaiting_review || 0],
    ["Overdue", counts.overdue || 0],
    ["Critical unresolved", counts.critical || 0],
  ];

  function renderFaults(rows: Array<Record<string, unknown>>, emptyMessage: string) {
    if (!rows.length) return <p className="muted">{emptyMessage}</p>;
    return <div className="chief-fault-list">{rows.slice(0, 6).map((fault) => (
      <NavLink className="chief-fault-item" key={String(fault.id)} to={faultLink(fault)}>
        <span><strong>{String(fault.reference)} · {String(fault.equipment_tag)}</strong><small>{String(fault.symptom)} · {String(fault.status).replace(/_/g, " ")}</small></span>
        <span className="chief-fault-meta">{fault.overdue === true && <b className="risk-text">Overdue</b>}{String(fault.severity) === "Critical" && <b className="risk-text">Critical</b>}<small>{fault.awaiting_review ? "Chief decision required" : fault.awaiting_assignment ? "Awaiting assignment" : `Assigned to ${String(fault.assigned_user_name || fault.assigned_section)}`}</small></span>
      </NavLink>
    ))}</div>;
  }

  return (
    <section className="page chief-workspace">
      <div className="page-heading"><div><p className="eyebrow">{user.section} · TECHNICAL SUPERVISION</p><h2>Section oversight</h2><p className="muted">Allocate work, review technical decisions and monitor your section’s full fault lifecycle.</p></div></div>
      {error && <p className="error">{error}</p>}
      {message && <p className="confirmation">{message}</p>}
      <div className="chief-workflow" aria-label="Fault responsibility flow"><span>Operations reports</span><b>Chief assigns</b><span>ST / PT investigate</span><b>Chief reviews</b><span>Operations confirms</span></div>
      <div className="metrics chief-metrics">{metrics.map(([label, value]) => <Metric key={String(label)} label={String(label)} value={String(value)} />)}</div>
      <div className="grid-two chief-queues">
        <div className="panel"><div className="section-heading"><div><h3>Needs Chief review</h3><p className="muted">Escalations and technical completion requests awaiting your decision.</p></div><span className="count">{reviewFaults.length}</span></div>{renderFaults(reviewFaults, "No review decisions are waiting.")}</div>
        <div className="panel"><div className="section-heading"><div><h3>Active section work</h3><p className="muted">Unassigned, allocated and in-progress faults in your section.</p></div><span className="count">{sectionFaults.length}</span></div>{renderFaults(sectionFaults, "No active faults are assigned to your section.")}<NavLink className="text-button" to="/faults">Browse section faults</NavLink></div>
      </div>
      <div className="panel chief-escalations"><div className="section-heading"><div><h3>Escalated from {user.section}</h3><p className="muted">The original fault remains visible with all section findings and evidence.</p></div><span className="count">{escalatedFaults.length}</span></div>{renderFaults(escalatedFaults, "No active fault has been escalated from your section.")}</div>
      <details className="panel chief-team">
        <summary className="section-heading"><div><h3>Technician pool</h3><p className="muted">ST/PT availability, active workload and competencies for assignment decisions.</p></div><span className="count">{team.filter((person) => person.active).length} active</span></summary>
        <div className="table"><table><thead><tr><th>Technician</th><th>Availability</th><th>Active work</th><th>Competencies</th><th></th></tr></thead><tbody>
          {team.map((person) => <tr key={String(person.id)}>
            <td><strong>{String(person.display_name)}</strong><br /><small>{String(person.role_label)}</small></td>
            <td>{person.active ? String(person.availability_status).toLowerCase() : "Inactive account"}</td>
            <td>{String(person.active_workload)}</td>
            <td><input aria-label={`Competencies for ${String(person.display_name)}`} value={competencyDrafts[String(person.id)] || ""} onChange={(event) => setCompetencyDrafts({ ...competencyDrafts, [String(person.id)]: event.target.value })} placeholder="SCADA, actuator controls, valve mechanisms" /></td>
            <td><button className="secondary" disabled={savingUserId === String(person.id)} onClick={() => saveCompetencies(String(person.id))}>Save</button></td>
          </tr>)}
          {!team.length && <tr><td colSpan={5}>No Senior or Principal Technicians are configured for this section.</td></tr>}
        </tbody></table></div>
      </details>
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
          <div className="table"><table><thead><tr><th>Section</th><th>Ops reports</th><th>Automation triage</th><th>Assigned</th><th>Handoffs sent</th><th>Handoffs received</th><th>Acknowledged</th><th>Restored</th><th>Knowledge uses</th></tr></thead><tbody>
            {Object.entries(handoffs).map(([section, row]) => <tr key={section}><td><strong>{section}</strong></td><td>{String(row.operations_reports ?? 0)}</td><td>{String(row.systems_automation_triage ?? 0)}</td><td>{String(row.assigned_to_section ?? 0)}</td><td>{String(row.section_handoffs_sent ?? 0)}</td><td>{String(row.section_handoffs_received ?? 0)}</td><td>{String(row.section_acknowledgements ?? 0)}</td><td>{String(row.restorations ?? 0)}</td><td>{String(row.knowledge_reuses ?? 0)}</td></tr>)}
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
  const [fromCache, setFromCache] = useState(false);
  useEffect(() => {
    const sectionScoped = ["technician_st", "technician_pt", "technician_ct", "assistant_engineer", "engineer", "senior_engineer", "chief_engineer"].includes(user.role);
    const timer = window.setTimeout(() => {
      api(`/api/v1/equipment?search=${encodeURIComponent(search)}`).then(async (rows) => {
        setItems(rows);
        setFromCache(false);
        await cacheEquipment(rows);
      }).catch(async (reason) => {
        if (!isOfflineError(reason)) return;
        setItems(await searchCachedEquipment(search, sectionScoped ? user.section : undefined, 100));
        setFromCache(true);
      });
    }, 200);
    return () => window.clearTimeout(timer);
  }, [search, user.role, user.section]);
  return (
    <section className="page">
      <div className="page-heading"><div><p className="eyebrow">SIMULATED ASSET REGISTRY</p><h2>Equipment</h2>{fromCache && <p className="muted">Offline: showing equipment cached on this device.</p>}</div></div>
      <div className="toolbar"><div className="search"><Search size={17} /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search tag or name" /></div></div>
      <div className="table panel"><table><thead><tr><th>Tag</th><th>Name</th><th>Station</th><th>Section</th><th>Criticality</th></tr></thead><tbody>{items.map((item) => <tr key={String(item.id)}><td><strong>{String(item.tag)}</strong></td><td>{String(item.name)}</td><td>{String(item.station)}</td><td>{String(item.section)}</td><td><span className="tag">{String(item.criticality)}</span></td></tr>)}</tbody></table></div>
    </section>
  );
}

function Faults({ user }: { user: User }) {
  const [faults, setFaults] = useState<Array<Record<string, unknown>>>([]);
  const [equipmentMatches, setEquipmentMatches] = useState<Array<Record<string, unknown>>>([]);
  const [equipmentId, setEquipmentId] = useState("");
  const [equipmentSearch, setEquipmentSearch] = useState("");
  const [equipmentConfirmed, setEquipmentConfirmed] = useState(false);
  const [reportedLocation, setReportedLocation] = useState("");
  const [reportedOnBehalf, setReportedOnBehalf] = useState("");
  const [operatingConditions, setOperatingConditions] = useState("");
  const [evidenceFiles, setEvidenceFiles] = useState<File[]>([]);
  const [symptom, setSymptom] = useState("");
  const [operationalImpact, setOperationalImpact] = useState("");
  const [additionalDetails, setAdditionalDetails] = useState("");
  const [severity, setSeverity] = useState("Medium");
  const [message, setMessage] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [error, setError] = useState("");
  const [repeatInsight, setRepeatInsight] = useState<{ repeat_count?: number; last_occurrence?: { date?: string }; suggested_section?: string } | null>(null);
  const [historySearch, setHistorySearch] = useState("");
  const [historyScope, setHistoryScope] = useState("");
  const [searchParams, setSearchParams] = useSearchParams();
  const initialMode = searchParams.get("mode") === "report" ? "report" : "history";
  const [mode, setMode] = useState<"report" | "history">(initialMode);
  const selectedEquipment = equipmentMatches.find((item) => String(item.id) === equipmentId);
  const technicalRoles = ["technician_st", "technician_pt", "technician_ct", "assistant_engineer", "engineer", "senior_engineer", "chief_engineer"];

  async function loadFaults(preferredId = "", scope = historyScope, search = historySearch) {
    const params = new URLSearchParams();
    if (scope === "mine") params.set("queue", "mine");
    else if (scope) params.set("history_scope", scope);
    if (search.trim()) params.set("search", search.trim());
    const rows = await api(`/api/v1/faults?${params.toString()}`);
    // Reports queued on this device appear until the server acknowledges them.
    const localPending = await db.faults.filter((row) => Boolean(row.offline_pending) && row.reporter_id === user.id).toArray();
    setFaults([...localPending, ...rows]);
    await cacheFaults(rows);
    if (preferredId) setSelectedId(preferredId);
    else if (!selectedId && rows.length) setSelectedId(String(rows[0].id));
  }

  useEffect(() => {
    const requestedFault = searchParams.get("fault");
    const requestedMode = searchParams.get("mode");
    const requestedScope = searchParams.get("scope") || "";
    if (requestedFault) setSelectedId(requestedFault);
    if (requestedMode === "report" || requestedMode === "history") setMode(requestedMode);
    setHistoryScope(["mine", "reported_by_me", "worked_by_me"].includes(requestedScope) ? requestedScope : "");
  }, [searchParams]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      loadFaults().catch(async () => {
      const cached = await db.faults.toArray();
      const sectionScoped = technicalRoles.includes(user.role);
      const equipment = await db.equipment.toArray();
      const sectionEquipment = new Set(equipment.filter((item) => item.section === user.section).map((item) => item.id));
      const term = historySearch.trim().toLowerCase();
      const visible = cached
        .filter((item) => item.offline_pending || !sectionScoped || item.assigned_section === user.section || sectionEquipment.has(String(item.equipment_id)))
        .filter((item) => !term || [item.reference, item.symptom, item.equipment_tag].some((value) => String(value ?? "").toLowerCase().includes(term)))
        .sort((left, right) => String(right.created_at ?? "").localeCompare(String(left.created_at ?? "")));
      setFaults(visible);
      if (!selectedId && visible.length) setSelectedId(String(visible[0].id));
      setError("Offline: showing breakdowns cached on this device. Investigations opened before going offline are available.");
      });
    }, 250);
    return () => window.clearTimeout(timer);
  }, [historyScope, historySearch, user.role, user.section]);

  useEffect(() => {
    const query = equipmentSearch.trim();
    if (query.length < 2) {
      setEquipmentMatches([]);
      return;
    }
    let active = true;
    const timer = window.setTimeout(() => {
      api(`/api/v1/equipment?search=${encodeURIComponent(query)}`)
        .then((items) => { if (active) setEquipmentMatches(items); })
        .catch(async (reason) => {
          const sectionScoped = technicalRoles.includes(user.role);
          const cached = isOfflineError(reason) ? await searchCachedEquipment(query, sectionScoped ? user.section : undefined) : [];
          if (active) setEquipmentMatches(cached);
        });
    }, 250);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [equipmentSearch]);

  useEffect(() => {
    if (!equipmentId || !equipmentConfirmed) {
      setRepeatInsight(null);
      return;
    }
    api(`/api/v1/intelligence/equipment/${encodeURIComponent(equipmentId)}`)
      .then(setRepeatInsight)
      .catch(() => setRepeatInsight(null));
  }, [equipmentId, equipmentConfirmed]);

  async function report() {
    if (!symptom.trim() || !operationalImpact.trim() || (!equipmentSearch.trim() && !reportedLocation.trim())) {
      setError("Add what is happening, its effect on operation, and either an equipment description or a known location.");
      return;
    }
    const payload = {
      ...(equipmentId ? { equipment_id: equipmentId } : {}),
      equipment_confirmed: Boolean(equipmentId && equipmentConfirmed),
      reported_equipment_text: equipmentSearch.trim(),
      reported_location: reportedLocation.trim(),
      reported_on_behalf_of: reportedOnBehalf.trim(),
      operating_conditions: operatingConditions.trim(),
      category: String(selectedEquipment?.category || "Unconfirmed"),
      symptom: symptom.trim(),
      severity,
      description: additionalDetails.trim(),
      operational_impact: operationalImpact.trim(),
    };
    let created: { id: string; reference: string; asset_confirmation_required?: boolean };
    try {
      created = await api("/api/v1/faults", { method: "POST", body: JSON.stringify(payload) });
    } catch (reportError) {
      if (isOfflineError(reportError)) {
        const { faultId } = await queueFaultReport(user, payload, { equipment_tag: selectedEquipment?.tag });
        for (const file of evidenceFiles) await queueAttachment(user.id, faultId, file);
        setEvidenceFiles([]);
        setMessage(`${OFFLINE_SAVED} The official reference is assigned when it reaches the server${evidenceFiles.length ? `; ${evidenceFiles.length} evidence file(s) will upload after it` : ""}.`);
        setError("");
        setSelectedId(faultId);
        setMode("history");
        setSearchParams({ mode: "history", fault: faultId });
        setFaults(await db.faults.filter((row) => Boolean(row.offline_pending) && row.reporter_id === user.id).toArray().then((local) => [...local, ...faults.filter((row) => !row.offline_pending)]));
      } else {
        setError(`Could not submit the breakdown. ${reportError instanceof Error ? reportError.message : ""}`);
      }
      return;
    }
    let reportMessage = created.asset_confirmation_required
      ? `Breakdown reported: ${created.reference}. Asset identification is unconfirmed and requires confirmation.`
      : `Breakdown reported: ${created.reference}`;
    const failedUploads: string[] = [];
    for (const file of evidenceFiles) {
      const form = new FormData();
      form.append("file", file);
      try {
        await api(`/api/v1/faults/${encodeURIComponent(created.id)}/attachments`, { method: "POST", body: form });
      } catch (reason) {
        failedUploads.push(`${file.name}: ${reason instanceof Error ? reason.message : "upload failed"}`);
      }
    }
    setEvidenceFiles([]);
    if (failedUploads.length) {
      reportMessage += ` Evidence upload failed for: ${failedUploads.join(", ")}. Reopen this breakdown and attach those files.`;
    }
    setMessage(reportMessage);
    setError("");
    setSelectedId(created.id);
    setMode("history");
    setSearchParams({ mode: "history", fault: created.id });
    setHistoryScope("");
    setHistorySearch("");
    try {
      await loadFaults(created.id, "", "");
    } catch {
      setError("Breakdown reported, but the history list could not be refreshed.");
    }
  }

  return (
    <section className="page">
      <div className="page-heading"><div><p className="eyebrow">BREAKDOWN WORKFLOW</p><h2>{technicalRoles.includes(user.role) || user.role === "systems_automation" ? "Breakdowns" : "Faults"}</h2><p className="muted">Report clearly, confirm uncertain assets safely, and find what was done before.</p></div></div>
      <div className="work-tabs">
        {(user.permissions || []).includes("faults.report") && <button className={mode === "report" ? "active" : ""} onClick={() => { setMessage(""); setError(""); setMode("report"); setSearchParams({ mode: "report" }); }}><Plus size={16} /> Report a breakdown</button>}
        <button className={mode === "history" ? "active" : ""} onClick={() => { setMode("history"); setSearchParams({ mode: "history" }); }}><History size={16} /> Find previous work</button>
      </div>
      {mode === "report" && (user.permissions || []).includes("faults.report") && <div className="panel quick-report">
        <h3>Tell us what you can see</h3>
        <p className="muted">Use the tag if you know it. Otherwise describe the equipment and area in your own words. Do not guess a tag.</p>
        <div className="report-grid">
          <label>Equipment tag or description
            <input value={equipmentSearch} onChange={(event) => { setEquipmentSearch(event.target.value); setEquipmentId(""); setEquipmentConfirmed(false); }} placeholder="e.g. inlet valve not opening, near 11-TK-601" />
          </label>
          <label>Known area or location
            <input value={reportedLocation} onChange={(event) => setReportedLocation(event.target.value)} placeholder="Plant, station, area, or nearby equipment" />
          </label>
          <label>What is happening?
            <textarea required value={symptom} onChange={(event) => setSymptom(event.target.value)} placeholder="Describe what you observed" />
          </label>
          <label>Effect on operation
            <textarea required value={operationalImpact} onChange={(event) => setOperationalImpact(event.target.value)} placeholder="What is stopped, reduced, or affected?" />
          </label>
        </div>
        {equipmentSearch.trim().length >= 2 && <div className="asset-matches">
          <strong>Possible equipment matches</strong>
          {equipmentMatches.length ? equipmentMatches.slice(0, 5).map((item) => (
            <button type="button" className={`asset-match ${equipmentId === String(item.id) ? "selected" : ""}`} key={String(item.id)} onClick={() => { setEquipmentId(String(item.id)); setEquipmentConfirmed(false); }}>
              <span><strong>{String(item.tag)} · {String(item.name)}</strong><small>{String(item.location)} · {String(item.station)} · {String(item.section)}</small></span>
              <span className="tag">{equipmentId === String(item.id) ? "Selected suggestion" : "Possible match"}</span>
            </button>
          )) : <p className="muted">No matching asset found. You can still report using your description and location.</p>}
          {equipmentId && <label className="asset-confirmation"><input type="checkbox" checked={equipmentConfirmed} onChange={(event) => setEquipmentConfirmed(event.target.checked)} /> I am sure this is the exact equipment</label>}
          {equipmentId && <button className="text-button" type="button" onClick={() => { setEquipmentId(""); setEquipmentConfirmed(false); }}>Not sure / asset not listed</button>}
        </div>}
        <details className="report-more"><summary>Optional details</summary>
          <label>Operating conditions<textarea value={operatingConditions} onChange={(event) => setOperatingConditions(event.target.value)} placeholder="What was the equipment doing when the issue occurred?" /></label>
          <label>Reported on behalf of (optional)<input value={reportedOnBehalf} onChange={(event) => setReportedOnBehalf(event.target.value)} placeholder="Name or team" /></label>
          <label>Additional notes<textarea value={additionalDetails} onChange={(event) => setAdditionalDetails(event.target.value)} placeholder="Anything else that may help the standby team" /></label>
          <label>Priority<select value={severity} onChange={(event) => setSeverity(event.target.value)}>{["Low", "Medium", "High", "Critical"].map((value) => <option key={value}>{value}</option>)}</select></label>
          <label>Evidence (optional; up to 10 MiB per file)<input type="file" accept=".png,.jpg,.jpeg,.webp,.pdf,.csv,.txt,.json,.log" multiple onChange={(event) => setEvidenceFiles(Array.from(event.target.files || []))} /></label>
          {evidenceFiles.length > 0 && <small>{evidenceFiles.map((file) => file.name).join(", ")}</small>}
        </details>
        {error && <p className="error">{error}</p>}
        <button className="primary" onClick={report}>Submit breakdown</button>
      </div>}
      {message && <p className="confirmation">{message}</p>}
      {repeatInsight && Number(repeatInsight.repeat_count || 0) > 0 && <div className="repeat-banner">
        <strong>SEEN BEFORE:</strong> Same equipment has {String(repeatInsight.repeat_count)} occurrence(s) in the last 90 days.
        <span>Last: {repeatInsight.last_occurrence ? new Date(String(repeatInsight.last_occurrence.date)).toLocaleDateString() : "—"} · Suggested section: {String(repeatInsight.suggested_section)}</span>
        <span>Routing: Systems Automation responds first; the responsible section will inherit this breakdown history.</span>
      </div>}
      {mode === "history" && <>
        <div className="history-toolbar">
          <div className="search"><Search size={17} /><input value={historySearch} onChange={(event) => setHistorySearch(event.target.value)} placeholder="Search tag, description, symptom, or location" /></div>
          {(technicalRoles.includes(user.role) || user.role === "systems_automation" || user.role === "operations") && <select value={historyScope} onChange={(event) => {
            const scope = event.target.value;
            setHistoryScope(scope);
            setSelectedId("");
            setSearchParams({ mode: "history", ...(scope ? { scope } : {}) });
          }} aria-label="Filter previous work">
            <option value="">{user.role === "operations" ? "All breakdowns" : "All section work"}</option>
            {(technicalRoles.includes(user.role) || user.role === "systems_automation") && <option value="mine">Assigned to me · active</option>}
            <option value="reported_by_me">Reported by me</option>
            {(technicalRoles.includes(user.role) || user.role === "systems_automation") && <option value="worked_by_me">Worked by me</option>}
          </select>}
        </div>
        <p className="muted">Select a breakdown to review the reported problem, investigation history, prior fixes and unsuccessful attempts.</p>
        <div className="table panel"><table><thead><tr><th>Reference</th><th>Equipment / description</th><th>Reported by</th><th>Problem</th><th>Status</th><th>Section</th></tr></thead><tbody>{faults.map((fault) => <tr key={String(fault.id)} className={selectedId === String(fault.id) ? "selected-row" : "clickable-row"} onClick={() => { setSelectedId(String(fault.id)); setSearchParams({ mode: "history", ...(historyScope ? { scope: historyScope } : {}), fault: String(fault.id) }); }} tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter") { setSelectedId(String(fault.id)); setSearchParams({ mode: "history", ...(historyScope ? { scope: historyScope } : {}), fault: String(fault.id) }); } }}>
          <td><strong>{String(fault.reference)}</strong></td><td>{String(fault.equipment_tag || "Asset not identified")}{fault.equipment_confirmed === false && <small className="unconfirmed-label">Needs asset confirmation</small>}</td><td>{String(fault.reporter_name || "—")}</td><td>{String(fault.symptom)}</td><td>{String(fault.status)}</td><td>{String(fault.assigned_section || "Unassigned")}</td>
        </tr>)}</tbody></table></div>
        {!faults.length && <div className="empty">No breakdowns match this search.</div>}
        {selectedId && <FaultDetail key={selectedId} user={user} faultId={selectedId} onRefresh={loadFaults} />}
      </>}
    </section>
  );
}

type DataRow = Record<string, unknown>;
type FaultContext = {
  fault: DataRow;
  assignments: DataRow[];
  attachments: DataRow[];
  operator_updates: DataRow[];
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

function dateTimeLocal(value: unknown) {
  if (!value) return "";
  const date = new Date(String(value));
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

function FaultDetail({ user, faultId, onRefresh }: { user: User; faultId: string; onRefresh: () => Promise<void> }) {
  const [context, setContext] = useState<FaultContext | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [diagnosis, setDiagnosis] = useState({ possible_cause: "", diagnostic_method: "", observations: "", test_results: "", confidence: "", quick_check: "", fix_summary: "", workaround: false, risk_level: "Normal" });
  const [intervention, setIntervention] = useState({ diagnosis_id: "", corrective_action: "", tools_materials: "", outcome: "SUCCESS", notes: "" });
  const [procedure, setProcedure] = useState({ title: "", observed_symptom: "", confirmed_cause: "", diagnostic_procedure: "", corrective_action: "", safety: "" });
  const [triageSection, setTriageSection] = useState("");
  const [triageComment, setTriageComment] = useState("");
  const [triageAssetSearch, setTriageAssetSearch] = useState("");
  const [triageAssets, setTriageAssets] = useState<DataRow[]>([]);
  const [confirmedEquipmentId, setConfirmedEquipmentId] = useState("");
  const [revisionOf, setRevisionOf] = useState("");
  const [handoffSection, setHandoffSection] = useState("");
  const [handoffFindings, setHandoffFindings] = useState("");
  const [handoffRecommendation, setHandoffRecommendation] = useState("");
  const [technicianPool, setTechnicianPool] = useState<DataRow[]>([]);
  const [allocation, setAllocation] = useState({ assigned_user_id: "", severity: "Medium", response_due_at: "", instructions: "" });
  const [reviewComments, setReviewComments] = useState("");
  const [operatorNote, setOperatorNote] = useState("");
  const [operatorComments, setOperatorComments] = useState("");
  const [evidenceFiles, setEvidenceFiles] = useState<File[]>([]);
  const isSectionChief = user.role === "technician_ct";
  const canUpdateFault = (user.permissions || []).includes("faults.update");
  const canInvestigate = ["systems_automation", "technician_st", "technician_pt", "assistant_engineer", "engineer", "senior_engineer", "chief_engineer"].includes(user.role);
  const canContribute = (user.permissions || []).includes("knowledge.contribute");
  const canTriage = (user.permissions || []).includes("faults.triage") || (user.permissions || []).includes("faults.triage.section");

  const [offlineView, setOfflineView] = useState(false);

  async function reload() {
    let loaded: FaultContext;
    try {
      loaded = await api(`/api/v1/faults/${encodeURIComponent(faultId)}/context`) as FaultContext;
      await cacheFaultContext(faultId, loaded as unknown as Record<string, unknown>);
      setOfflineView(false);
    } catch (reason) {
      const cached = isOfflineError(reason) || (reason instanceof ApiError && reason.status === 404)
        ? await cachedFaultContext(faultId)
        : undefined;
      if (!cached) {
        const summary = await db.faults.get(faultId);
        if (summary?.offline_pending) {
          // Reported on this device and not yet on the server.
          setContext({
            fault: summary, assignments: [], attachments: [], operator_updates: [], timeline: [], diagnoses: [],
            interventions: [], previous_faults: [], approved_procedures: [], legacy_knowledge: [], procedure_updates: [], reuse_records: [],
          } as unknown as FaultContext);
          setOfflineView(true);
          return;
        }
        throw isOfflineError(reason)
          ? new Error("This breakdown was not opened while connected, so its investigation is not on this device yet.")
          : reason;
      }
      loaded = cached.context as unknown as FaultContext;
      setOfflineView(true);
    }
    setContext(loaded);
    setTriageSection((current) => current || String(loaded.fault.assigned_section || loaded.fault.suggested_section || ""));
    const active = loaded.assignments.find((item) => Boolean(item.is_active));
    setAllocation({
      assigned_user_id: String(active?.assigned_user_id || ""),
      severity: String(loaded.fault.severity || "Medium"),
      response_due_at: dateTimeLocal(active?.response_due_at),
      instructions: String(active?.instructions || ""),
    });
  }

  useEffect(() => {
    reload().catch((reason) => setError(reason instanceof Error ? reason.message : "Investigation history could not be loaded."));
  }, [faultId]);

  useEffect(() => {
    if (isSectionChief) {
      api("/api/v1/chief/team").then(setTechnicianPool).catch((reason) => setError(reason instanceof Error ? reason.message : "Section technician pool could not be loaded."));
    }
  }, [isSectionChief, user.section]);

  useEffect(() => {
    const query = triageAssetSearch.trim();
    if (query.length < 2) {
      setTriageAssets([]);
      return;
    }
    let active = true;
    const timer = window.setTimeout(() => {
      api(`/api/v1/equipment?search=${encodeURIComponent(query)}`)
        .then((items) => { if (active) setTriageAssets(items); })
        .catch(() => { if (active) setTriageAssets([]); });
    }, 250);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [triageAssetSearch]);

  async function performAction(action: string) {
    setError("");
    setMessage("");
    try {
      await api(`/api/v1/faults/${encodeURIComponent(faultId)}/action?action=${action}`, { method: "POST" });
      setMessage(`Fault ${action.replace("_", " ")} recorded.`);
      await reload();
      await onRefresh();
    } catch (reason) {
      if (isOfflineError(reason)) {
        await queueFaultAction(user.id, faultId, action);
        setMessage(`${action.replace("_", " ")}: ${OFFLINE_SAVED}`);
        await reload();
        return;
      }
      setError(reason instanceof Error ? reason.message : "Fault action failed.");
    }
  }

  async function submitDiagnosis(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    const body = { ...diagnosis, confidence: diagnosis.confidence ? Number(diagnosis.confidence) : null };
    const clear = () => setDiagnosis({ possible_cause: "", diagnostic_method: "", observations: "", test_results: "", confidence: "", quick_check: "", fix_summary: "", workaround: false, risk_level: "Normal" });
    try {
      await api(`/api/v1/faults/${encodeURIComponent(faultId)}/diagnoses`, { method: "POST", body: JSON.stringify(body) });
      clear();
      setMessage("Diagnosis recorded. It remains unverified until an intervention confirms it.");
      await reload();
      await onRefresh();
    } catch (reason) {
      if (isOfflineError(reason)) {
        if (!body.possible_cause.trim() || !body.diagnostic_method.trim()) {
          setError("A possible cause and diagnostic method are required.");
          return;
        }
        await queueDiagnosis(user, faultId, body);
        clear();
        setMessage(`Diagnosis: ${OFFLINE_SAVED}`);
        await reload();
        return;
      }
      setError(reason instanceof Error ? reason.message : "Diagnosis could not be saved.");
    }
  }

  async function submitIntervention(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    const body = { ...intervention, diagnosis_id: intervention.diagnosis_id || null };
    const clear = () => setIntervention({ diagnosis_id: "", corrective_action: "", tools_materials: "", outcome: "SUCCESS", notes: "" });
    try {
      await api(`/api/v1/faults/${encodeURIComponent(faultId)}/interventions`, { method: "POST", body: JSON.stringify(body) });
      clear();
      setMessage("Intervention recorded; failed attempts remain in the history.");
      await reload();
    } catch (reason) {
      if (isOfflineError(reason)) {
        if (!body.corrective_action.trim()) {
          setError("A corrective action is required.");
          return;
        }
        await queueIntervention(user, faultId, body);
        clear();
        setMessage(`Intervention: ${OFFLINE_SAVED} Failed attempts are kept.`);
        await reload();
        return;
      }
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
          ...(confirmedEquipmentId ? { confirmed_equipment_id: confirmedEquipmentId } : {}),
        }),
      });
      setMessage(fault.equipment_confirmed === false ? "Asset confirmation recorded; the breakdown remains with Systems Automation." : "Asset confirmation note recorded.");
      setTriageComment("");
      setConfirmedEquipmentId("");
      setTriageAssetSearch("");
      await reload();
      await onRefresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Triage could not be saved.");
    }
  }

  async function submitEscalation(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    try {
      await api(`/api/v1/faults/${encodeURIComponent(faultId)}/assignments/escalate`, {
        method: "POST",
        body: JSON.stringify({
          next_section: handoffSection,
          findings: handoffFindings,
          recommendation: handoffRecommendation,
        }),
      });
      setHandoffSection("");
      setHandoffFindings("");
      setHandoffRecommendation("");
      setMessage(`Findings handed to ${handoffSection}; the breakdown record remains continuous.`);
      await reload();
      await onRefresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Section handoff could not be saved.");
    }
  }

  async function saveAllocation(event: React.FormEvent) {
    event.preventDefault();
    const assignment = context?.assignments.find((item) => Boolean(item.is_active));
    if (!assignment) return;
    setError("");
    try {
      await api(`/api/v1/faults/${encodeURIComponent(faultId)}/assignments/${encodeURIComponent(String(assignment.id))}/allocate`, {
        method: "POST",
        body: JSON.stringify({
          ...allocation,
          assigned_user_id: allocation.assigned_user_id || null,
          response_due_at: allocation.response_due_at ? new Date(allocation.response_due_at).toISOString() : null,
        }),
      });
      setMessage("Section assignment and response target saved.");
      await reload();
      await onRefresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Section assignment could not be saved.");
    }
  }

  async function reviewSectionWork(decision: string) {
    const assignment = context?.assignments.find((item) => Boolean(item.is_active));
    if (!assignment) return;
    if (decision.startsWith("RETURN_") && !reviewComments.trim()) {
      setError("Add clear instructions before returning work for more investigation.");
      return;
    }
    setError("");
    try {
      await api(`/api/v1/faults/${encodeURIComponent(faultId)}/assignments/${encodeURIComponent(String(assignment.id))}/review`, {
        method: "POST",
        body: JSON.stringify({ decision, comments: reviewComments }),
      });
      setReviewComments("");
      setMessage(decision.startsWith("APPROVE_") ? "Chief technical review approved." : "Work returned with your instructions.");
      await reload();
      await onRefresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Technical review could not be saved.");
    }
  }

  async function submitOperatorUpdate(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    try {
      await api(`/api/v1/faults/${encodeURIComponent(faultId)}/operator-updates`, {
        method: "POST",
        body: JSON.stringify({ note: operatorNote }),
      });
      setOperatorNote("");
      setMessage("Progress update sent to the responding teams.");
      await reload();
    } catch (reason) {
      if (isOfflineError(reason) && operatorNote.trim()) {
        await queueOperatorUpdate(user, faultId, operatorNote.trim());
        setOperatorNote("");
        setMessage(`Progress update: ${OFFLINE_SAVED}`);
        await reload();
        return;
      }
      setError(reason instanceof Error ? reason.message : "Operator update could not be saved.");
    }
  }

  async function confirmRestoration(confirmed: boolean) {
    setError("");
    try {
      await api(`/api/v1/faults/${encodeURIComponent(faultId)}/operator-confirmation`, {
        method: "POST",
        body: JSON.stringify({ confirmed, comments: operatorComments }),
      });
      setOperatorComments("");
      setMessage(confirmed ? "Operational restoration confirmed; the breakdown is closed." : "Restoration not confirmed; work has returned to the responsible section.");
      await reload();
      await onRefresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Operator confirmation could not be saved.");
    }
  }

  async function uploadEvidence() {
    setError("");
    const failed: string[] = [];
    const failedFiles: File[] = [];
    for (const file of evidenceFiles) {
      const form = new FormData();
      form.append("file", file);
      try {
        await api(`/api/v1/faults/${encodeURIComponent(faultId)}/attachments`, { method: "POST", body: form });
      } catch (reason) {
        failedFiles.push(file);
        failed.push(`${file.name}: ${reason instanceof Error ? reason.message : "upload failed"}`);
      }
    }
    setEvidenceFiles(failedFiles);
    if (failed.length) {
      setError(`Evidence could not be uploaded: ${failed.join(", ")}.`);
    } else {
      setMessage("Evidence added to this breakdown.");
    }
    await reload();
  }

  async function downloadEvidence(attachmentId: string, filename: string) {
    setError("");
    try {
      const token = localStorage.getItem("kpc-token");
      const response = await networkFetch(`${API}/api/v1/faults/${encodeURIComponent(faultId)}/attachments/${encodeURIComponent(attachmentId)}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!response.ok) throw new Error(await response.text());
      const objectUrl = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = filename;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Evidence could not be downloaded.");
    }
  }

  if (!context) return <div className="panel"><h3>Fault work history</h3>{error ? <p className="error">{error}</p> : <p className="muted">Loading fault history…</p>}</div>;
  const fault = context.fault;
  const statusValue = String(fault.status);
  const activeAssignment = context.assignments.find((item) => Boolean(item.is_active));
  const canWorkAssignment = !isSectionChief && Boolean(activeAssignment) && (
    user.role === "systems_automation"
      ? activeAssignment?.section === "Systems Automation"
      : canInvestigate
        ? activeAssignment?.section === user.section
        : true
  );
  const canReviewSectionAssignment = isSectionChief && activeAssignment?.section === user.section;
  const awaitingChiefReview = statusValue === "AWAITING_CHIEF_REVIEW"
    || activeAssignment?.escalation_status === "PENDING"
    || activeAssignment?.completion_review_status === "PENDING";
  const canTriageCurrent = canTriage && (
    !activeAssignment || (
      activeAssignment.section === "Systems Automation"
      && ["systems_automation", "maintenance_manager", "supervisor", "system_administrator"].includes(user.role)
    )
  );
  const canConfirmRestoration = user.role === "operations" && (user.permissions || []).includes("faults.confirm");
  const canAttachEvidence = user.role === "operations" || canWorkAssignment
    || ["maintenance_manager", "general_manager_om", "supervisor", "system_administrator"].includes(user.role);
  const hasSuccessfulIntervention = context.interventions.some((item) => item.outcome === "SUCCESS");
  const canSubmitProcedure = canContribute && ["RESTORED", "CLOSED"].includes(statusValue) && hasSuccessfulIntervention;
  const updateActions = user.permissions || [];
  const restrictedTriage = ["technician_ct", "chief_engineer"].includes(user.role);
  const allSections = ["Systems Automation", "Electrical", "Instrumentation", "Mechanical"];
  const triageOptions = (activeAssignment?.section === "Systems Automation" ? ["Systems Automation"] : allSections).filter((section) => {
    if (!restrictedTriage) return true;
    if (context?.fault.equipment_confirmed === false && !confirmedEquipmentId && section === "Systems Automation") return true;
    return section === user.section;
  });
  const unresolvedReuse = context.reuse_records.filter((item) => item.actor_id === user.id && !item.outcome);

  return (
    <div className="fault-detail">
      {offlineView && (
        <div className="offline-banner" role="status">
          <CloudOff size={16} />
          {fault.offline_pending
            ? "Reported on this device and waiting to synchronise. Investigation steps become available once Systems Automation receives it."
            : "Offline: this is the copy saved on this device. Acknowledge, on-site, diagnosis, intervention and operator updates are queued; other steps need a connection."}
        </div>
      )}
      <div className="panel">
        <div className="section-heading"><div><p className="eyebrow">WORK ORDER CONTEXT</p><h3>{String(fault.reference)} · {String(fault.equipment_tag)}</h3><p>{String(fault.symptom)} · {String(fault.description || "No additional report details")}</p>{Boolean(fault.operating_conditions) && <p><strong>Operating conditions:</strong> {String(fault.operating_conditions)}</p>}{Boolean(fault.operational_impact) && <p><strong>Operational effect:</strong> {String(fault.operational_impact)}</p>}</div><span className="status">{statusValue}</span></div>
        <p className="muted">Assigned section: {String(fault.assigned_section || "Unassigned")} · Reported by {String(fault.reporter_name || "Unknown")} · {new Date(String(fault.created_at)).toLocaleString()}{fault.reported_on_behalf_of ? ` · On behalf of ${String(fault.reported_on_behalf_of)}` : ""}</p>
        {fault.equipment_confirmed === false && <div className="unconfirmed-banner">
          <strong>Asset not confirmed</strong>
          <span>Reported wording: {String(fault.reported_equipment_text || "Not provided")}{Boolean(fault.reported_location) ? ` · Location: ${String(fault.reported_location)}` : ""}</span>
          {Boolean(fault.suggested_equipment_tag) && <span>Possible match only: {String(fault.suggested_equipment_tag)}</span>}
          <span>Do not use the suggestion as a confirmed tag. Confirm the physical asset before routing to its maintenance section.</span>
        </div>}
        {context.previous_faults.length > 0 && <p className="repeat-alert">Seen before on this equipment: {context.previous_faults.length} earlier report(s). Review the diagnosis and intervention history before repeating work.</p>}
        {canTriageCurrent && <form className="triage-form" onSubmit={submitTriage}>
          <strong>Systems Automation asset confirmation</strong><span className="muted">{fault.equipment_confirmed === false ? "Confirm the actual equipment before any section handoff." : `Suggested owner section: ${String(fault.suggested_section || "Not set")}. This breakdown remains with Systems Automation until findings are handed off.`}</span>
          {fault.equipment_confirmed === false && <label>Find the actual equipment by tag or description
            <input value={triageAssetSearch} onChange={(event) => { setTriageAssetSearch(event.target.value); setConfirmedEquipmentId(""); }} placeholder="Search equipment records" />
          </label>}
          {fault.equipment_confirmed === false && triageAssets.slice(0, 5).map((item) => <button type="button" className={`asset-match ${confirmedEquipmentId === String(item.id) ? "selected" : ""}`} key={String(item.id)} onClick={() => { setConfirmedEquipmentId(String(item.id)); setTriageSection("Systems Automation"); }}>
            <span><strong>{String(item.tag)} · {String(item.name)}</strong><small>{String(item.location)} · {String(item.section)}</small></span><span className="tag">{confirmedEquipmentId === String(item.id) ? "Confirmed asset" : "Select actual asset"}</span>
          </button>)}
          <div className="form-grid"><label>Current section<select value={triageSection || String(fault.assigned_section || "Systems Automation")} onChange={(event) => setTriageSection(event.target.value)} required>{triageOptions.map((section) => <option key={section} value={section}>{section}</option>)}</select></label><label>Asset confirmation note<input value={triageComment} onChange={(event) => setTriageComment(event.target.value)} /></label></div>
          <button className="secondary" type="submit">{fault.equipment_confirmed === false ? confirmedEquipmentId ? "Confirm asset; keep with Systems Automation" : "Keep unconfirmed with Systems Automation" : "Save asset confirmation"}</button>
        </form>}
        {canUpdateFault && canWorkAssignment && fault.equipment_confirmed !== false && <div className="action-row">
          {["REPORTED", "TRIAGED", "ASSIGNED"].includes(statusValue) && updateActions.includes("faults.update") && <button className="secondary" onClick={() => performAction("acknowledge")}>Acknowledge</button>}
          {statusValue === "ACKNOWLEDGED" && updateActions.includes("faults.update") && <button className="secondary" onClick={() => performAction("on_site")}>On site</button>}
          {["ON_SITE", "ACKNOWLEDGED"].includes(statusValue) && updateActions.includes("faults.update") && <button className="secondary" onClick={() => performAction("diagnose")}>Mark diagnosed</button>}
          {!["RESTORED", "CLOSED", "AWAITING_CHIEF_REVIEW"].includes(statusValue) && updateActions.includes("faults.restore") && <button className="primary" onClick={() => performAction("restore")}>Request technical completion review</button>}
        </div>}
        {canUpdateFault && fault.equipment_confirmed === false && <p className="muted">Technical actions are disabled until the physical equipment is confirmed.</p>}
        {statusValue === "AWAITING_CHIEF_REVIEW" && <p className="repeat-alert">Work is waiting for Chief Technician review. Operations cannot confirm restoration until technical completion is approved.</p>}
        {statusValue === "RESTORED" && <p className="confirmation">Chief technical review is complete. Waiting for Operations to confirm service restoration.</p>}
        {Boolean(fault.closure_remarks) && <p><strong>Operator closure remarks:</strong> {String(fault.closure_remarks)}</p>}
        {message && <p className="confirmation">{message}</p>}
        {error && <p className="error">{error}</p>}
      </div>

      {context.assignments.length > 0 && <div className="panel assignment-chain">
        <div className="section-heading"><div><p className="eyebrow">ACCOUNTABLE SECTION HANDOFFS</p><h3>One breakdown, shared findings</h3></div><span className="muted">Active section: {String(activeAssignment?.section || "Awaiting operator confirmation")}</span></div>
        <div className="assignment-list">{context.assignments.map((item, index) => <article className="assignment-card" key={String(item.id)}>
          <div className="assignment-heading"><strong>{index + 1}. {String(item.section)}</strong><span className={`status ${String(item.status).toLowerCase()}`}>{String(item.status).replace(/_/g, " ")}</span></div>
          <small>{item.assigned_user_name ? `Owner: ${String(item.assigned_user_name)}` : "Awaiting section acknowledgement"} · {new Date(String(item.created_at)).toLocaleString()} · {String(item.elapsed_minutes)} min in assignment</small>
          {Boolean(item.reason) && <p><strong>Handoff reason:</strong> {String(item.reason)}</p>}
          {Boolean(item.instructions) && <p><strong>Chief Technician instructions:</strong> {String(item.instructions)}</p>}
          {Boolean(item.response_due_at) && <p><strong>Expected response:</strong> {new Date(String(item.response_due_at)).toLocaleString()}</p>}
          {Boolean(item.findings) && <p><strong>Findings:</strong> {String(item.findings)}</p>}
          {Boolean(item.recommendation) && <p><strong>Recommended next action:</strong> {String(item.recommendation)}</p>}
          {item.escalation_status === "RETURNED" && Boolean(item.escalation_review_comments) && <p><strong>Chief review:</strong> {String(item.escalation_review_comments)}</p>}
          {item.completion_review_status === "RETURNED" && Boolean(item.completion_review_comments) && <p><strong>Completion review:</strong> {String(item.completion_review_comments)}</p>}
        </article>)}</div>
        {canReviewSectionAssignment && fault.equipment_confirmed !== false && <form className="assignment-allocation" onSubmit={saveAllocation}>
          <h4>Allocate section work</h4>
          <p className="muted">Choose an available Senior or Principal Technician using current workload and their recorded competencies.</p>
          <div className="form-grid">
            <label>Assigned technician<select value={allocation.assigned_user_id} onChange={(event) => setAllocation({ ...allocation, assigned_user_id: event.target.value })}>
              <option value="">Leave in section queue</option>
              {technicianPool.filter((person) => person.active && (
                person.availability_status === "AVAILABLE" || String(person.id) === allocation.assigned_user_id
              )).map((person) => <option key={String(person.id)} value={String(person.id)}>
                {String(person.display_name)} · {String(person.role_label)} · {String(person.active_workload)} active · {((person.competencies || []) as string[]).join(", ") || "Competencies not recorded"}
              </option>)}
            </select></label>
            <label>Operational priority<select value={allocation.severity} onChange={(event) => setAllocation({ ...allocation, severity: event.target.value })}>{["Low", "Medium", "High", "Critical"].map((value) => <option key={value}>{value}</option>)}</select></label>
            <label>Expected response by<input type="datetime-local" value={allocation.response_due_at} onChange={(event) => setAllocation({ ...allocation, response_due_at: event.target.value })} required /></label>
          </div>
          <label>Technical instructions<textarea value={allocation.instructions} onChange={(event) => setAllocation({ ...allocation, instructions: event.target.value })} placeholder="Focus checks, permit constraints, or evidence to collect" /></label>
          <button className="primary" type="submit">{activeAssignment?.assigned_user_id ? "Save assignment / reassign" : "Assign work"}</button>
        </form>}
        {canReviewSectionAssignment && activeAssignment?.escalation_status === "PENDING" && <div className="section-review-panel">
          <h4>Review requested escalation to {String(activeAssignment.requested_next_section)}</h4>
          <p className="muted">Check the technician’s findings, evidence and recommendation above before transferring the next assignment.</p>
          <label>Review note or instructions<textarea value={reviewComments} onChange={(event) => setReviewComments(event.target.value)} placeholder="Required if returning for more investigation" /></label>
          <div className="action-row"><button className="primary" type="button" onClick={() => reviewSectionWork("APPROVE_ESCALATION")}>Approve escalation</button><button className="secondary" type="button" onClick={() => reviewSectionWork("RETURN_ESCALATION")}>Return for investigation</button></div>
        </div>}
        {canReviewSectionAssignment && activeAssignment?.completion_review_status === "PENDING" && <div className="section-review-panel">
          <h4>Review technical completion</h4>
          <p className="muted">Verify that corrective work and test results are documented. Approval marks the section restored; Operations must still confirm service.</p>
          <label>Review note or instructions<textarea value={reviewComments} onChange={(event) => setReviewComments(event.target.value)} placeholder="Required if returning for more work" /></label>
          <div className="action-row"><button className="primary" type="button" onClick={() => reviewSectionWork("APPROVE_COMPLETION")}>Approve technical completion</button><button className="secondary" type="button" onClick={() => reviewSectionWork("RETURN_COMPLETION")}>Return for more work</button></div>
        </div>}
        {canWorkAssignment && !awaitingChiefReview && fault.equipment_confirmed !== false && activeAssignment && <form className="handoff-form" onSubmit={submitEscalation}>
          <h4>Hand off to another section</h4>
          <p className="muted">The receiving team gets this fault, prior section findings, tests, and linked evidence.</p>
          <label>Next section<select value={handoffSection} onChange={(event) => setHandoffSection(event.target.value)} required>
            <option value="">Select section</option>{allSections.filter((section) => section !== activeAssignment.section).map((section) => <option key={section}>{section}</option>)}
          </select></label>
          <label>What did your section find?<textarea value={handoffFindings} onChange={(event) => setHandoffFindings(event.target.value)} required /></label>
          <label>What should the next section do?<textarea value={handoffRecommendation} onChange={(event) => setHandoffRecommendation(event.target.value)} required /></label>
          <button className="secondary" type="submit">Send with findings</button>
        </form>}
      </div>}

      <div className="panel evidence-panel">
        <div className="section-heading"><div><p className="eyebrow">SHARED EVIDENCE AND OPERATIONS UPDATES</p><h3>Progress and evidence</h3></div></div>
        {context.attachments.map((item) => {
          const assignment = context.assignments.find((entry) => entry.id === item.assignment_id);
          return <article className="evidence-item" key={String(item.id)}>
            <div><strong>{String(item.filename)}</strong><small>{String(item.uploaded_by)} · {assignment ? `${String(assignment.section)} section` : "Breakdown report"} · {Math.ceil(Number(item.size_bytes) / 1024)} KiB</small></div>
            <button className="secondary" type="button" onClick={() => downloadEvidence(String(item.id), String(item.filename))}>Download</button>
          </article>;
        })}
        {!context.attachments.length && <p className="muted">No evidence attached yet.</p>}
        {canAttachEvidence && statusValue !== "CLOSED" && <div className="evidence-upload">
          <label>Add images, PDFs, or text/log evidence (10 MiB max per file)<input type="file" accept=".png,.jpg,.jpeg,.webp,.pdf,.csv,.txt,.json,.log" multiple onChange={(event) => setEvidenceFiles(Array.from(event.target.files || []))} /></label>
          {evidenceFiles.length > 0 && <><small>{evidenceFiles.map((file) => file.name).join(", ")}</small><button className="secondary" type="button" onClick={uploadEvidence}>Upload evidence</button></>}
        </div>}
        {user.role === "operations" && statusValue !== "CLOSED" && <form className="operator-update-form" onSubmit={submitOperatorUpdate}>
          <h4>Send an update to the responding teams</h4>
          <label>New operating information<textarea value={operatorNote} onChange={(event) => setOperatorNote(event.target.value)} required placeholder="Add a change in conditions, access, or operational impact" /></label>
          <button className="secondary" type="submit">Send progress update</button>
        </form>}
        {context.operator_updates.map((item) => <article className="timeline-item" key={String(item.id)}>
          <strong>{String(item.event_type).replace(/_/g, " ")}</strong>
          <small>{String(item.actor_name)} · {new Date(String(item.created_at)).toLocaleString()}</small>
          <p>{String((item.payload as DataRow)?.note || (item.payload as DataRow)?.comments || "No additional comments")}</p>
        </article>)}
        {canConfirmRestoration && statusValue === "RESTORED" && <div className="operator-confirmation">
          <h4>Confirm service restoration</h4>
          <p className="muted">Check the valve or equipment against the applicable operating procedure before closing this breakdown.</p>
          <label>Confirmation notes<textarea value={operatorComments} onChange={(event) => setOperatorComments(event.target.value)} placeholder="Optional confirmation note; required if service is still affected" /></label>
          <div className="action-row">
            <button className="primary" type="button" onClick={() => confirmRestoration(true)}>Confirm restored and close</button>
            <button className="secondary" type="button" onClick={() => confirmRestoration(false)}>Still not working — return to section</button>
          </div>
        </div>}
      </div>

      {context.ranked_causes && context.ranked_causes.length > 0 && <div className="panel ranked-causes">
        <div className="section-heading"><div><p className="eyebrow">RANKED TROUBLESHOOTING</p><h3>Most likely causes and confirmed fixes</h3></div><span className="muted">{context.repeat_routing?.seen_before ? "Repeat history shared with Systems Automation first" : "Systems Automation first response"}</span></div>
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

      {canInvestigate && canWorkAssignment && !awaitingChiefReview && !["RESTORED", "CLOSED"].includes(statusValue) && <div className="grid-two">
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
          {context.diagnoses.map((item) => <article className="history-item" key={String(item.id)}><strong>Possible cause: {String(item.possible_cause)}</strong><small>{String(item.assignment_section || "Legacy record")} · {String(item.author_name)} · {String(item.verification_status)} · {new Date(String(item.created_at)).toLocaleString()}</small><p>{String(item.diagnostic_method)}</p><p>{String(item.observations)} {String(item.test_results)}</p></article>)}
          {context.interventions.map((item) => <article className={`history-item ${item.outcome === "FAILED" ? "failed-attempt" : ""}`} key={String(item.id)}><strong>{String(item.outcome)} intervention</strong><small>{String(item.assignment_section || "Legacy record")} · {String(item.actor_name)} · {new Date(String(item.created_at)).toLocaleString()}</small><p>{String(item.corrective_action)}</p><p>{String(item.tools_materials)} {String(item.notes)}</p></article>)}
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
    setUser(null);
  }
  return user ? <Shell user={user} onLogout={logout} /> : <Login onLogin={setUser} />;
}

createRoot(document.getElementById("root")!).render(<BrowserRouter><App /></BrowserRouter>);
