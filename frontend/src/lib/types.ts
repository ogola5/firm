

export type WorkflowReport = {
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

export type DataRow = Record<string, unknown>;

export type FaultContext = {
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
