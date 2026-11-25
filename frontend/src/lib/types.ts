

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
  // Optional: contexts cached on a device before these existed lack them.
  drawing_differences?: DrawingDifference[];
  drawings?: DrawingInfo[];
  expert_notes?: ExpertNote[];
  equipment_type?: string;
  watch?: { reasons: string[]; level: string } | null;
};

export type DrawingDifference = {
  id: string; equipment_id: string; equipment_tag: string; equipment_name: string; section: string;
  drawing_number: string; drawing_revision: string; drawing_in_register: boolean; description: string;
  permanence: "PERMANENT" | "TEMPORARY"; fault_id: string | null; reported_by: string; reported_at: string;
  status: "REPORTED" | "VERIFIED" | "REJECTED" | "INCORPORATED"; status_label: string; verified_by: string | null;
  verified_at: string | null; review_note: string; incorporated_revision: string;
};

export type DrawingInfo = {
  id: string; number: string; title: string; revision: string; discipline: string; status: "PAPER" | "DIGITISED";
  status_label: string; document_url: string | null; source: string; equipment_tags: string[];
};

export type ExpertNote = {
  id: string; title: string; credit: string; how_it_fails: string; first_checks: string; what_fools_people: string;
  tricks: string; safety: string;
};

export type Choice = { value: string; label: string };
export type Catalogue = { cause_categories: Choice[]; action_types: Choice[]; difference_permanence: Choice[] };
