import { useEffect, useState } from "react";
import { type User } from "../../auth";
import { Bar, Metric } from "../../components/Metric";
import { type WorkflowReport } from "../../lib/types";
import { api } from "../../offline/api";
import { People, PeopleSummary } from "../people/People";
import { ChiefTechnicianDashboard } from "./ChiefTechnicianDashboard";
import { PersonalWorkspace } from "./PersonalWorkspace";
import { RecognitionPanel } from "./RecognitionPanel";
import { WorkflowPanel } from "./WorkflowPanel";

export function Dashboard({ user }: { user: User }) {
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
