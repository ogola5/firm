/** What this account's level sees: decided by the server (backend/app/services/workspace.py). */
export type AccessProfile = {
  level: string;
  level_label: string;
  home: string;
  home_title: string;
  home_purpose: string;
  scope: string;
  /** Western, Nairobi or Coast for regional staff (ST to SE); empty otherwise. */
  region?: string;
  menu: Array<{ key: string; label: string }>;
  can: string[];
  version: string;
};

export type User = {
  id: string;
  username: string;
  /** Company email: the sign-in identity. */
  email: string;
  display_name: string;
  role: string;
  role_label: string;
  section: string;
  region?: string | null;
  /** The developer / owner of the standalone system: a System Administrator with developer tools. */
  developer?: boolean;
  active: boolean;
  availability_status: "AVAILABLE" | "UNAVAILABLE";
  competencies: string[];
  permissions: string[];
  visibility_scope: string;
  access: AccessProfile;
};

/** Whether the screens should offer this. The matching API enforces it either way. */
export function can(user: User, ability: string): boolean {
  return user.access.can.includes(ability);
}

/** A session cached before access profiles existed: minimal until /auth/me refreshes it. */
function fallbackAccess(role: string, label: string, permissions: string[]): AccessProfile {
  return {
    level: "", level_label: label, home: "none", home_title: "Home", home_purpose: "Reconnect to load your view.",
    scope: "", menu: [{ key: "home", label: "Home" }, { key: "account", label: "My account" }], can: permissions, version: role,
  };
}

function parseAccess(value: unknown): AccessProfile | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  if (typeof raw.home !== "string" || !Array.isArray(raw.menu) || !Array.isArray(raw.can)) return null;
  return {
    level: String(raw.level ?? ""),
    level_label: String(raw.level_label ?? ""),
    home: raw.home,
    home_title: String(raw.home_title ?? "Home"),
    home_purpose: String(raw.home_purpose ?? ""),
    scope: String(raw.scope ?? ""),
    menu: raw.menu.filter((item): item is { key: string; label: string } =>
      Boolean(item) && typeof (item as { key?: unknown }).key === "string" && typeof (item as { label?: unknown }).label === "string"),
    can: raw.can.filter((item): item is string => typeof item === "string"),
    version: String(raw.version ?? ""),
  };
}

const roleAliases: Record<string, string> = {
  Operations: "operations",
  "Systems Automation": "systems_automation",
  Electrical: "technician_st",
  Instrumentation: "technician_st",
  Mechanical: "technician_st",
  Supervisor: "supervisor",
  "System Administrator": "system_administrator",
  Management: "general_manager_om",
};

const labels: Record<string, string> = {
  operations: "Operations",
  systems_automation: "Systems Automation",
  technician_st: "Senior Technician (ST)",
  technician_pt: "Principal Technician (PT)",
  technician_ct: "Chief Technician (CT)",
  assistant_engineer: "Assistant Engineer",
  engineer: "Engineer",
  senior_engineer: "Senior Engineer",
  chief_engineer: "Chief Engineer",
  maintenance_manager: "Maintenance Manager",
  hr_officer: "HR Officer",
  general_manager_om: "General Manager, Operations & Maintenance",
  managing_director: "Managing Director / CEO",
  supervisor: "Supervisor",
  system_administrator: "System Administrator",
};

const legacyPermissions: Record<string, string[]> = {
  operations: ["faults.read", "faults.report", "equipment.read"],
  systems_automation: ["faults.read", "faults.triage", "equipment.read", "knowledge.read"],
  technician_st: ["faults.read", "faults.report", "faults.update", "equipment.read", "knowledge.read"],
  supervisor: ["faults.read", "faults.triage", "faults.update", "equipment.read", "knowledge.read", "knowledge.approve", "analytics.detail"],
  general_manager_om: ["faults.read", "faults.report", "faults.triage", "faults.update", "equipment.read", "knowledge.read", "analytics.detail", "people.summary"],
  managing_director: ["analytics.executive"],
  system_administrator: ["people.read", "people.manage", "faults.read", "faults.report", "faults.triage", "faults.update", "equipment.read", "knowledge.read", "analytics.detail"],
};

export function normalizeUser(value: unknown): User | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  if (typeof raw.id !== "string" || typeof raw.username !== "string") return null;

  const storedRole = typeof raw.role === "string" ? raw.role : "";
  const role = roleAliases[storedRole] ?? storedRole;
  const section = typeof raw.section === "string" ? raw.section : "";
  const permissions = Array.isArray(raw.permissions) && raw.permissions.every((item) => typeof item === "string")
    ? raw.permissions
    : legacyPermissions[role] ?? [];

  return {
    id: raw.id,
    username: raw.username,
    email: typeof raw.email === "string" ? raw.email : "",
    display_name: typeof raw.display_name === "string" ? raw.display_name : raw.username,
    role,
    role_label: typeof raw.role_label === "string" ? raw.role_label : labels[role] ?? storedRole,
    section,
    region: typeof raw.region === "string" ? raw.region : "",
    developer: raw.developer === true,
    active: typeof raw.active === "boolean" ? raw.active : true,
    availability_status: raw.availability_status === "UNAVAILABLE" ? "UNAVAILABLE" : "AVAILABLE",
    competencies: Array.isArray(raw.competencies) && raw.competencies.every((item) => typeof item === "string")
      ? raw.competencies
      : [],
    permissions,
    visibility_scope: typeof raw.visibility_scope === "string" ? raw.visibility_scope : section || "Cached session",
    access: parseAccess(raw.access) ?? fallbackAccess(role, typeof raw.role_label === "string" ? raw.role_label : labels[role] ?? storedRole, permissions),
  };
}
