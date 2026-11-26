import { RankedBars } from "../../components/charts/RankedBars";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../components/ui/card";
import { Stat } from "../../components/ui/page";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../../components/ui/table";
import { type WorkflowReport } from "../../lib/types";

const FLOW = [
  ["Operations reports", "reported"],
  ["Sorted", "triaged"],
  ["Sent to a section", "assigned"],
  ["Someone took it", "acknowledged"],
  ["Fault restored", "restored"],
] as const;

const CRITICAL = [
  ["Report → triage", "report_to_triage_median"],
  ["Triage → acknowledge", "triage_to_acknowledge_median"],
  ["Acknowledge → diagnose", "acknowledge_to_diagnose_median"],
  ["Diagnose → restore", "diagnose_to_restore_median"],
  ["Restore → close", "restore_to_close_median"],
] as const;

const HANDOFF_COLUMNS = [
  ["Ops reports", "operations_reports"],
  ["Automation triage", "systems_automation_triage"],
  ["Assigned", "assigned_to_section"],
  ["Handoffs sent", "section_handoffs_sent"],
  ["Handoffs received", "section_handoffs_received"],
  ["Acknowledged", "section_acknowledgements"],
  ["Restored", "restorations"],
  ["Knowledge uses", "knowledge_reuses"],
] as const;

const minutes = (value: number | string | null | undefined) => (value == null ? "—" : `${value} min`);

export function WorkflowPanel({ workflow }: { workflow: WorkflowReport }) {
  const stages = workflow.stages || {};
  const handoffs = workflow.handoffs_by_section || {};
  const critical = workflow.critical_window_minutes || {};
  const comparison = workflow.resolution_comparison || {};

  return (
    <Card className="mt-4">
      <CardHeader>
        <CardTitle>Operations → Maintenance handoffs</CardTitle>
        <CardDescription>The intake, triage, section response and restoration path. This is a workflow baseline, not a downtime-reduction claim.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-6">
        <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
          {FLOW.map(([label, key]) => <Stat key={key} label={label} value={stages[key] ?? 0} />)}
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          <div>
            <h4 className="m-0 mb-2 text-sm font-bold">Critical window — median minutes per step</h4>
            <RankedBars
              title="Median minutes per workflow step"
              sort={false}
              labelWidth={185}
              format={(value) => `${value} min`}
              data={CRITICAL.map(([label, key]) => ({ label, value: critical[key] ?? null }))}
            />
            <p className="mb-0 text-xs text-muted-foreground">
              First-fault median {minutes(comparison.first_fault_median_minutes)} · repeat-fault median {minutes(comparison.repeat_fault_median_minutes)} ·
              target {String(comparison.repeat_target_reduction_percent ?? 60)}% faster than comparable first faults. {String(comparison.baseline_status || "")}
            </p>
          </div>
          <div>
            <h4 className="m-0 mb-2 text-sm font-bold">Handoff timing</h4>
            <div className="grid grid-cols-2 gap-2">
              <Stat
                label="Wrong first-section assignments"
                value={`${workflow.wrong_section_first_assignments ?? 0}`}
                hint={workflow.wrong_first_assignment_rate_percent == null ? undefined : `${workflow.wrong_first_assignment_rate_percent}% of assignments`}
              />
              <Stat label="Report to triage" value={minutes(workflow.mean_report_to_triage_minutes)} hint="mean" />
              <Stat label="Report to acknowledgement" value={minutes(workflow.mean_report_to_acknowledge_minutes)} hint="mean" />
              <Stat label="Report to restoration" value={workflow.mean_report_to_restore_hours == null ? "—" : `${workflow.mean_report_to_restore_hours} h`} hint="mean" />
            </div>
            <p className="mb-0 text-xs text-muted-foreground">{workflow.timing_note || "Durations use recorded timestamps."}</p>
          </div>
        </div>

        <div>
          <h4 className="m-0 mb-2 text-sm font-bold">Section handoffs</h4>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Section</TableHead>
                {HANDOFF_COLUMNS.map(([label]) => <TableHead key={label} className="text-right">{label}</TableHead>)}
              </TableRow>
            </TableHeader>
            <TableBody>
              {Object.entries(handoffs).map(([section, row]) => (
                <TableRow key={section}>
                  <TableCell className="font-bold">{section}</TableCell>
                  {HANDOFF_COLUMNS.map(([label, key]) => <TableCell key={label} className="text-right tabular-nums">{row[key] ?? 0}</TableCell>)}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}
