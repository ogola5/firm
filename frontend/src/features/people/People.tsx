import React, { useEffect, useState } from "react";
import { type User } from "../../auth";
import { api } from "../../offline/api";

export function PeopleSummary() {
  const [summary, setSummary] = useState<Record<string, unknown> | null>(null);
  useEffect(() => { api("/api/v1/users/summary").then(setSummary).catch(() => setSummary(null)); }, []);
  if (!summary) return null;
  const sections = (summary.by_section || {}) as Record<string, number>;
  return <div className="panel workforce-summary"><h3>Workforce summary · counts only</h3><p>{String(summary.active_accounts)} active of {String(summary.total_accounts)} synthetic demonstration accounts</p><div className="workforce-counts">{Object.entries(sections).map(([section, count]) => <span key={section}>{section}: <strong>{count}</strong></span>)}</div></div>;
}

export function People({ user, compact = false }: { user: User; compact?: boolean }) {
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
