import { useEffect, useState } from "react";
import { type DataRow } from "../../lib/types";
import { api } from "../../offline/api";

export function RecognitionPanel() {
  const [recognition, setRecognition] = useState<Record<string, unknown> | null>(null);
  useEffect(() => {
    api("/api/v1/recognition/leaderboard").then(setRecognition).catch(() => setRecognition(null));
  }, []);
  if (!recognition) return null;
  const leaderboard = (recognition.leaderboard || []) as DataRow[];
  return (
    <div className="panel recognition-panel">
      <div className="section-heading"><div><p className="eyebrow">{String(recognition.platform)}</p><h3>Contributor recognition</h3></div><span className="status approved">Verified contribution</span></div>
      <p className="muted">{String(recognition.recognition_rule)} · {String(recognition.integration_status)}</p>
      <div className="recognition-list">{leaderboard.slice(0, 8).map((row) => <article key={String(row.rank)}>
        <span className="recognition-rank">#{String(row.rank)}</span>
        <div><strong>{String(row.employee_name)}</strong><small>{String(row.role)} · {String(row.section || "Cross-section")}</small></div>
        <div className="recognition-metrics"><strong>{String(row.points)} pts</strong><small>{String(row.verified_reuses)} verified reuse · {String(row.approved_procedures)} approved · {String(row.approved_revisions)} revisions</small></div>
      </article>)}</div>
    </div>
  );
}
