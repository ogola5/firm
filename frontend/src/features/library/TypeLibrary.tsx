import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, BookOpen, CheckCircle2, Clock, Search, ShieldAlert, Sparkles, UserRound, XCircle } from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { can, type User } from "../../auth";
import { Alert } from "../../components/ui/alert";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../components/ui/card";
import { Input, NativeSelect, Textarea } from "../../components/ui/form-controls";
import { EmptyState, Page, PageHeader } from "../../components/ui/page";
import { spokenTime } from "../../lib/format";
import { useDebounced } from "../../lib/hooks";
import { SystemsList } from "./SystemPage";
import { errorMessage } from "../../lib/query";
import { api } from "../../offline/api";

/**
 * The knowledge library organised the way a problem arrives: equipment type -> problem -> what now.
 * A memory of what happened on our equipment, led by cases, honest about what failed, with proof and freshness.
 */
type Owner = { id: string; name: string; role: string; section: string; since: string | null } | null;
type TypeRow = {
  code: string; name: string; sections: string[]; regions: string[]; equipment_count: number; faults: number;
  faults_last_year: number; open_faults: number; procedures: number; fading_procedures: number; expert_notes: number;
  drawing_differences: number; owner: Owner;
};
type Evidence = { worked: number; failed: number; used: number; last_confirmed_working: string | null; fading: boolean; freshness: string };
type ProcedureCard = {
  id: string; reference: string; title: string; version: number; status: string; symptom: string; cause: string; checks: string;
  fix: string; safety: string; tools: string; author: string; contributors: string[]; source_fault: { id: string; reference: string } | null;
  evidence: Evidence; history: Array<{ version: number; reference: string; status: string; author: string; created_at: string | null }>;
};
type Symptom = {
  symptom: string; faults: number; last_seen: string | null;
  causes: Array<{ cause: string; also_recorded_as: string[]; confirmed: number; seen: number; category: string; first_check: string }>;
  worked: Array<{ action: string; times: number; kind: string }>;
  did_not_work: Array<{ action: string; times: number; note: string }>;
  procedures: ProcedureCard[];
  from_reports: Array<{ key: string; question: string; answer: string; times: number; usually_fixed_by: string; fixed_times: number }>;
  cases: Array<{ id: string; reference: string; equipment_tag: string; station: string; region: string; reported_at: string | null;
    status: string; description: string; cause: string; failed_attempts: number; fixed_by: string }>;
};
type TypePage = {
  code: string; name: string; sections: string[]; faults: number; owner: Owner; can_assign_owner: boolean; can_withdraw: boolean;
  equipment: Array<{ id: string; tag: string; name: string; station: string; region: string; section: string;
    system: { id: string; name: string; legacy: boolean } | null }>;
  symptoms: Symptom[];
  watch_out: {
    expert_notes: Array<{ id: string; title: string; expert: string; year: number; how_it_fails: string; first_checks: string; what_fools_people: string; tricks: string }>;
    safety: string[];
    drawing_differences: Array<{ id: string; equipment_tag: string; description: string; drawing: string; permanence: string }>;
  };
  older_instructions: Array<{ id: string; reference: string; title: string; symptom: string; cause: string; action: string; legacy_reference: string }>;
};

const day = (value: string | null) => (value ? spokenTime(value).replace(/ \d\d:\d\d$/, "") : "—");

type SearchResult = {
  kind: "case" | "procedure" | "expert" | "instruction"; kind_label: string; id: string; title: string; snippet: string;
  matched_words: number; type_code: string; link: string; date?: string | null; status?: string; evidence?: Evidence;
};

/** The server marks matched words [[like this]]; show them in bold. */
function Highlighted({ text }: { text: string }) {
  const parts = text.split(/(\[\[.*?\]\])/g);
  return <>{parts.map((part, index) => (part.startsWith("[[") ? <mark key={index} className="rounded bg-warning/25 px-0.5 font-semibold text-foreground">{part.slice(2, -2)}</mark> : part))}</>;
}

/** Search what we have learnt: cases, procedures, expert notes, older instructions. Ranked by how many words match. */
function LibrarySearchResults({ query }: { query: string }) {
  const results = useQuery({
    queryKey: ["library", "search", query], enabled: query.length >= 3,
    queryFn: () => api<{ results: SearchResult[] }>(`/api/v1/library/search?q=${encodeURIComponent(query)}`),
  });
  if (query.length < 3) return null;
  const rows = results.data?.results ?? [];
  return (
    <Card className="mb-4" aria-label="Search results">
      <CardHeader className="pb-2">
        <CardTitle className="text-base">{results.isLoading ? "Searching…" : `${rows.length} result(s) for “${query}”`}</CardTitle>
        <CardDescription>Cases, procedures, expert knowledge and older instructions. Shorthand works: “vfd”, “drive”, “hot”, “comms”.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-2 pt-0">
        {results.isError && <Alert variant="destructive">{errorMessage(results.error, "Search is not available offline.")}</Alert>}
        {results.data && !rows.length && <p className="m-0 text-sm text-muted-foreground">Nothing found. Try fewer or different words.</p>}
        {rows.map((row) => (
          <Link key={`${row.kind}-${row.id}`} to={row.link} className="grid gap-1 rounded-lg border border-border p-3 text-foreground no-underline hover:border-primary">
            <span className="flex flex-wrap items-center gap-2">
              <Badge variant={row.kind === "procedure" ? "success" : "outline"} className="normal-case">{row.kind_label}</Badge>
              {row.type_code && <span className="text-xs font-bold text-muted-foreground">{row.type_code}</span>}
              {row.evidence && <span className="text-xs text-muted-foreground">worked {row.evidence.worked}×{row.evidence.fading ? " · check before relying on it" : ""}</span>}
            </span>
            <strong className="text-sm">{row.title}</strong>
            {row.snippet && <span className="text-sm text-muted-foreground"><Highlighted text={row.snippet} /></span>}
          </Link>
        ))}
      </CardContent>
    </Card>
  );
}

export function LibraryIndex({ user }: { user: User }) {
  const [search, setSearch] = useState("");
  const [section, setSection] = useState(user.section || "");
  const debounced = useDebounced(search.trim());
  const types = useQuery({ queryKey: ["library", "types"], queryFn: () => api<{ types: TypeRow[] }>("/api/v1/library/types") });
  const rows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return (types.data?.types ?? []).filter((row) => (!section || row.sections.includes(section))
      && (!needle || `${row.name} ${row.code}`.toLowerCase().includes(needle)));
  }, [types.data, search, section]);
  const sections = [...new Set((types.data?.types ?? []).flatMap((row) => row.sections))].sort();

  return (
    <Page>
      <PageHeader
        eyebrow={`${user.access.level} · Shared across all sections and regions`}
        title="Library"
        description="What we have learnt on our own equipment: pick the type of equipment, then the problem. Each page shows likely causes, what worked, what didn't, and who knows it."
      />
      <div className="mb-4 flex flex-wrap gap-3">
        <div className="relative min-w-[14rem] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input aria-label="Search the library" className="pl-9" placeholder="Search: a type, a problem, a fix… e.g. “drive hot trip”" value={search} onChange={(event) => setSearch(event.target.value)} />
        </div>
        <NativeSelect aria-label="Section" className="w-auto" value={section} onChange={(event) => setSection(event.target.value)}>
          <option value="">All sections</option>
          {sections.map((item) => <option key={item}>{item}</option>)}
        </NativeSelect>
      </div>
      <LibrarySearchResults query={debounced} />
      {debounced.length < 3 && <SystemsList />}
      {debounced.length < 3 && <h2 className="mb-3 mt-0 text-lg">Types of equipment</h2>}
      {types.isError && <Alert variant="destructive">{errorMessage(types.error, "The library is not available.")}</Alert>}
      {types.data && !rows.length && debounced.length < 3 && <EmptyState>No equipment type matches.</EmptyState>}
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {rows.map((row) => (
          <Link key={row.code} to={`/library/${row.code}`} aria-label={`${row.name} library`}
            className="grid gap-2 rounded-xl border border-border bg-card p-4 text-foreground no-underline shadow-sm hover:border-primary">
            <div className="flex items-baseline justify-between gap-2">
              <strong className="text-lg">{row.name}</strong>
              <span className="text-xs font-bold text-muted-foreground">{row.code}</span>
            </div>
            <div className="text-sm text-muted-foreground">
              {row.equipment_count} item(s) · {row.faults_last_year} fault(s) in the last year{row.open_faults ? ` · ${row.open_faults} open now` : ""}
            </div>
            <div className="flex flex-wrap gap-1.5 text-xs">
              <Badge variant={row.procedures ? "success" : "outline"} className="normal-case">{row.procedures} procedure(s)</Badge>
              {row.fading_procedures > 0 && <Badge variant="warning" className="normal-case">{row.fading_procedures} need checking</Badge>}
              {row.expert_notes > 0 && <Badge variant="outline" className="normal-case">{row.expert_notes} expert note(s)</Badge>}
              {row.drawing_differences > 0 && <Badge variant="outline" className="normal-case">{row.drawing_differences} drawing difference(s)</Badge>}
            </div>
            <div className="text-xs text-muted-foreground">
              {row.owner ? <>Knowledge owner: <span className="font-semibold text-foreground">{row.owner.name}</span></> : "No knowledge owner yet"}
            </div>
          </Link>
        ))}
      </div>
    </Page>
  );
}

function Evidence({ evidence }: { evidence: Evidence }) {
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <Badge variant="success" className="normal-case"><CheckCircle2 className="mr-1 size-3" />Worked {evidence.worked}×</Badge>
      {evidence.failed > 0 && <Badge variant="destructive" className="normal-case">Didn't work {evidence.failed}×</Badge>}
      <span className={evidence.fading ? "font-semibold text-warning" : "text-muted-foreground"}>
        <Clock className="mr-1 inline size-3" aria-hidden />
        {evidence.last_confirmed_working ? `Last confirmed working ${day(evidence.last_confirmed_working)}` : "Never confirmed working"}
        {evidence.fading ? ": check before relying on it" : ""}
      </span>
    </div>
  );
}

function ProcedureBlock({ card, canWithdraw, onChanged }: { card: ProcedureCard; canWithdraw: boolean; onChanged: (text: string) => void }) {
  const [withdrawing, setWithdrawing] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  async function withdraw() {
    try {
      await api(`/api/v1/procedure-updates/${card.id}/withdraw`, { method: "POST", body: JSON.stringify({ reason }) });
      onChanged(`${card.reference} withdrawn. It stays in the history.`);
    } catch (reason) {
      setError(errorMessage(reason, "Not withdrawn."));
    }
  }
  return (
    <article aria-label={`Procedure ${card.reference}`} className={`grid gap-2 rounded-lg border p-3 ${card.evidence.fading ? "border-warning/60 bg-warning/5" : "border-border"}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <strong><BookOpen className="mr-1 inline size-4" aria-hidden />{card.title}</strong>
        <span className="text-xs text-muted-foreground">{card.reference} · v{card.version}</span>
      </div>
      <Evidence evidence={card.evidence} />
      <div className="grid gap-2 text-sm md:grid-cols-2">
        <div><div className="text-xs font-bold uppercase text-muted-foreground">Check first</div><p className="m-0 whitespace-pre-line">{card.checks}</p></div>
        <div><div className="text-xs font-bold uppercase text-muted-foreground">Fix</div><p className="m-0 whitespace-pre-line">{card.fix}</p></div>
      </div>
      {card.tools && <p className="m-0 text-sm"><strong>Tools and parts:</strong> {card.tools}</p>}
      {card.safety && <p className="m-0 flex gap-1.5 text-sm"><ShieldAlert className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden />{card.safety}</p>}
      <div className="text-xs text-muted-foreground">
        By {card.contributors.join(", ") || card.author}
        {card.source_fault ? <> · from <Link to={`/faults?mode=history&fault=${card.source_fault.id}`}>{card.source_fault.reference}</Link></> : null}
        {card.history.length > 1 && <> · <Link to={`/procedures/${card.id}/versions`} className="font-semibold">compare {card.history.length} versions</Link></>}
      </div>
      {canWithdraw && !withdrawing && <Button variant="ghost" size="sm" className="w-fit" onClick={() => setWithdrawing(true)}>No longer valid…</Button>}
      {withdrawing && (
        <div className="grid gap-2">
          <Textarea aria-label="Why it no longer applies" rows={2} placeholder="e.g. the actuator was replaced with a different model" value={reason} onChange={(event) => setReason(event.target.value)} />
          <div className="flex gap-2">
            <Button size="sm" variant="destructive" disabled={reason.trim().length < 5} onClick={() => void withdraw()}>Withdraw</Button>
            <Button size="sm" variant="ghost" onClick={() => setWithdrawing(false)}>Cancel</Button>
          </div>
          {error && <span className="text-xs font-semibold text-destructive">{error}</span>}
        </div>
      )}
    </article>
  );
}

function SymptomSection({ item, canWithdraw, onChanged }: { item: Symptom; canWithdraw: boolean; onChanged: (text: string) => void }) {
  return (
    <Card aria-label={`Problem: ${item.symptom}`}>
      <CardHeader className="pb-2">
        <CardTitle className="text-xl">{item.symptom}</CardTitle>
        <CardDescription>{item.faults} fault(s) on record{item.last_seen ? `, last ${day(item.last_seen)}` : ""}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        {item.causes.length > 0 && (
          <section>
            <h3 className="m-0 mb-1 text-sm font-extrabold uppercase text-muted-foreground">Likely causes</h3>
            <ol className="m-0 grid gap-1.5 pl-5">
              {item.causes.map((cause) => (
                <li key={cause.cause}>
                  <strong>{cause.cause}</strong> <span className="text-sm text-muted-foreground">· confirmed {cause.confirmed} of {cause.seen} time(s){cause.category ? ` · ${cause.category}` : ""}</span>
                  {cause.also_recorded_as.length > 0 && <div className="text-xs text-muted-foreground">Also recorded as: {cause.also_recorded_as.join("; ")}</div>}
                  {cause.first_check && <div className="text-sm">Check first: {cause.first_check}</div>}
                </li>
              ))}
            </ol>
          </section>
        )}
        <div className="grid gap-4 md:grid-cols-2">
          <section>
            <h3 className="m-0 mb-1 flex items-center gap-1.5 text-sm font-extrabold uppercase text-success"><CheckCircle2 className="size-4" />What worked</h3>
            {item.worked.length ? (
              <ul className="m-0 grid gap-1 pl-5 text-sm">{item.worked.map((row) => <li key={row.action}>{row.action} <span className="text-muted-foreground">({row.times}×)</span></li>)}</ul>
            ) : <p className="m-0 text-sm text-muted-foreground">Nothing recorded yet.</p>}
          </section>
          <section>
            <h3 className="m-0 mb-1 flex items-center gap-1.5 text-sm font-extrabold uppercase text-destructive"><XCircle className="size-4" />What didn't work</h3>
            {item.did_not_work.length ? (
              <ul className="m-0 grid gap-1 pl-5 text-sm">
                {item.did_not_work.map((row) => <li key={row.action}>{row.action} <span className="text-muted-foreground">({row.times}×)</span>{row.note && <div className="text-muted-foreground">{row.note}</div>}</li>)}
              </ul>
            ) : <p className="m-0 text-sm text-muted-foreground">No failed attempts recorded.</p>}
          </section>
        </div>
        {item.from_reports.length > 0 && (
          <section aria-label="What reporters said">
            <h3 className="m-0 mb-1 text-sm font-extrabold uppercase text-muted-foreground">What reporters said</h3>
            <ul className="m-0 grid gap-1 pl-5 text-sm">
              {item.from_reports.map((row) => (
                <li key={`${row.key}-${row.answer}`}>
                  {row.question}: <strong>{row.answer}</strong> <span className="text-muted-foreground">({row.times}×)</span>
                  {row.usually_fixed_by && <span>: usually fixed by {row.usually_fixed_by.charAt(0).toLowerCase()}{row.usually_fixed_by.slice(1)} <span className="text-muted-foreground">({row.fixed_times}×)</span></span>}
                </li>
              ))}
            </ul>
          </section>
        )}
        {item.procedures.length > 0 && (
          <section className="grid gap-2">
            <h3 className="m-0 text-sm font-extrabold uppercase text-muted-foreground">Approved procedures</h3>
            {item.procedures.map((card) => <ProcedureBlock key={card.id} card={card} canWithdraw={canWithdraw} onChanged={onChanged} />)}
          </section>
        )}
        {item.cases.length > 0 && (
          <details>
            <summary className="cursor-pointer text-sm font-bold">What happened: {item.cases.length} recent case(s)</summary>
            <ul className="m-0 mt-2 grid gap-2 pl-0">
              {item.cases.map((row) => (
                <li key={row.id} className="list-none rounded-md border border-border p-2 text-sm">
                  <Link to={`/faults?mode=history&fault=${row.id}`} className="font-bold">{row.reference}</Link> · {row.equipment_tag} · {day(row.reported_at)}{row.region ? ` · ${row.region}` : ""}
                  {row.description && <div>{row.description}</div>}
                  <div className="text-muted-foreground">
                    {row.cause && <>Cause: {row.cause}. </>}{row.failed_attempts > 0 && <>{row.failed_attempts} attempt(s) didn't work. </>}{row.fixed_by && <>Fixed by: {row.fixed_by}</>}
                  </div>
                </li>
              ))}
            </ul>
          </details>
        )}
      </CardContent>
    </Card>
  );
}

function OwnerCard({ page, user, onChanged }: { page: TypePage; user: User; onChanged: (text: string) => void }) {
  const [choosing, setChoosing] = useState(false);
  const [chosen, setChosen] = useState("");
  const candidates = useQuery({
    queryKey: ["library", "owner-candidates"], enabled: choosing,
    queryFn: () => api<Array<{ id: string; name: string; role_label: string; section: string; region: string }>>("/api/v1/library/owner-candidates"),
  });
  async function save() {
    await api(`/api/v1/library/types/${page.code}/owner`, { method: "PUT", body: JSON.stringify({ user_id: chosen }) });
    setChoosing(false);
    onChanged("Knowledge owner named. They have been emailed.");
  }
  const mine = page.owner?.id === user.id;
  return (
    <Card>
      <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-base"><UserRound className="size-4" />Knowledge owner</CardTitle></CardHeader>
      <CardContent className="grid gap-2 text-sm">
        {page.owner ? <p className="m-0"><strong>{page.owner.name}</strong>{mine ? " (you)" : ""} keeps this page current: checks what is fading and withdraws what no longer works.</p>
          : <p className="m-0 text-muted-foreground">No one is named yet.</p>}
        {page.can_assign_owner && !choosing && <Button variant="outline" size="sm" className="w-fit" onClick={() => setChoosing(true)}>{page.owner ? "Change owner" : "Name an owner"}</Button>}
        {choosing && (
          <div className="flex flex-wrap gap-2">
            <NativeSelect aria-label="Owner" className="w-auto" value={chosen} onChange={(event) => setChosen(event.target.value)}>
              <option value="">Choose a CT or SE…</option>
              {candidates.data?.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </NativeSelect>
            <Button size="sm" disabled={!chosen} onClick={() => void save()}>Save</Button>
            <Button size="sm" variant="ghost" onClick={() => setChoosing(false)}>Cancel</Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function TypeLibraryPage({ user }: { user: User }) {
  const { code = "" } = useParams();
  const queryClient = useQueryClient();
  const [message, setMessage] = useState("");
  const page = useQuery({ queryKey: ["library", "type", code], queryFn: () => api<TypePage>(`/api/v1/library/types/${encodeURIComponent(code)}`) });
  const changed = (text: string) => {
    setMessage(text);
    void queryClient.invalidateQueries({ queryKey: ["library"] });
  };
  const data = page.data;
  return (
    <Page>
      <Link to="/library" className="text-sm font-bold">‹ Library</Link>
      <PageHeader
        className="mt-2"
        eyebrow={data ? `${data.sections.join(", ")} · ${data.equipment.length} item(s) · ${data.faults} fault(s) on record` : "Library"}
        title={data?.name ?? "Loading…"}
        description="Pick the problem you are seeing. Similar is not the same: check before you act."
      />
      {page.isError && <Alert variant="destructive">{errorMessage(page.error, "This page is not available.")}</Alert>}
      {message && <Alert variant="success" className="mb-3">{message}</Alert>}
      {data && (
        <div className="grid gap-4 xl:grid-cols-[1.7fr_1fr]">
          <div className="grid content-start gap-4">
            <nav aria-label="Problems" className="flex flex-wrap gap-2">
              {data.symptoms.map((item) => (
                <a key={item.symptom} href={`#problem-${item.symptom.replace(/\W+/g, "-")}`} className="rounded-full border border-border bg-card px-3 py-1.5 text-sm font-semibold no-underline">
                  {item.symptom} <span className="text-muted-foreground">({item.faults})</span>
                </a>
              ))}
            </nav>
            {!data.symptoms.length && <EmptyState>No faults recorded on this type yet.</EmptyState>}
            {data.symptoms.map((item) => (
              <div key={item.symptom} id={`problem-${item.symptom.replace(/\W+/g, "-")}`} className="scroll-mt-20">
                <SymptomSection item={item} canWithdraw={data.can_withdraw} onChanged={changed} />
              </div>
            ))}
          </div>
          <div className="grid content-start gap-4">
            <OwnerCard page={data} user={user} onChanged={changed} />
            {(data.watch_out.expert_notes.length > 0 || data.watch_out.safety.length > 0 || data.watch_out.drawing_differences.length > 0) && (
              <Card aria-label="Watch out">
                <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-base"><AlertTriangle className="size-4 text-warning" />Watch out</CardTitle></CardHeader>
                <CardContent className="grid gap-3 text-sm">
                  {data.watch_out.expert_notes.map((note) => (
                    <div key={note.id} className="grid gap-0.5">
                      <strong><Sparkles className="mr-1 inline size-4 text-primary" aria-hidden />{note.title}</strong>
                      <span className="text-xs text-muted-foreground">Expert knowledge: {note.expert}, {note.year}</span>
                      {note.what_fools_people && <span>What fools people: {note.what_fools_people}</span>}
                      {note.first_checks && <span>First checks: {note.first_checks}</span>}
                    </div>
                  ))}
                  {data.watch_out.drawing_differences.map((item) => (
                    <div key={item.id}><strong>Differs from drawing</strong> ({item.equipment_tag}{item.drawing ? `, ${item.drawing}` : ""}): {item.description}</div>
                  ))}
                  {data.watch_out.safety.map((line) => <div key={line} className="flex gap-1.5"><ShieldAlert className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden />{line}</div>)}
                </CardContent>
              </Card>
            )}
            {data.older_instructions.length > 0 && (
              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-base">Older work instructions</CardTitle><CardDescription>From the paper library; not yet confirmed by a recent fix.</CardDescription></CardHeader>
                <CardContent className="grid gap-2 text-sm">
                  {data.older_instructions.map((item) => <div key={item.id}><strong>{item.reference}</strong> {item.title}{item.legacy_reference ? ` (${item.legacy_reference})` : ""}</div>)}
                </CardContent>
              </Card>
            )}
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-base">Equipment of this type</CardTitle></CardHeader>
              <CardContent className="grid gap-1 text-sm">
                {data.equipment.map((item) => (
                  <div key={item.id}><strong>{item.tag}</strong> · {item.name} <span className="text-muted-foreground">· {item.station}{item.region ? `, ${item.region}` : ""}</span>
                    {item.system && <span className="block text-xs">Part of <Link to={`/library/systems/${item.system.id}`}>{item.system.name}</Link></span>}</div>
                ))}
              </CardContent>
            </Card>
          </div>
        </div>
      )}
    </Page>
  );
}

type Impact = {
  published: number; helped_total: number; helped_last_90_days: number;
  helped: Array<{ procedure_reference: string; procedure_title: string; colleague: string; equipment_tag: string; confirmed_at: string | null }>;
  owned_types: Array<{ code: string; name: string }>;
  needs_attention: Array<{ code: string; reference: string; title: string }>;
};

/** On the home page: what your knowledge has done for colleagues, and anything you own that needs checking. */
export function KnowledgeImpactPanel({ user }: { user: User }) {
  const impact = useQuery({ queryKey: ["library", "impact", user.id], enabled: can(user, "library.view"),
    queryFn: () => api<Impact>("/api/v1/me/knowledge-impact") });
  const data = impact.data;
  if (!data || (!data.helped_total && !data.needs_attention.length)) return null;
  return (
    <Card aria-label="Your knowledge">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base"><Sparkles className="size-4 text-primary" />Your knowledge at work</CardTitle>
        {data.helped_total > 0 && (
          <CardDescription>Your procedures helped colleagues fix {data.helped_total} fault(s){data.helped_last_90_days ? `, ${data.helped_last_90_days} in the last 90 days` : ""}. Thank you.</CardDescription>
        )}
      </CardHeader>
      <CardContent className="grid gap-2 pt-0 text-sm">
        {data.helped.slice(0, 3).map((item, index) => (
          <div key={`${item.procedure_reference}-${index}`}>
            <strong>{item.colleague}</strong> fixed {item.equipment_tag || "a fault"} with your {item.procedure_reference} <span className="text-muted-foreground">· {day(item.confirmed_at)}</span>
          </div>
        ))}
        {data.needs_attention.length > 0 && (
          <div className="rounded-md bg-warning/10 p-2">
            <strong>Needs checking</strong> (you own {data.owned_types.map((item) => item.name.toLowerCase()).join(", ")}):
            <ul className="m-0 pl-5">{data.needs_attention.map((item) => <li key={item.reference}><Link to={`/library/${item.code}`}>{item.reference}</Link> {item.title}</li>)}</ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
