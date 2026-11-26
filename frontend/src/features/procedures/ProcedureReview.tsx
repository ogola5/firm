import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { type User } from "../../auth";
import { Alert } from "../../components/ui/alert";
import { Badge, statusVariant, statusWords } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../../components/ui/card";
import { ChangesSincePrevious } from "./ProcedureVersions";
import { Field, Textarea } from "../../components/ui/form-controls";
import { EmptyState, Page, PageHeader } from "../../components/ui/page";
import { errorMessage } from "../../lib/query";
import { type DataRow } from "../../lib/types";
import { cn } from "../../lib/utils";
import { api } from "../../offline/api";

type Decision = "APPROVE" | "REQUEST_CLARIFICATION" | "REJECT";

export function ProcedureReview({ user }: { user: User }) {
  const queryClient = useQueryClient();
  const isSupervisor = user.role === "supervisor";
  const [comments, setComments] = useState<Record<string, string>>({});
  const [message, setMessage] = useState("");

  const queue = useQuery({ queryKey: ["procedures", "review-queue"], queryFn: () => api<DataRow[]>("/api/v1/procedure-updates/review-queue") });
  const review = useMutation({
    mutationFn: ({ id, decision }: { id: string; decision: Decision }) => api(`/api/v1/procedure-updates/${encodeURIComponent(id)}/review`, {
      method: "POST",
      body: JSON.stringify({ decision, comments: comments[id] || "" }),
    }),
    onMutate: () => setMessage(""),
    onSuccess: async (_result, { decision }) => {
      setMessage(decision === "APPROVE"
        ? (isSupervisor ? "Procedure published to the approved library." : "Technical review approved; awaiting supervisor publication.")
        : decision === "REJECT" ? "Rejection recorded for the contributor." : "Clarification request recorded for the contributor.");
      await queryClient.invalidateQueries({ queryKey: ["procedures"] });
      await queryClient.invalidateQueries({ queryKey: ["knowledge"] });
    },
  });
  const updates = queue.data ?? [];

  return (
    <Page>
      <PageHeader
        eyebrow="Versioned work-procedure review"
        title={isSupervisor ? "Supervisor publication queue" : `${user.section} technical review`}
        description={isSupervisor
          ? "Publish only after a section chief has completed technical review."
          : "Review evidence from your section; approve technically or request specific clarification."}
      />
      {message && <Alert variant="success" className="mb-3">{message}</Alert>}
      {review.isError && <Alert variant="destructive" className="mb-3">{errorMessage(review.error, "Review action failed.")}</Alert>}
      {queue.isError && <Alert variant="destructive" className="mb-3">{errorMessage(queue.error, "The review queue is unavailable.")}</Alert>}
      {queue.isSuccess && !updates.length && <EmptyState>No work-procedure updates are waiting for your review.</EmptyState>}
      <div className="grid gap-4">
        {updates.map((item) => {
          const id = String(item.id);
          const evidence = (item.source_evidence || {}) as DataRow;
          const diagnoses = (evidence.diagnoses || []) as DataRow[];
          const interventions = (evidence.interventions || []) as DataRow[];
          return (
            <Card key={id}>
              <CardHeader>
                <div className="flex items-center justify-between gap-2">
                  <Badge variant={statusVariant(String(item.status))}>{statusWords(String(item.status))}</Badge>
                  <small className="text-muted-foreground">{String(item.reference)} · v{String(item.version)} · {String(item.section)}</small>
                </div>
                <CardTitle>{String(item.title)}</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-2 text-sm">
                <p className="m-0"><strong>Contributor:</strong> {String(item.author_name)} · <strong>Source fault:</strong> {String(evidence.fault_reference || item.fault_id)}</p>
                <p className="m-0"><strong>Observed symptom:</strong> {String(item.observed_symptom)} · <strong>Reported status:</strong> {String(evidence.status || "—")}</p>
                <p className="m-0"><strong>Proposed cause:</strong> {String(item.confirmed_cause)}</p>
                <p className="m-0"><strong>Diagnostic procedure:</strong> {String(item.diagnostic_procedure)}</p>
                <p className="m-0"><strong>Corrective action:</strong> {String(item.corrective_action)}</p>
                <p className="m-0"><strong>Safety:</strong> {String(item.safety || "No additional notes supplied")}</p>
                <ChangesSincePrevious id={id} version={Number(item.version)} />
                <div className="grid gap-1.5 rounded-md bg-muted p-3">
                  <strong>Recorded diagnostic evidence</strong>
                  {diagnoses.map((entry, index) => (
                    <p key={`d-${index}`} className="m-0 text-muted-foreground">{String(entry.possible_cause)} — {String(entry.verification_status)} · {String(entry.observations)} {String(entry.test_results)}</p>
                  ))}
                  <strong className="mt-1">Interventions, including unsuccessful attempts</strong>
                  {interventions.map((entry, index) => (
                    <p key={`i-${index}`} className={cn("m-0", entry.outcome === "FAILED" && "border-l-[3px] border-destructive pl-2.5")}>
                      <b>{String(entry.outcome)}:</b> {String(entry.corrective_action)} {String(entry.notes)}
                    </p>
                  ))}
                </div>
                <Field label="Review notes">
                  <Textarea value={comments[id] || ""} onChange={(event) => setComments({ ...comments, [id]: event.target.value })} placeholder="Required for a clarification request or rejection" />
                </Field>
                <div className="flex flex-wrap gap-2">
                  <Button disabled={review.isPending} onClick={() => review.mutate({ id, decision: "APPROVE" })}>{isSupervisor ? "Publish" : "It's right: send for publishing"}</Button>
                  <Button variant="outline" disabled={review.isPending} onClick={() => review.mutate({ id, decision: "REQUEST_CLARIFICATION" })}>Ask the author a question</Button>
                  <Button variant="outline" disabled={review.isPending} onClick={() => review.mutate({ id, decision: "REJECT" })}>Not accepted</Button>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </Page>
  );
}
