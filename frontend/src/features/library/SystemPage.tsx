import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, History, Link2, Network, Pencil, ShieldAlert, Sparkles } from "lucide-react";
import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { type User } from "../../auth";
import { Alert } from "../../components/ui/alert";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../components/ui/card";
import { Field, Input, Textarea } from "../../components/ui/form-controls";
import { Page, PageHeader } from "../../components/ui/page";
import { spokenTime } from "../../lib/format";
import { errorMessage } from "../../lib/query";
import { api } from "../../offline/api";

/**
 * A system page (proposal module 12): what the whole is, how its parts connect, known limitations,
 * the history of changes over the years, drawings that differ, expert notes and recent faults on every part.
 */
type SystemData = {
  id: string; name: string; station: string; legacy: boolean; description: string; how_it_connects: string; known_limitations: string;
  updated_by: string; updated_at: string | null; can_edit: boolean; can_record_change: boolean;
  equipment: Array<{ id: string; tag: string; name: string; type_code: string; type_name: string; section: string; region: string; location: string }>;
  changes: Array<{ id: string; changed_on: string | null; what_changed: string; recorded_by: string }>;
  drawing_differences: Array<{ id: string; equipment_tag: string; description: string; drawing: string; status: string }>;
  expert_notes: Array<{ id: string; title: string; equipment_type: string; expert: string; what_fools_people: string }>;
  recent_faults: Array<{ id: string; reference: string; equipment_tag: string; symptom: string; reported_at: string | null; status: string;
    cause: string; worked: string; did_not_work: string[] }>;
};
export type SystemRow = { id: string; name: string; station: string; legacy: boolean; equipment_count: number; faults_last_year: number; changes: number; types: string[] };

const day = (value: string | null) => (value ? spokenTime(value).replace(/ \d\d:\d\d$/, "") : "date not known");

export function SystemsList() {
  const systems = useQuery({ queryKey: ["library", "systems"], queryFn: () => api<{ systems: SystemRow[] }>("/api/v1/library/systems") });
  if (!systems.data?.systems.length) return null;
  return (
    <section aria-label="Systems" className="mb-6">
      <h2 className="mb-1 mt-0 flex items-center gap-2 text-lg"><Network className="size-5" />Systems</h2>
      <p className="mb-3 mt-0 text-sm text-muted-foreground">Equipment that works together: how it connects, its limits, and what has been changed over the years.</p>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {systems.data.systems.map((row) => (
          <Link key={row.id} to={`/library/systems/${row.id}`} aria-label={`${row.name} system`}
            className="grid gap-1.5 rounded-xl border border-border bg-card p-4 text-foreground no-underline shadow-sm hover:border-primary">
            <span className="flex flex-wrap items-center gap-2">
              <strong>{row.name}</strong>
              {row.legacy && <Badge variant="warning" className="normal-case">Legacy</Badge>}
            </span>
            <span className="text-sm text-muted-foreground">{row.station} · {row.equipment_count} item(s): {row.types.join(", ")}</span>
            <span className="text-xs text-muted-foreground">{row.faults_last_year} fault(s) in the last year · {row.changes} recorded change(s)</span>
          </Link>
        ))}
      </div>
    </section>
  );
}

function EditableText({ label, value, editing, onChange, empty }: { label: string; value: string; editing: boolean; onChange: (value: string) => void; empty: string }) {
  if (editing) return <Field label={label}><Textarea rows={4} value={value} onChange={(event) => onChange(event.target.value)} /></Field>;
  return value ? <p className="m-0 whitespace-pre-line">{value}</p> : <p className="m-0 text-muted-foreground">{empty}</p>;
}

export function SystemPage({ user }: { user: User }) {
  const { id = "" } = useParams();
  const queryClient = useQueryClient();
  const page = useQuery({ queryKey: ["library", "system", id], queryFn: () => api<SystemData>(`/api/v1/library/systems/${encodeURIComponent(id)}`) });
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({ description: "", how_it_connects: "", known_limitations: "" });
  const [change, setChange] = useState({ what_changed: "", changed_on: "" });
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const data = page.data;

  const refresh = (next: SystemData, text: string) => {
    queryClient.setQueryData(["library", "system", id], next);
    void queryClient.invalidateQueries({ queryKey: ["library", "systems"] });
    setMessage(text);
    setError("");
  };
  async function save() {
    try {
      refresh(await api<SystemData>(`/api/v1/library/systems/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(draft) }), "Saved.");
      setEditing(false);
    } catch (reason) {
      setError(errorMessage(reason, "Not saved."));
    }
  }
  async function record() {
    try {
      refresh(await api<SystemData>(`/api/v1/library/systems/${encodeURIComponent(id)}/changes`, {
        method: "POST", body: JSON.stringify({ what_changed: change.what_changed, changed_on: change.changed_on || null }),
      }), "Change recorded. The next person will know.");
      setChange({ what_changed: "", changed_on: "" });
    } catch (reason) {
      setError(errorMessage(reason, "Not recorded."));
    }
  }

  return (
    <Page>
      <Link to="/library" className="text-sm font-bold">‹ Library</Link>
      <PageHeader className="mt-2" eyebrow={data ? `${data.station} · System${data.legacy ? " · Legacy" : ""}` : "System"} title={data?.name ?? "Loading…"}
        description={data?.updated_at ? `Last updated by ${data.updated_by || "the demo data"}, ${day(data.updated_at)}.` : undefined}
        actions={data?.can_edit && !editing ? (
          <Button variant="outline" onClick={() => { setDraft({ description: data.description, how_it_connects: data.how_it_connects, known_limitations: data.known_limitations }); setEditing(true); }}>
            <Pencil />Edit
          </Button>
        ) : undefined} />
      {page.isError && <Alert variant="destructive">{errorMessage(page.error, "This system is not available.")}</Alert>}
      {message && <Alert variant="success" className="mb-3">{message}</Alert>}
      {error && <Alert variant="destructive" className="mb-3">{error}</Alert>}
      {data && (
        <div className="grid gap-4 xl:grid-cols-[1.5fr_1fr]">
          <div className="grid content-start gap-4">
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-base">What it is</CardTitle></CardHeader>
              <CardContent className="pt-0 text-sm"><EditableText label="What it is" value={editing ? draft.description : data.description} editing={editing}
                onChange={(value) => setDraft({ ...draft, description: value })} empty="Not written yet." /></CardContent>
            </Card>
            <Card aria-label="How it connects">
              <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-base"><Link2 className="size-4" />How it connects</CardTitle>
                <CardDescription>What depends on what: interlocks, permits, signals.</CardDescription></CardHeader>
              <CardContent className="pt-0 text-sm"><EditableText label="How it connects" value={editing ? draft.how_it_connects : data.how_it_connects} editing={editing}
                onChange={(value) => setDraft({ ...draft, how_it_connects: value })} empty="Not written yet. If you know how the parts depend on each other, add it." /></CardContent>
            </Card>
            <Card aria-label="Known limitations">
              <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-base"><AlertTriangle className="size-4 text-warning" />Known limitations</CardTitle></CardHeader>
              <CardContent className="pt-0 text-sm"><EditableText label="Known limitations" value={editing ? draft.known_limitations : data.known_limitations} editing={editing}
                onChange={(value) => setDraft({ ...draft, known_limitations: value })} empty="None recorded." /></CardContent>
            </Card>
            {editing && (
              <div className="flex gap-2"><Button onClick={() => void save()}>Save</Button><Button variant="ghost" onClick={() => setEditing(false)}>Cancel</Button></div>
            )}
            <Card aria-label="Changes over the years">
              <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-base"><History className="size-4" />Changes over the years</CardTitle>
                <CardDescription>Re-wiring, replaced parts, changed settings: what is not on the drawings.</CardDescription></CardHeader>
              <CardContent className="grid gap-3 pt-0 text-sm">
                {data.changes.length ? (
                  <ol className="m-0 grid gap-2 pl-0">
                    {data.changes.map((item) => (
                      <li key={item.id} className="list-none border-l-2 border-primary/40 pl-3">
                        <span className="text-xs font-bold text-muted-foreground">{day(item.changed_on)} · recorded by {item.recorded_by}</span>
                        <p className="m-0">{item.what_changed}</p>
                      </li>
                    ))}
                  </ol>
                ) : <p className="m-0 text-muted-foreground">No changes recorded yet.</p>}
                {data.can_record_change && (
                  <div className="grid gap-2 rounded-lg border border-border p-3">
                    <Field label="Record a change"><Textarea rows={2} placeholder="e.g. drive cooling fan replaced with a higher-flow model" value={change.what_changed}
                      onChange={(event) => setChange({ ...change, what_changed: event.target.value })} /></Field>
                    <div className="flex flex-wrap items-end gap-2">
                      <Field label="When (if known)" className="w-48"><Input type="date" value={change.changed_on} onChange={(event) => setChange({ ...change, changed_on: event.target.value })} /></Field>
                      <Button disabled={change.what_changed.trim().length < 10} onClick={() => void record()}>Record change</Button>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
          <div className="grid content-start gap-4">
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-base">Equipment in this system</CardTitle></CardHeader>
              <CardContent className="grid gap-1.5 pt-0 text-sm">
                {data.equipment.map((item) => (
                  <div key={item.id}><strong>{item.tag}</strong> · {item.name} <Link to={`/library/${item.type_code}`} className="text-xs">({item.type_name})</Link>
                    <span className="block text-xs text-muted-foreground">{item.section} · {item.location}{item.region ? `, ${item.region}` : ""}</span></div>
                ))}
              </CardContent>
            </Card>
            {(data.drawing_differences.length > 0 || data.expert_notes.length > 0) && (
              <Card>
                <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-base"><ShieldAlert className="size-4 text-warning" />Watch out</CardTitle></CardHeader>
                <CardContent className="grid gap-2 pt-0 text-sm">
                  {data.drawing_differences.map((item) => <div key={item.id}><strong>Differs from drawing</strong> ({item.equipment_tag}{item.drawing ? `, ${item.drawing}` : ""}): {item.description}</div>)}
                  {data.expert_notes.map((item) => (
                    <div key={item.id}><Sparkles className="mr-1 inline size-4 text-primary" /><strong>{item.title}</strong> <span className="text-xs text-muted-foreground">({item.expert})</span>
                      {item.what_fools_people && <span className="block">What fools people: {item.what_fools_people}</span>}</div>
                  ))}
                </CardContent>
              </Card>
            )}
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-base">Recent faults on this system</CardTitle></CardHeader>
              <CardContent className="grid gap-2 pt-0 text-sm">
                {data.recent_faults.length ? data.recent_faults.map((item) => (
                  <div key={item.id} className="border-b border-border pb-2 last:border-0">
                    <Link to={`/faults?mode=history&fault=${item.id}`} className="font-bold">{item.reference}</Link> · {item.equipment_tag} · {item.symptom}
                    <span className="block text-xs text-muted-foreground">{day(item.reported_at)}{item.cause ? ` · cause: ${item.cause}` : ""}</span>
                    {item.worked && <span className="block text-success">Worked: {item.worked}</span>}
                  </div>
                )) : <p className="m-0 text-muted-foreground">No faults recorded.</p>}
              </CardContent>
            </Card>
          </div>
        </div>
      )}
    </Page>
  );
}
