import { createContext, useContext } from "react";
import { type User } from "../../../auth";
import { db } from "../../../db";
import { type DataRow, type FaultContext } from "../../../lib/types";
import { ApiError, api, isOfflineError } from "../../../offline/api";
import { cacheFaultContext, cachedFaultContext } from "../../../offline/cache";

export const ALL_SECTIONS = ["Systems Automation", "Electrical", "Instrumentation", "Mechanical"];
const INVESTIGATION_ROLES = ["systems_automation", "technician_st", "technician_pt", "assistant_engineer", "engineer", "senior_engineer", "chief_engineer"];

export type LoadedFault = { context: FaultContext; offline: boolean };

const EMPTY_CONTEXT = {
  assignments: [], attachments: [], operator_updates: [], timeline: [], diagnoses: [], interventions: [],
  previous_faults: [], approved_procedures: [], legacy_knowledge: [], procedure_updates: [], reuse_records: [],
  ranked_causes: [], repeat_routing: {},
};

/** Server copy when reachable (cached for offline use); otherwise the device copy. */
export async function loadFaultContext(faultId: string): Promise<LoadedFault> {
  try {
    const context = await api<FaultContext>(`/api/v1/faults/${encodeURIComponent(faultId)}/context`);
    await cacheFaultContext(faultId, context as unknown as Record<string, unknown>);
    return { context, offline: false };
  } catch (reason) {
    const usable = isOfflineError(reason) || (reason instanceof ApiError && reason.status === 404);
    const cached = usable ? await cachedFaultContext(faultId) : undefined;
    if (cached) return { context: cached.context as unknown as FaultContext, offline: true };
    const summary = await db.faults.get(faultId);
    if (summary?.offline_pending) {
      // Reported on this device and not yet on the server.
      return { context: { ...EMPTY_CONTEXT, fault: summary } as unknown as FaultContext, offline: true };
    }
    throw isOfflineError(reason)
      ? new Error("This breakdown was not opened while connected, so its investigation is not on this device yet.")
      : reason;
  }
}

/** What this user may do on this fault right now (mirrors the server's rules; the server still decides). */
export function faultPermissions(user: User, context: FaultContext) {
  const permissions = user.permissions || [];
  const fault = context.fault;
  const status = String(fault.status);
  const activeAssignment = context.assignments.find((item) => Boolean(item.is_active));
  const isSectionChief = user.role === "technician_ct";
  const canInvestigate = INVESTIGATION_ROLES.includes(user.role);
  const canWorkAssignment = !isSectionChief && Boolean(activeAssignment) && (
    user.role === "systems_automation"
      ? activeAssignment?.section === "Systems Automation"
      : canInvestigate ? activeAssignment?.section === user.section : true
  );
  const awaitingChiefReview = status === "AWAITING_CHIEF_REVIEW"
    || activeAssignment?.escalation_status === "PENDING"
    || activeAssignment?.completion_review_status === "PENDING";
  const canTriage = permissions.includes("faults.triage") || permissions.includes("faults.triage.section");
  const closedOrRestored = ["RESTORED", "CLOSED"].includes(status);
  const assetConfirmed = fault.equipment_confirmed !== false;
  return {
    status,
    activeAssignment,
    assetConfirmed,
    awaitingChiefReview,
    canInvestigate,
    canWorkAssignment,
    // Matches the server's escalation roles (Operations cannot hand work between sections).
    canEscalate: canWorkAssignment && (canInvestigate || ["maintenance_manager", "supervisor", "system_administrator"].includes(user.role)),
    canUpdate: permissions.includes("faults.update"),
    canRestore: permissions.includes("faults.restore"),
    canContribute: permissions.includes("knowledge.contribute"),
    canReviewSection: isSectionChief && activeAssignment?.section === user.section,
    isSectionChief,
    canTriageCurrent: canTriage && (!activeAssignment || (
      activeAssignment.section === "Systems Automation"
      && ["systems_automation", "maintenance_manager", "supervisor", "system_administrator"].includes(user.role)
    )),
    restrictedTriage: ["technician_ct", "chief_engineer"].includes(user.role),
    canConfirmRestoration: user.role === "operations" && permissions.includes("faults.confirm"),
    canAttachEvidence: user.role === "operations" || canWorkAssignment
      || ["maintenance_manager", "general_manager_om", "supervisor", "system_administrator"].includes(user.role),
    canRecordInvestigation: canInvestigate && canWorkAssignment && !awaitingChiefReview && !closedOrRestored,
    canSubmitProcedure: permissions.includes("knowledge.contribute") && closedOrRestored
      && context.interventions.some((item) => item.outcome === "SUCCESS"),
  };
}

export type FaultPermissions = ReturnType<typeof faultPermissions>;

export type DetailContextValue = {
  user: User;
  faultId: string;
  context: FaultContext;
  offline: boolean;
  can: FaultPermissions;
  /** Show a confirmation, refetch the investigation and (optionally) the breakdown list. */
  done: (message: string, refreshList?: boolean) => Promise<void>;
  fail: (error: unknown, fallback: string) => void;
};

export const DetailContext = createContext<DetailContextValue | null>(null);

export function useDetail(): DetailContextValue {
  const value = useContext(DetailContext);
  if (!value) throw new Error("useDetail must be used inside FaultDetail");
  return value;
}

export type Revision = { id: string; values: DataRow } | null;
