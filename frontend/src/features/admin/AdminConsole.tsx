import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { type User } from "../../auth";
import { Alert } from "../../components/ui/alert";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../components/ui/card";
import { Field, Input, NativeSelect, Textarea } from "../../components/ui/form-controls";
import { Page, PageHeader } from "../../components/ui/page";
import { SkeletonLines } from "../../components/ui/skeleton";
import { errorMessage } from "../../lib/query";
import { startViewAs } from "../../lib/systemConfig";
import { toast } from "../../lib/toast";
import { cn } from "../../lib/utils";
import { api } from "../../offline/api";

const SECTIONS = ["Systems Automation", "Electrical", "Mechanical"];
const REGIONS = ["Western", "Nairobi", "Coast"];
const CRITICALITY = ["Low", "Medium", "High", "Critical"];

type Health = {
  version: { app: string; commit: string; started_at: string; host: string };
  database: { ok: boolean; kind: string; latency_ms: number; migration: { current: string | null; latest: string | null; up_to_date: boolean } };
  scheduler: { enabled: boolean; last_run: string | null; last_error: string; runs: number };
  mail: { demo_mailbox: boolean; messages: number };
  sync: { conflicts_waiting: number };
  storage: { path: string; files: number; bytes: number; persistent: boolean; warning: string };
  counts: { people_active: number; faults_open: number };
  errors: Array<{ at: string; where: string; message: string; kind: string }>;
  demo_reset: { running: boolean; started_at: string | null; finished_at: string | null; ok: boolean | null; by: string };
};
type Rule = {
  key: string; group: string; label: string; help: string; kind: "int" | "bool" | "text"; minimum: number; maximum: number;
  developer_only: boolean; value: number | boolean | string; default: number | boolean | string; changed: boolean;
  updated_by: string; updated_at: string | null;
};
type Organisation = {
  sections: Array<{ name: string; people: number; equipment: number; people_by_region: Record<string, number> }>;
  regions: Array<{ name: string; stations: string[] }>; unplaced_stations: string[]; note: string;
};
type Equipment = { id: string; tag: string; name: string; section: string; station: string; region: string; location: string; category: string; criticality: string; aliases: string };
type AuditRow = { id: string; at: string | null; action: string; actor: string; target: string; details: Record<string, unknown> };
type Person = { id: string; name: string; role_label: string; section: string; region: string };

const when = (value: string | null | undefined) => (value ? new Date(value).toLocaleString() : "never");
const size = (bytes: number) => (bytes > 1_048_576 ? `${(bytes / 1_048_576).toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`);

function Tile({ title, state, children }: { title: string; state: "good" | "warn" | "bad" | "info"; children: ReactNode }) {
  const tone = { good: "border-l-success", warn: "border-l-warning", bad: "border-l-destructive", info: "border-l-border" }[state];
  const word = { good: "OK", warn: "Check", bad: "Problem", info: "Info" }[state];
  return (
    <Card className={cn("border-l-4", tone)}>
      <CardContent className="grid gap-1 pt-4 text-sm">
        <div className="flex items-center justify-between gap-2">
          <strong className="text-base">{title}</strong>
          <Badge variant={state === "good" ? "success" : state === "warn" ? "warning" : state === "bad" ? "destructive" : "outline"}>{word}</Badge>
        </div>
        {children}
      </CardContent>
    </Card>
  );
}

function HealthTab() {
  const health = useQuery({ queryKey: ["admin", "health"], queryFn: () => api<Health>("/api/v1/admin/health"), refetchInterval: 30_000 });
  if (health.isLoading) return <SkeletonLines lines={6} />;
  if (!health.data) return <Alert variant="destructive">{errorMessage(health.error, "Health could not be loaded.")}</Alert>;
  const h = health.data;
  const migration = h.database.migration;
  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3" aria-label="System health">
      <Tile title="Version" state="info">
        <span>App {h.version.app} · build <code>{h.version.commit}</code></span>
        <span className="text-muted-foreground">Running on {h.version.host} since {when(h.version.started_at)}</span>
      </Tile>
      <Tile title="Database" state={h.database.ok && (migration.up_to_date || migration.current === null) ? "good" : "bad"}>
        <span>{h.database.kind} · answers in {h.database.latency_ms} ms</span>
        <span className="text-muted-foreground">
          {migration.current === null ? "Schema not tracked (test database)" : migration.up_to_date ? `Up to date (migration ${migration.current})` : `Migration ${migration.current}; latest is ${migration.latest}`}
        </span>
      </Tile>
      <Tile title="Background timer" state={!h.scheduler.enabled ? "warn" : h.scheduler.last_error ? "bad" : "good"}>
        <span>Escalation checks, points and scheduled reports, every 10 minutes.</span>
        <span className="text-muted-foreground">
          {!h.scheduler.enabled ? "Switched off on this server." : `Last run ${when(h.scheduler.last_run)}${h.scheduler.last_error ? ` · failed: ${h.scheduler.last_error}` : ""}`}
        </span>
      </Tile>
      <Tile title="Evidence files" state={h.storage.persistent ? "good" : "warn"}>
        <span>{h.storage.files} file(s), {size(h.storage.bytes)}</span>
        {h.storage.warning ? <span className="font-semibold text-warning">{h.storage.warning}</span> : <span className="text-muted-foreground">Kept on this server's disk.</span>}
      </Tile>
      <Tile title="Email" state="info">
        <span>{h.mail.demo_mailbox ? "Demo mailbox: no real email is sent." : "Real email."}</span>
        <span className="text-muted-foreground">{h.mail.messages} message(s) written</span>
      </Tile>
      <Tile title="Offline devices" state={h.sync.conflicts_waiting ? "warn" : "good"}>
        <span>{h.sync.conflicts_waiting ? `${h.sync.conflicts_waiting} change(s) from devices waiting for a decision` : "No changes waiting for a decision."}</span>
        <span className="text-muted-foreground">{h.counts.people_active} active accounts · {h.counts.faults_open} open faults</span>
      </Tile>
      <Card className="md:col-span-2 xl:col-span-3">
        <CardHeader className="pb-2"><CardTitle className="text-lg">Recent errors</CardTitle><CardDescription>Since this server started. Messages only; details stay in the server log.</CardDescription></CardHeader>
        <CardContent>
          {h.errors.length
            ? <ul className="m-0 grid gap-1 p-0 text-sm">{h.errors.map((item, index) => (
              <li key={index} className="list-none rounded border border-border px-3 py-2"><strong>{when(item.at)}</strong> · {item.kind || item.where}: {item.message}</li>))}</ul>
            : <p className="m-0 text-sm text-muted-foreground">No errors.</p>}
        </CardContent>
      </Card>
    </div>
  );
}

function RuleRow({ rule }: { rule: Rule }) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<string | boolean>(rule.kind === "bool" ? Boolean(rule.value) : String(rule.value));
  const save = useMutation({
    mutationFn: (body: Record<string, unknown>) => api<{ value: unknown }>(`/api/v1/admin/settings/${rule.key}`, { method: "PATCH", body: JSON.stringify(body) }),
    onSuccess: async (result, body) => {
      if (body.reset) setDraft(rule.kind === "bool" ? Boolean(result.value) : String(result.value));
      toast.success(body.reset ? "Back to the default." : "Saved. It applies straight away.");
      await queryClient.invalidateQueries({ queryKey: ["admin", "settings"] });
      await queryClient.invalidateQueries({ queryKey: ["system-config"] });
    },
    onError: (reason) => toast.error(errorMessage(reason, "Not saved.")),
  });
  const value = rule.kind === "int" ? Number(draft) : rule.kind === "bool" ? draft === true : String(draft);
  const dirty = value !== rule.value;
  return (
    <form className="grid gap-2 border-t border-border py-3 first:border-0 md:grid-cols-[1fr_auto] md:items-end"
      onSubmit={(event: FormEvent) => { event.preventDefault(); save.mutate({ value }); }}>
      <div className="grid gap-1">
        <label htmlFor={`rule-${rule.key}`} className="font-semibold">{rule.label}</label>
        {rule.help && <span className="text-sm text-muted-foreground">{rule.help}</span>}
        <span className="text-xs text-muted-foreground">
          Default {String(rule.default)}{rule.changed ? ` · changed by ${rule.updated_by || "someone"} on ${when(rule.updated_at)}` : ""}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {rule.kind === "bool"
          ? <label className="flex items-center gap-2 text-sm font-semibold"><input id={`rule-${rule.key}`} type="checkbox" className="size-5" checked={draft === true} onChange={(event) => setDraft(event.target.checked)} />{draft ? "On" : "Off"}</label>
          : <Input id={`rule-${rule.key}`} className={rule.kind === "int" ? "w-28" : "w-72"} type={rule.kind === "int" ? "number" : "text"}
            min={rule.kind === "int" ? rule.minimum : undefined} max={rule.kind === "int" ? rule.maximum : undefined}
            maxLength={rule.kind === "text" ? rule.maximum : undefined} value={String(draft)} onChange={(event) => setDraft(event.target.value)} />}
        <Button type="submit" disabled={!dirty || save.isPending}>Save</Button>
        {rule.changed && <Button type="button" variant="ghost" disabled={save.isPending} onClick={() => save.mutate({ reset: true })}>Reset to default</Button>}
      </div>
    </form>
  );
}

function RulesTab({ developerGroup = false }: { developerGroup?: boolean }) {
  const rules = useQuery({ queryKey: ["admin", "settings"], queryFn: () => api<Rule[]>("/api/v1/admin/settings") });
  if (rules.isLoading) return <SkeletonLines lines={6} />;
  if (!rules.data) return <Alert variant="destructive">{errorMessage(rules.error, "Rules could not be loaded.")}</Alert>;
  const shown = rules.data.filter((rule) => rule.developer_only === developerGroup);
  const groups = [...new Set(shown.map((rule) => rule.group))];
  return (
    <div className="grid gap-4">
      {!developerGroup && <p className="m-0 text-sm text-muted-foreground">Changes apply at once to everyone, and each one is kept in the audit trail. Secrets and server settings are never changed here.</p>}
      {groups.map((group) => (
        <Card key={group}>
          <CardHeader className="pb-0"><CardTitle className="text-lg">{group}</CardTitle></CardHeader>
          <CardContent>{shown.filter((rule) => rule.group === group).map((rule) => <RuleRow key={`${rule.key}-${String(rule.value)}`} rule={rule} />)}</CardContent>
        </Card>
      ))}
    </div>
  );
}

function OrganisationTab() {
  const org = useQuery({ queryKey: ["admin", "organisation"], queryFn: () => api<Organisation>("/api/v1/admin/organisation") });
  if (!org.data) return org.isLoading ? <SkeletonLines lines={5} /> : <Alert variant="destructive">{errorMessage(org.error, "Not loaded.")}</Alert>;
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader><CardTitle className="text-lg">Sections</CardTitle><CardDescription>Instrumentation and Control is part of Systems Automation.</CardDescription></CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-muted-foreground"><th className="py-1">Section</th>{REGIONS.map((region) => <th key={region}>{region}</th>)}<th>People</th><th>Equipment</th></tr></thead>
            <tbody>{org.data.sections.map((section) => (
              <tr key={section.name} className="border-t border-border"><td className="py-2 font-semibold">{section.name}</td>
                {REGIONS.map((region) => <td key={region}>{section.people_by_region[region] ?? 0}</td>)}<td>{section.people}</td><td>{section.equipment}</td></tr>
            ))}</tbody>
          </table>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle className="text-lg">Regions and stations</CardTitle><CardDescription>{org.data.note}</CardDescription></CardHeader>
        <CardContent className="grid gap-2 text-sm">
          {org.data.regions.map((region) => (
            <p key={region.name} className="m-0"><strong>{region.name}:</strong> {region.stations.join(", ") || "no stations yet"}</p>
          ))}
          {org.data.unplaced_stations.length > 0 && <Alert variant="warning">Stations with no region: {org.data.unplaced_stations.join(", ")}</Alert>}
        </CardContent>
      </Card>
    </div>
  );
}

const BLANK = { tag: "", name: "", section: "Mechanical", station: "", region: "", location: "", category: "", criticality: "Medium", aliases: "" };
const TEMPLATE = "tag,name,section,station,region,location,criticality,aliases\nDEMO-P-901,Demo transfer pump,Mechanical,PS02,,Tank farm,High,transfer pump demo";

function EquipmentForm({ editing, onDone }: { editing: Equipment | null; onDone: () => void }) {
  const queryClient = useQueryClient();
  const [values, setValues] = useState(editing ? { ...BLANK, ...editing } : BLANK);
  const save = useMutation({
    mutationFn: () => api(editing ? `/api/v1/admin/equipment/${editing.id}` : "/api/v1/admin/equipment", {
      method: editing ? "PATCH" : "POST", body: JSON.stringify(values),
    }),
    onSuccess: async () => {
      toast.success(editing ? `${values.tag} saved.` : `${values.tag} added. Operations can report on it now.`);
      await queryClient.invalidateQueries({ queryKey: ["admin", "equipment"] });
      onDone();
    },
    onError: (reason) => toast.error(errorMessage(reason, "Not saved.")),
  });
  const set = (key: keyof typeof BLANK) => (event: { target: { value: string } }) => setValues({ ...values, [key]: event.target.value });
  return (
    <form aria-label={editing ? `Edit ${editing.tag}` : "Add equipment"} className="grid gap-3 rounded-lg border border-border p-4"
      onSubmit={(event) => { event.preventDefault(); save.mutate(); }}>
      <h3 className="m-0">{editing ? `Edit ${editing.tag}` : "Add equipment"}</h3>
      <div className="grid gap-3 md:grid-cols-3">
        <Field label="Tag"><Input required value={values.tag} onChange={set("tag")} placeholder="e.g. 11-P-901" /></Field>
        <Field label="Name"><Input required value={values.name} onChange={set("name")} placeholder="What people call it" /></Field>
        <Field label="Section that looks after it">
          <NativeSelect value={values.section} onChange={set("section")}>{SECTIONS.map((item) => <option key={item}>{item}</option>)}</NativeSelect>
        </Field>
        <Field label="Station"><Input required value={values.station} onChange={set("station")} placeholder="PS02" /></Field>
        <Field label="Region" hint="Leave empty for a known station">
          <NativeSelect value={values.region} onChange={set("region")}><option value="">From the station</option>{REGIONS.map((item) => <option key={item}>{item}</option>)}</NativeSelect>
        </Field>
        <Field label="Location"><Input value={values.location} onChange={set("location")} placeholder="Pump house" /></Field>
        <Field label="Criticality">
          <NativeSelect value={values.criticality} onChange={set("criticality")}>{CRITICALITY.map((item) => <option key={item}>{item}</option>)}</NativeSelect>
        </Field>
        <Field label="Other names (for search)" className="md:col-span-2"><Input value={values.aliases} onChange={set("aliases")} placeholder="transfer pump t901" /></Field>
      </div>
      <div className="flex gap-2">
        <Button type="submit" disabled={save.isPending}>{editing ? "Save" : "Add"}</Button>
        <Button type="button" variant="ghost" onClick={onDone}>Cancel</Button>
      </div>
    </form>
  );
}

function ImportPanel() {
  const queryClient = useQueryClient();
  const [text, setText] = useState("");
  const [result, setResult] = useState<{ rows: number; add: number; update: number; errors: Array<{ row: number; tag: string; problem: string }>; saved: boolean } | null>(null);
  async function run(dry: boolean) {
    try {
      const outcome = await api<NonNullable<typeof result>>("/api/v1/admin/equipment/import", { method: "POST", body: JSON.stringify({ csv: text, dry_run: dry }) });
      setResult(outcome);
      if (outcome.saved) {
        toast.success(`Imported: ${outcome.add} added, ${outcome.update} updated.`);
        await queryClient.invalidateQueries({ queryKey: ["admin", "equipment"] });
      }
    } catch (reason) {
      toast.error(errorMessage(reason, "Could not read the file."));
    }
  }
  return (
    <details className="rounded-lg border border-dashed border-border p-4">
      <summary className="cursor-pointer font-semibold">Import from a spreadsheet (CSV)</summary>
      <div className="mt-3 grid gap-3">
        <p className="m-0 text-sm text-muted-foreground">Paste CSV with a header row. Needed: tag, name, section, station. Optional: region, location, category, criticality, aliases. New tags are added and existing tags updated. Nothing is saved while any row is wrong.</p>
        <Textarea aria-label="CSV to import" rows={6} value={text} onChange={(event) => { setText(event.target.value); setResult(null); }} placeholder={TEMPLATE} />
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" onClick={() => setText(TEMPLATE)}>Use the template</Button>
          <Button type="button" variant="outline" disabled={!text.trim()} onClick={() => void run(true)}>Check</Button>
          <Button type="button" disabled={!text.trim() || Boolean(result && (result.errors.length || result.saved))} onClick={() => void run(false)}>Import</Button>
        </div>
        {result && (
          <Alert variant={result.errors.length ? "destructive" : "success"}>
            {result.errors.length
              ? <span>{result.errors.length} row(s) to fix: {result.errors.map((error) => `row ${error.row}${error.tag ? ` (${error.tag})` : ""}: ${error.problem}`).join("; ")}</span>
              : <span>{result.saved ? "Saved." : "Ready."} {result.add} to add, {result.update} to update.</span>}
          </Alert>
        )}
      </div>
    </details>
  );
}

function EquipmentTab() {
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<Equipment | null | "new">(null);
  const register = useQuery({
    queryKey: ["admin", "equipment", search],
    queryFn: () => api<Equipment[]>(`/api/v1/admin/equipment?search=${encodeURIComponent(search)}`),
  });
  return (
    <div className="grid gap-4">
      <Alert variant="warning">Illustrative register for the demonstration. The real KPC register is loaded only once ICT approves; you can add your own demo equipment here.</Alert>
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Search the register" className="min-w-64 flex-1"><Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Tag, name, station or section" /></Field>
        {editing === null && <Button onClick={() => setEditing("new")}>Add equipment</Button>}
      </div>
      {editing !== null && <EquipmentForm key={editing === "new" ? "new" : editing.id} editing={editing === "new" ? null : editing} onDone={() => setEditing(null)} />}
      <ImportPanel />
      <Card>
        <CardContent className="overflow-x-auto pt-4">
          {register.isLoading ? <SkeletonLines lines={5} /> : (
            <table className="w-full text-sm">
              <thead><tr className="text-left text-muted-foreground"><th className="py-1">Tag</th><th>Name</th><th>Section</th><th>Station</th><th>Region</th><th>Criticality</th><th /></tr></thead>
              <tbody>{(register.data ?? []).map((item) => (
                <tr key={item.id} className="border-t border-border">
                  <td className="py-2 font-semibold">{item.tag}</td><td>{item.name}</td><td>{item.section}</td><td>{item.station}</td><td>{item.region}</td><td>{item.criticality}</td>
                  <td><Button size="sm" variant="ghost" onClick={() => setEditing(item)} aria-label={`Edit ${item.tag}`}>Edit</Button></td>
                </tr>
              ))}</tbody>
            </table>
          )}
          {register.data && <p className="m-0 mt-2 text-xs text-muted-foreground">{register.data.length} item(s){register.data.length >= 500 ? " (first 500)" : ""}</p>}
        </CardContent>
      </Card>
    </div>
  );
}

const ACTION_WORDS: Record<string, string> = {
  SIGNED_IN: "Signed in", ACCOUNT_LOCKED: "Account locked (wrong passwords)", SETTING_CHANGED: "Rule changed",
  EQUIPMENT_ADDED: "Equipment added", EQUIPMENT_CHANGED: "Equipment changed", EQUIPMENT_IMPORTED: "Equipment imported",
  VIEW_AS_STARTED: "Viewed as (read-only)", DEMO_RESET: "Demo data reset",
};

function detailWords(row: AuditRow): string {
  const d = row.details;
  if (row.action === "SETTING_CHANGED") return d.reset ? `${String(d.label)}: back to default (${String(d.to)})` : `${String(d.label)}: ${String(d.from)} → ${String(d.to)}`;
  if (row.action.startsWith("EQUIPMENT_")) return [d.tag, d.name, d.added !== undefined ? `${String(d.added)} added, ${String(d.updated)} updated` : ""].filter(Boolean).map(String).join(" · ");
  return Object.entries(d).filter(([, value]) => value !== "" && value !== null && typeof value !== "object").map(([key, value]) => `${key.replace(/_/g, " ")}: ${String(value)}`).join(" · ");
}

function AuditTab() {
  const [kind, setKind] = useState("");
  const [search, setSearch] = useState("");
  const trail = useQuery({
    queryKey: ["admin", "audit", kind, search],
    queryFn: () => api<AuditRow[]>(`/api/v1/admin/audit?kind=${kind}&search=${encodeURIComponent(search)}`),
  });
  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Show">
          <NativeSelect value={kind} onChange={(event) => setKind(event.target.value)}>
            <option value="">Everything</option><option value="access">Accounts and access</option><option value="signin">Sign-ins</option>
            <option value="settings">Rules</option><option value="equipment">Equipment register</option><option value="developer">Developer tools</option>
          </NativeSelect>
        </Field>
        <Field label="Search" className="min-w-64 flex-1"><Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Name, rule, tag…" /></Field>
      </div>
      <Card>
        <CardContent className="overflow-x-auto pt-4">
          {trail.isLoading ? <SkeletonLines lines={6} /> : (
            <table className="w-full text-sm" aria-label="Audit trail">
              <thead><tr className="text-left text-muted-foreground"><th className="py-1">When</th><th>What</th><th>Who</th><th>About</th><th>Details</th></tr></thead>
              <tbody>{(trail.data ?? []).map((row) => (
                <tr key={row.id} className="border-t border-border align-top">
                  <td className="whitespace-nowrap py-2 pr-3">{when(row.at)}</td>
                  <td className="pr-3 font-semibold">{ACTION_WORDS[row.action] ?? row.action.replace(/_/g, " ").toLowerCase().replace(/^\w/, (letter) => letter.toUpperCase())}</td>
                  <td className="pr-3">{row.actor}</td><td className="pr-3">{row.target === row.actor ? "" : row.target}</td>
                  <td className="text-muted-foreground">{detailWords(row)}</td>
                </tr>
              ))}</tbody>
            </table>
          )}
          {trail.data && !trail.data.length && <p className="m-0 text-sm text-muted-foreground">Nothing matches.</p>}
        </CardContent>
      </Card>
    </div>
  );
}

function DeveloperTab() {
  const people = useQuery({ queryKey: ["admin", "people"], queryFn: () => api<Person[]>("/api/v1/admin/people") });
  const health = useQuery({ queryKey: ["admin", "health"], queryFn: () => api<Health>("/api/v1/admin/health"), refetchInterval: 5_000 });
  const [person, setPerson] = useState("");
  const [confirm, setConfirm] = useState("");
  async function viewAs() {
    try {
      startViewAs(await api(`/api/v1/admin/view-as/${encodeURIComponent(person)}`, { method: "POST" }));
    } catch (reason) {
      toast.error(errorMessage(reason, "Could not open their view."));
    }
  }
  async function reset() {
    try {
      await api("/api/v1/admin/demo/reset", { method: "POST", body: JSON.stringify({ confirm }) });
      setConfirm("");
      toast.success("Reset started. Everyone is signed out when it finishes (about a minute).");
      await health.refetch();
    } catch (reason) {
      toast.error(errorMessage(reason, "The reset did not start."));
    }
  }
  const resetState = health.data?.demo_reset;
  return (
    <div className="grid gap-4">
      <Alert variant="warning">Developer tools: only on the developer / owner account. After ICT takes the system over, this account should be removed or kept as a logged break-glass account.</Alert>
      <Card>
        <CardHeader><CardTitle className="text-lg">View as someone else</CardTitle><CardDescription>See exactly what they see: home, menu and lists. Read-only (nothing can be changed), recorded in the audit trail, ends after an hour.</CardDescription></CardHeader>
        <CardContent className="flex flex-wrap items-end gap-3">
          <Field label="Person" className="min-w-72 flex-1">
            <NativeSelect value={person} onChange={(event) => setPerson(event.target.value)}>
              <option value="">{people.isLoading ? "Loading…" : "Choose a person"}</option>
              {(people.data ?? []).map((item) => (
                <option key={item.id} value={item.id}>{item.name} · {item.role_label}{item.section ? ` · ${item.section}` : ""}{item.region ? ` · ${item.region}` : ""}</option>
              ))}
            </NativeSelect>
          </Field>
          <Button disabled={!person} onClick={() => void viewAs()}>View as this person</Button>
        </CardContent>
      </Card>
      <RulesTab developerGroup />
      <Card className="border-destructive/50">
        <CardHeader><CardTitle className="text-lg">Reset the demonstration data</CardTitle><CardDescription>Deletes everything (faults, accounts that enrolled, changes) and reloads the illustrative data. Everyone is signed out.</CardDescription></CardHeader>
        <CardContent className="grid gap-3">
          {resetState?.running && <Alert variant="warning">Reset running since {when(resetState.started_at)} (started by {resetState.by}).</Alert>}
          {resetState && !resetState.running && resetState.finished_at && (
            <Alert variant={resetState.ok ? "success" : "destructive"}>{resetState.ok ? "Last reset finished" : "Last reset failed"} at {when(resetState.finished_at)}.</Alert>
          )}
          <div className="flex flex-wrap items-end gap-3">
            <Field label='Type RESET to confirm'><Input value={confirm} onChange={(event) => setConfirm(event.target.value)} className="w-40" /></Field>
            <Button variant="destructive" disabled={confirm.trim().toUpperCase() !== "RESET" || resetState?.running} onClick={() => void reset()}>Reset demo data</Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

const TABS = [
  { key: "health", label: "Health" },
  { key: "rules", label: "Rules" },
  { key: "organisation", label: "Organisation" },
  { key: "equipment", label: "Equipment register" },
  { key: "audit", label: "Audit trail" },
  { key: "developer", label: "Developer tools", developer: true },
];

/** System Administrator (ICT) and developer / owner: run the system, never the maintenance work. */
export function AdminConsole({ user }: { user: User }) {
  const [params, setParams] = useSearchParams();
  const tabs = TABS.filter((tab) => !tab.developer || user.developer);
  const current = tabs.find((tab) => tab.key === params.get("tab"))?.key ?? "health";
  return (
    <Page>
      <PageHeader
        eyebrow={`${user.access.level} · ${user.role_label}`}
        title="Admin console"
        description="Run the system: health, rules, reference data and the audit trail. Maintenance decisions stay with maintenance."
        actions={<Button variant="outline" asChild><Link to="/people">User management</Link></Button>}
      />
      <div role="tablist" aria-label="Admin console" className="mb-4 flex flex-wrap gap-1 border-b border-border">
        {tabs.map((tab) => (
          <button key={tab.key} role="tab" type="button" aria-selected={current === tab.key} onClick={() => setParams({ tab: tab.key })}
            className={cn("min-h-11 rounded-t-md px-4 text-sm font-bold", current === tab.key ? "border-b-2 border-primary text-primary" : "text-muted-foreground hover:text-foreground")}>
            {tab.label}
          </button>
        ))}
      </div>
      <div role="tabpanel" aria-label={tabs.find((tab) => tab.key === current)?.label}>
        {current === "health" && <HealthTab />}
        {current === "rules" && <RulesTab />}
        {current === "organisation" && <OrganisationTab />}
        {current === "equipment" && <EquipmentTab />}
        {current === "audit" && <AuditTab />}
        {current === "developer" && user.developer && <DeveloperTab />}
      </div>
    </Page>
  );
}
