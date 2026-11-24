import { BookOpen, History, Plus } from "lucide-react";
import { useEffect, useState } from "react";
import { NavLink } from "react-router-dom";
import { type User } from "../../auth";
import { api } from "../../offline/api";

export function PersonalWorkspace({ user }: { user: User }) {
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
