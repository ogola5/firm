import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { type User } from "../../auth";
import { Alert } from "../../components/ui/alert";
import { Card, CardContent, CardHeader, CardTitle } from "../../components/ui/card";
import { errorMessage } from "../../lib/query";
import { AssignmentPanel } from "./detail/AssignmentPanel";
import { DetailContext, faultPermissions, loadFaultContext, type DetailContextValue, type Revision } from "./detail/context";
import { EvidencePanel } from "./detail/EvidencePanel";
import { EquipmentHistory, InvestigationLog, RankedCauses } from "./detail/History";
import { InvestigationForms } from "./detail/InvestigationForms";
import { Overview } from "./detail/Overview";
import { ProcedureForm, ReuseRecords } from "./detail/Procedures";
import { SimilarFaults } from "./SimilarFaults";

/**
 * One breakdown: summary, section handoffs, evidence, troubleshooting history,
 * investigation forms and knowledge. Each panel reads shared state from
 * DetailContext; the server re-checks every action.
 */
export function FaultDetail({ user, faultId, onRefresh }: { user: User; faultId: string; onRefresh: () => Promise<unknown> }) {
  const queryClient = useQueryClient();
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [revision, setRevision] = useState<Revision>(null);
  const query = useQuery({ queryKey: ["fault", faultId, "context"], queryFn: () => loadFaultContext(faultId) });

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
        setMessage(text);
        await queryClient.invalidateQueries({ queryKey: ["fault", faultId] });
        if (refreshList) await onRefresh();
      },
      fail: (reason, fallback) => {
        setMessage("");
        setError(errorMessage(reason, fallback));
      },
    };
  }, [query.data, user, faultId, queryClient, onRefresh]);

  if (!value) {
    return (
      <Card className="mt-4">
        <CardHeader><CardTitle>Fault work history</CardTitle></CardHeader>
        <CardContent>
          {query.isError
            ? <Alert variant="destructive">{errorMessage(query.error, "Investigation history could not be loaded.")}</Alert>
            : <p className="m-0 text-sm text-muted-foreground">Loading fault history…</p>}
        </CardContent>
      </Card>
    );
  }

  return (
    <DetailContext.Provider value={value}>
      <div className="mt-4 grid gap-4">
        <Overview message={message} error={error} />
        <AssignmentPanel />
        <EvidencePanel />
        <RankedCauses />
        <EquipmentHistory />
        <SimilarFaults user={user} faultId={faultId} />
        <InvestigationForms />
        <InvestigationLog onRevise={setRevision} />
        <ProcedureForm revision={revision} onDone={() => setRevision(null)} />
        <ReuseRecords />
      </div>
    </DetailContext.Provider>
  );
}
