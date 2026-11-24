import { useEffect, useState } from "react";
import { NavLink } from "react-router-dom";
import { type User } from "../../auth";
import { Metric } from "../../components/Metric";
import { api } from "../../offline/api";

export function ChiefTechnicianDashboard({ user }: { user: User }) {
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
