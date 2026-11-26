import { useQuery } from "@tanstack/react-query";
import { GitCompare, Minus, Plus } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { type User } from "../../auth";
import { Alert } from "../../components/ui/alert";
import { Badge } from "../../components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "../../components/ui/card";
import { NativeSelect } from "../../components/ui/form-controls";
import { Page, PageHeader } from "../../components/ui/page";
import { spokenTime } from "../../lib/format";
import { hasChanges, lineDiff, type DiffLine } from "../../lib/lineDiff";
import { errorMessage } from "../../lib/query";
import { api } from "../../offline/api";

/** Every version of one procedure: content, who and when, why it changed, who approved it (proposal module 7). */
export type ProcedureVersion = {
  id: string; reference: string; version: number; status: string; author: string; created_at: string | null;
  change_reason: string; source_fault: { id: string; reference: string } | null;
  technical_review_by: string; published_by: string; published_at: string | null;
  reviews: Array<{ decision: string; comments: string; created_at: string | null; by: string }>;
  fields: Record<string, string>;
};
type Versions = { lineage_id: string; field_labels: Record<string, string>; versions: ProcedureVersion[]; equipment_type: string };

const STATUS_WORDS: Record<string, string> = {
  APPROVED: "Current", SUPERSEDED: "Superseded", WITHDRAWN: "Withdrawn", SUBMITTED: "Waiting for review",
  CHIEF_APPROVED: "Waiting for publication", CLARIFICATION_REQUESTED: "Question asked", REJECTED: "Not accepted",
};

export function useVersions(id: string, enabled = true) {
  return useQuery({ queryKey: ["procedure", id, "versions"], enabled: enabled && Boolean(id),
    queryFn: () => api<Versions>(`/api/v1/procedure-updates/${encodeURIComponent(id)}/versions`) });
}

function DiffBlock({ diff }: { diff: DiffLine[] }) {
  return (
    <div className="grid gap-0.5 text-sm">
      {diff.map((line, index) => (
        <div key={index} className={
          line.type === "added" ? "flex gap-1.5 rounded bg-success/10 px-1.5 py-0.5 text-foreground"
            : line.type === "removed" ? "flex gap-1.5 rounded bg-destructive/10 px-1.5 py-0.5 text-muted-foreground line-through"
              : "flex gap-1.5 px-1.5 py-0.5 text-muted-foreground"}>
          {line.type === "added" ? <Plus className="mt-0.5 size-3.5 shrink-0 text-success" aria-label="Added" />
            : line.type === "removed" ? <Minus className="mt-0.5 size-3.5 shrink-0 text-destructive" aria-label="Removed" />
              : <span className="w-3.5 shrink-0" />}
          <span>{line.text}</span>
        </div>
      ))}
    </div>
  );
}

/** What changed from one version to another, field by field. Unchanged fields are listed, not repeated. */
export function VersionDiff({ before, after, labels }: { before: ProcedureVersion; after: ProcedureVersion; labels: Record<string, string> }) {
  const changed = Object.keys(labels).map((key) => ({ key, diff: lineDiff(before.fields[key] ?? "", after.fields[key] ?? "") }));
  const unchanged = changed.filter((item) => !hasChanges(item.diff)).map((item) => labels[item.key]);
  return (
    <div className="grid gap-3" aria-label={`Changes from v${before.version} to v${after.version}`}>
      {changed.filter((item) => hasChanges(item.diff)).map((item) => (
        <section key={item.key}>
          <h3 className="m-0 mb-1 text-xs font-extrabold uppercase text-muted-foreground">{labels[item.key]}</h3>
          <DiffBlock diff={item.diff} />
        </section>
      ))}
      {unchanged.length > 0 && <p className="m-0 text-xs text-muted-foreground">Unchanged: {unchanged.join(", ")}.</p>}
    </div>
  );
}

function VersionHeader({ item }: { item: ProcedureVersion }) {
  return (
    <div className="grid gap-1 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <strong>Version {item.version}</strong>
        <Badge variant={item.status === "APPROVED" ? "success" : item.status === "WITHDRAWN" ? "destructive" : "outline"} className="normal-case">
          {STATUS_WORDS[item.status] ?? item.status}
        </Badge>
        <span className="text-xs text-muted-foreground">{item.reference}</span>
      </div>
      <span className="text-muted-foreground">By {item.author}{item.created_at ? `, ${spokenTime(item.created_at)}` : ""}
        {item.source_fault ? <> · from <Link to={`/faults?mode=history&fault=${item.source_fault.id}`}>{item.source_fault.reference}</Link></> : null}
      </span>
      {item.version > 1 && <span><strong>Why it changed:</strong> {item.change_reason || <em className="text-muted-foreground">no reason recorded</em>}</span>}
      {(item.technical_review_by || item.published_by) && (
        <span className="text-muted-foreground">
          {item.technical_review_by && <>Checked by {item.technical_review_by}. </>}
          {item.published_by && <>Published by {item.published_by}{item.published_at ? `, ${spokenTime(item.published_at)}` : ""}.</>}
        </span>
      )}
    </div>
  );
}

/** Pick any two versions and see what changed, with the full history underneath. */
export function ProcedureVersions({ user }: { user: User }) {
  const { id = "" } = useParams();
  const query = useVersions(id);
  const versions = query.data?.versions ?? [];
  const [fromId, setFromId] = useState("");
  const [toId, setToId] = useState("");
  useEffect(() => {
    if (versions.length && !toId) {
      setToId(versions[versions.length - 1].id);
      setFromId(versions[Math.max(0, versions.length - 2)].id);
    }
  }, [versions, toId]);
  const before = versions.find((item) => item.id === fromId);
  const after = versions.find((item) => item.id === toId);
  const latest = versions[versions.length - 1];

  return (
    <Page>
      {query.data?.equipment_type ? <Link to={`/library/${query.data.equipment_type}`} className="text-sm font-bold">‹ Library</Link>
        : <Link to="/library" className="text-sm font-bold">‹ Library</Link>}
      <PageHeader className="mt-2" eyebrow={`${user.access.level} · Procedure history`} title={latest?.fields.title ?? "Procedure versions"}
        description="Earlier versions are never overwritten. Pick two versions to see exactly what changed and why." />
      {query.isError && <Alert variant="destructive">{errorMessage(query.error, "These versions are not available.")}</Alert>}
      {versions.length > 1 && (
        <Card className="mb-4">
          <CardHeader className="pb-2">
            <CardTitle className="flex flex-wrap items-center gap-2 text-base"><GitCompare className="size-4" />Compare
              <NativeSelect aria-label="From version" className="w-auto" value={fromId} onChange={(event) => setFromId(event.target.value)}>
                {versions.map((item) => <option key={item.id} value={item.id}>v{item.version} ({STATUS_WORDS[item.status] ?? item.status})</option>)}
              </NativeSelect>
              with
              <NativeSelect aria-label="To version" className="w-auto" value={toId} onChange={(event) => setToId(event.target.value)}>
                {versions.map((item) => <option key={item.id} value={item.id}>v{item.version} ({STATUS_WORDS[item.status] ?? item.status})</option>)}
              </NativeSelect>
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4">
            {before && after && (
              <>
                <div className="grid gap-3 md:grid-cols-2">
                  <div className="rounded-lg border border-border p-3"><VersionHeader item={before} /></div>
                  <div className="rounded-lg border border-border p-3"><VersionHeader item={after} /></div>
                </div>
                {before.id === after.id ? <p className="m-0 text-sm text-muted-foreground">Choose two different versions.</p>
                  : <VersionDiff before={before} after={after} labels={query.data!.field_labels} />}
              </>
            )}
          </CardContent>
        </Card>
      )}
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">All versions</CardTitle></CardHeader>
        <CardContent className="grid gap-4">
          {[...versions].reverse().map((item) => (
            <article key={item.id} aria-label={`Version ${item.version}`} className="grid gap-2 border-b border-border pb-4 last:border-0 last:pb-0">
              <VersionHeader item={item} />
              {item.reviews.filter((review) => review.comments).map((review, index) => (
                <p key={index} className="m-0 text-sm text-muted-foreground">“{review.comments}” <span className="text-xs">({review.by}, {review.decision.replace(/_/g, " ").toLowerCase()})</span></p>
              ))}
            </article>
          ))}
        </CardContent>
      </Card>
    </Page>
  );
}

/** For reviewers: what this version changes compared with the one before it. */
export function ChangesSincePrevious({ id, version }: { id: string; version: number }) {
  const query = useVersions(id, version > 1);
  if (version <= 1 || !query.data) return null;
  const rows = query.data.versions;
  const index = rows.findIndex((item) => item.id === id);
  const current = rows[index];
  const previous = index > 0 ? rows[index - 1] : undefined;
  if (!current || !previous) return null;
  return (
    <div className="grid gap-2 rounded-md border border-primary/30 bg-primary/5 p-3" aria-label="What changed">
      <strong className="flex items-center gap-1.5"><GitCompare className="size-4" />What changed since v{previous.version}</strong>
      <span><strong>Why:</strong> {current.change_reason || <em className="text-muted-foreground">no reason recorded</em>}</span>
      <VersionDiff before={previous} after={current} labels={query.data.field_labels} />
      <Link to={`/procedures/${id}/versions`} className="text-sm font-semibold">See all versions</Link>
    </div>
  );
}
