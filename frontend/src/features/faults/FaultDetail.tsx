import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { type User } from "../../auth";
import { Alert } from "../../components/ui/alert";
import { Skeleton } from "../../components/ui/skeleton";
import { errorMessage } from "../../lib/query";
import { toast } from "../../lib/toast";
import { cn } from "../../lib/utils";
import { AssignmentPanel } from "./detail/AssignmentPanel";
import { JobNotes } from "./detail/JobNotes";
import { DetailContext, faultPermissions, loadFaultContext, type DetailContextValue, type Revision } from "./detail/context";
import { EvidencePanel } from "./detail/EvidencePanel";
import { EquipmentHistory, InvestigationLog, RankedCauses } from "./detail/History";
import { InvestigationForms } from "./detail/InvestigationForms";
import { NextStep } from "./detail/NextStep";
import { Overview } from "./detail/Overview";
import { ProcedureForm, ReuseRecords } from "./detail/Procedures";
import { SimilarFaults } from "./SimilarFaults";
import { EquipmentKnowledge } from "../library/EquipmentKnowledge";
import { EscalationCard, type EscalationFields } from "../escalation/Escalation";

/** Three views of one breakdown, so nobody scrolls through everything to find their part. */
const TABS = [
  { key: "now", label: "Now" },
  { key: "know", label: "What we know" },
  { key: "history", label: "History" },
] as const;
type TabKey = (typeof TABS)[number]["key"];

/**
 * One breakdown: where it is, the next step, and then (by tab) the work, what we know, and what happened.
 * Panels read shared state from DetailContext; the server re-checks every action.
 */
export function FaultDetail({ user, faultId, onRefresh }: { user: User; faultId: string; onRefresh: () => Promise<unknown> }) {
  const queryClient = useQueryClient();
  const [params, setParams] = useSearchParams();
  const tab = (TABS.some((item) => item.key === params.get("tab")) ? params.get("tab") : "now") as TabKey;
  const [error, setError] = useState("");
  const [revision, setRevision] = useState<Revision>(null);
  const [jumpTo, setJumpTo] = useState("");
  const query = useQuery({ queryKey: ["fault", faultId, "context"], queryFn: () => loadFaultContext(faultId) });

  function showTab(next: TabKey) {
    const copy = new URLSearchParams(params);
    if (next === "now") copy.delete("tab");
    else copy.set("tab", next);
    setParams(copy, { replace: true });
  }

  // "Review and sign off", "Confirm it works"…: open the Now tab and bring that form into view.
  useEffect(() => {
    if (!jumpTo) return;
    const element = document.getElementById(jumpTo);
    if (element) {
      element.scrollIntoView({ behavior: "smooth", block: "start" });
      element.querySelector<HTMLElement>("input, textarea, select")?.focus({ preventScroll: true });
    }
    setJumpTo("");
  }, [jumpTo, tab]);

  const value = useMemo<DetailContextValue | null>(() => {
    if (!query.data) return null;
    const { context, offline } = query.data;
    return {
      user,
      faultId,
      context,
      offline,
      can: faultPermissions(user, context),
      done: async (text, refreshList = false) => {
        setError("");
        toast.success(text);
        await queryClient.invalidateQueries({ queryKey: ["fault", faultId] });
        await queryClient.invalidateQueries({ queryKey: ["notifications"] });
        if (refreshList) await onRefresh();
      },
      fail: (reason, fallback) => {
        const text = errorMessage(reason, fallback);
        setError(text);
        toast.error(text);
      },
    };
  }, [query.data, user, faultId, queryClient, onRefresh]);

  if (!value) {
    return query.isError
      ? <Alert variant="destructive" className="mt-4">{errorMessage(query.error, "This breakdown could not be loaded.")}</Alert>
      : (
        <div className="mt-4 grid gap-4" aria-label="Loading breakdown" aria-busy="true">
          <Skeleton className="h-40" /><Skeleton className="h-20" /><Skeleton className="h-64" />
        </div>
      );
  }

  const knowCount = value.context.ranked_causes.length + value.context.previous_faults.length + value.context.approved_procedures.length;
  return (
    <DetailContext.Provider value={value}>
      <div className="mt-4 grid gap-4">
        <Overview error={error} />
        <NextStep onJump={(target) => { showTab("now"); setJumpTo(target); }} />
        <div role="tablist" aria-label="Breakdown views" className="flex gap-1 rounded-xl border border-border bg-card p-1">
          {TABS.map((item) => (
            <button key={item.key} type="button" role="tab" aria-selected={tab === item.key} onClick={() => showTab(item.key)}
              className={cn("min-h-11 flex-1 rounded-lg px-2 text-sm font-bold", tab === item.key ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-secondary")}>
              {item.label}{item.key === "know" && knowCount > 0 ? <span className="ml-1 opacity-80">({knowCount})</span> : null}
            </button>
          ))}
        </div>
        {tab === "now" && (
          <div role="tabpanel" aria-label="Now" className="grid gap-4">
            <JobNotes />
            {!value.offline && (
              <div id="fault-escalation">
                <EscalationCard faultId={faultId} fault={value.context.fault as unknown as EscalationFields}
                  onChanged={async () => {
                    await queryClient.invalidateQueries({ queryKey: ["fault", faultId] });
                    await queryClient.invalidateQueries({ queryKey: ["escalations"] });
                    await onRefresh();
                  }} />
              </div>
            )}
            <div id="fault-assignment"><AssignmentPanel /></div>
            <div id="fault-confirm"><EvidencePanel /></div>
            <ReuseRecords />
            <div id="fault-investigation"><InvestigationForms /></div>
          </div>
        )}
        {tab === "know" && (
          <div role="tabpanel" aria-label="What we know" className="grid gap-4">
            <RankedCauses />
            <EquipmentKnowledge context={value.context} />
            <EquipmentHistory />
            <SimilarFaults user={user} faultId={faultId} />
          </div>
        )}
        {tab === "history" && (
          <div role="tabpanel" aria-label="History" className="grid gap-4">
            <InvestigationLog onRevise={setRevision} />
            <ProcedureForm revision={revision} onDone={() => setRevision(null)} />
          </div>
        )}
      </div>
    </DetailContext.Provider>
  );
}
