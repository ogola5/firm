import { useQuery } from "@tanstack/react-query";
import { type User } from "../../auth";
import { db } from "../../db";
import { withOfflineFallback } from "../../lib/query";
import { api } from "../../offline/api";

export type Job = {
  fault_id: string;
  reference: string;
  equipment_tag: string;
  equipment_name: string;
  location: string;
  symptom: string;
  operational_impact: string;
  severity: string;
  /** Reporter said someone or something is at risk: shown first and marked SAFETY. */
  safety_hazard?: boolean;
  /** 0 with the Chief Technician, 1 with the regional Senior Engineer, 2 with the section Chief Engineer. */
  escalation_level?: number;
  escalation_guidance?: string;
  description?: string;
  status: string;
  reported_at: string | null;
  observed_at: string | null;
  seen_via: string;
  seen_before: number;
  assignment_id: string | null;
  section: string;
  assigned_at: string | null;
  acknowledged_at: string | null;
  response_due_at: string | null;
  instructions: string;
  waiting_for?: string;
};

export type Jobs = {
  to_write_up: Job[];
  assigned: Job[];
  available: Job[];
  waiting: Job[];
  procedure_ready: Job[];
};

export const EMPTY_JOBS: Jobs = { to_write_up: [], assigned: [], available: [], waiting: [], procedure_ready: [] };

const cacheKey = (userId: string) => `jobs:${userId}`;

/** The technician's jobs; offline, the last copy saved on this computer. */
export function useMyJobs(user: User) {
  return useQuery({
    queryKey: ["jobs", user.id],
    queryFn: () => withOfflineFallback(
      async () => {
        const jobs = await api<Jobs>("/api/v1/me/jobs");
        await db.syncMeta.put({ key: cacheKey(user.id), value: jobs });
        return jobs;
      },
      async () => (await db.syncMeta.get(cacheKey(user.id)))?.value as Jobs | undefined,
    ),
  });
}

/** Procedure drafts the technician chose to skip (kept on this computer). */
const skipKey = (userId: string) => `kpc-procedure-skip:${userId}`;

export function skippedProcedures(userId: string): string[] {
  try {
    return JSON.parse(localStorage.getItem(skipKey(userId)) || "[]") as string[];
  } catch {
    return [];
  }
}

export function skipProcedure(userId: string, faultId: string) {
  localStorage.setItem(skipKey(userId), JSON.stringify([...new Set([...skippedProcedures(userId), faultId])]));
}
