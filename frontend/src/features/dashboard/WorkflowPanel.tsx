import { type WorkflowReport } from "../../lib/types";

export function WorkflowPanel({ workflow }: { workflow: WorkflowReport }) {
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
