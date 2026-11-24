import { useEffect, useState } from "react";
import { type User } from "../../auth";
import { type DataRow } from "../../lib/types";
import { api } from "../../offline/api";

export function ProcedureReview({ user }: { user: User }) {
  const [updates, setUpdates] = useState<DataRow[]>([]);
  const [comments, setComments] = useState<Record<string, string>>({});
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const isSupervisor = user.role === "supervisor";

  async function loadQueue() {
    setUpdates(await api("/api/v1/procedure-updates/review-queue"));
  }

  useEffect(() => {
    loadQueue().catch((reason) => setError(reason instanceof Error ? reason.message : "The review queue is unavailable."));
  }, []);

  async function review(updateId: string, decision: string) {
    setError("");
    setMessage("");
    try {
      await api(`/api/v1/procedure-updates/${encodeURIComponent(updateId)}/review`, {
        method: "POST",
        body: JSON.stringify({ decision, comments: comments[updateId] || "" }),
      });
      setMessage(decision === "APPROVE" ? (isSupervisor ? "Procedure published to the approved library." : "Technical review approved; awaiting supervisor publication.") : "Clarification request recorded for the contributor.");
      await loadQueue();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Review action failed.");
    }
  }

  return (
    <section className="page">
      <div className="page-heading"><div><p className="eyebrow">VERSIONED WORK-PROCEDURE REVIEW</p><h2>{isSupervisor ? "Supervisor publication queue" : `${user.section} technical review`}</h2><p className="muted">{isSupervisor ? "Publish only after a section chief has completed technical review." : "Review evidence from your section; approve technically or request specific clarification."}</p></div></div>
      {message && <p className="confirmation">{message}</p>}
      {error && <p className="error">{error}</p>}
      {!updates.length && !error && <div className="empty">No work-procedure updates are waiting for your review.</div>}
      <div className="review-list">{updates.map((item) => {
        const evidence = (item.source_evidence || {}) as DataRow;
        const diagnoses = (evidence.diagnoses || []) as DataRow[];
        const interventions = (evidence.interventions || []) as DataRow[];
        return <article className="panel review-card" key={String(item.id)}>
          <div className="card-top"><span className="status submitted">{String(item.status).replace(/_/g, " ")}</span><small>{String(item.reference)} · v{String(item.version)} · {String(item.section)}</small></div>
          <h3>{String(item.title)}</h3>
          <p><strong>Contributor:</strong> {String(item.author_name)} · <strong>Source fault:</strong> {String(evidence.fault_reference || item.fault_id)}</p>
          <p><strong>Observed symptom:</strong> {String(item.observed_symptom)} · <strong>Reported status:</strong> {String(evidence.status || "—")}</p>
          <p><strong>Proposed cause:</strong> {String(item.confirmed_cause)}</p>
          <p><strong>Diagnostic procedure:</strong> {String(item.diagnostic_procedure)}</p>
          <p><strong>Corrective action:</strong> {String(item.corrective_action)}</p>
          <p><strong>Safety:</strong> {String(item.safety || "No additional notes supplied")}</p>
          <div className="source-evidence">
            <strong>Recorded diagnostic evidence</strong>
            {diagnoses.map((entry, index) => <p key={`diagnosis-${index}`}>{String(entry.possible_cause)} — {String(entry.verification_status)} · {String(entry.observations)} {String(entry.test_results)}</p>)}
            <strong>Interventions, including unsuccessful attempts</strong>
            {interventions.map((entry, index) => <p className={entry.outcome === "FAILED" ? "failed-attempt" : ""} key={`intervention-${index}`}><b>{String(entry.outcome)}:</b> {String(entry.corrective_action)} {String(entry.notes)}</p>)}
          </div>
          <label>Review notes<textarea value={comments[String(item.id)] || ""} onChange={(event) => setComments({ ...comments, [String(item.id)]: event.target.value })} placeholder="Required for a clarification request or rejection" /></label>
          <div className="action-row">
            <button className="primary" onClick={() => review(String(item.id), "APPROVE")}>{isSupervisor ? "Approve & publish" : "Approve technical review"}</button>
            <button className="secondary" onClick={() => review(String(item.id), "REQUEST_CLARIFICATION")}>Request clarification</button>
            <button className="secondary" onClick={() => review(String(item.id), "REJECT")}>Reject</button>
          </div>
        </article>;
      })}</div>
    </section>
  );
}
