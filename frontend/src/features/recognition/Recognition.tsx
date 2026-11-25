import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Award, Trophy } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { can, type User } from "../../auth";
import { Alert } from "../../components/ui/alert";
import { Button } from "../../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../components/ui/card";
import { ChoiceButtons } from "../../components/ui/choice";
import { Field, Input, NativeSelect, Textarea } from "../../components/ui/form-controls";
import { Page, PageHeader, Stat } from "../../components/ui/page";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../../components/ui/table";
import { spokenTime } from "../../lib/format";
import { errorMessage } from "../../lib/query";
import { api } from "../../offline/api";

type Rule = { kind: string; label: string; points: number; description: string; active: boolean };
type AwardRow = { id: string; award_label: string; period: string; scope: string; name: string; section: string; citation: string; prize: string; created_at: string };
type Mine = {
  earned: number; redeemed: number; balance: number; this_month: number; monthly_cap: number; point_value: string; principle: string;
  rules: Rule[]; entries: Array<{ id: string; kind_label: string; points: number; reason: string; link: string; earned_at: string }>;
  redemptions: Array<{ points: number; option: string; value_text: string; created_at: string }>; awards: AwardRow[];
};
type PeriodType = "MONTH" | "QUARTER" | "YEAR";
type PersonRow = { user_id: string; name: string; role: string; section: string; period_points: number; by_kind: Record<string, number>; earned: number; redeemed: number; balance: number };
type Shortlist = {
  award_label: string; period: string; period_label: string; scope: string; can_award: boolean; scopes: string[];
  periods: Array<{ key: string; label: string }>; shortlist: Array<{ user_id: string; name: string; section: string; points: number; evidence: string }>;
  awarded: AwardRow | null;
};

/** Key of the current (running) period, so tables show "to date" by default. */
function currentKey(type: PeriodType): { key: string; label: string } {
  const today = new Date();
  const year = today.getMonth() + 1 >= 7 ? today.getFullYear() : today.getFullYear() - 1;
  const fy = `${year}/${String((year + 1) % 100).padStart(2, "0")}`;
  if (type === "YEAR") return { key: fy, label: `Financial year ${fy} (to date)` };
  if (type === "MONTH") {
    const key = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`;
    return { key, label: `${today.toLocaleDateString("en-GB", { month: "long", year: "numeric" })} (so far)` };
  }
  const quarter = Math.floor(((today.getMonth() + 1 - 7 + 12) % 12) / 3) + 1;
  return { key: `${fy}-Q${quarter}`, label: `Q${quarter} of FY ${fy} (so far)` };
}

const PERIOD_TYPES: Array<{ value: PeriodType; label: string }> = [
  { value: "MONTH", label: "Month" }, { value: "QUARTER", label: "Quarter" }, { value: "YEAR", label: "Financial year" },
];

function MyPoints() {
  const mine = useQuery({ queryKey: ["points", "me"], queryFn: () => api<Mine>("/api/v1/points/me") });
  const data = mine.data;
  return (
    <div className="grid gap-4">
      {mine.isError && <Alert variant="destructive">{errorMessage(mine.error, "Not available.")}</Alert>}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Points to use" value={data?.balance ?? "—"} />
        <Stat label="Earned this month" value={data ? `${data.this_month} of ${data.monthly_cap}` : "—"} />
        <Stat label="Earned in total" value={data?.earned ?? "—"} />
        <Stat label="Already redeemed" value={data?.redeemed ?? "—"} />
      </div>
      <div className="grid gap-4 xl:grid-cols-[1.5fr_1fr]">
        <Card>
          <CardHeader><CardTitle>My points</CardTitle><CardDescription>Every point says what it was for. HR exchanges points for money, vouchers or days off.</CardDescription></CardHeader>
          <CardContent className="grid gap-0 pt-0">
            {data && !data.entries.length && <p className="m-0 text-sm text-muted-foreground">No points yet. They come from procedures, colleagues' fixes using your knowledge, expert sessions, drawing differences and answers.</p>}
            {data?.entries.map((entry) => (
              <div key={entry.id} className="flex items-start justify-between gap-3 border-b border-border py-2.5 text-sm last:border-0">
                <span>
                  <strong>{entry.kind_label}</strong><br />
                  {entry.link ? <Link to={entry.link} className="text-foreground">{entry.reason}</Link> : entry.reason}
                  <br /><span className="text-xs text-muted-foreground">{spokenTime(entry.earned_at)}</span>
                </span>
                <strong className="whitespace-nowrap text-success">+{entry.points}</strong>
              </div>
            ))}
            {data?.redemptions.map((item, index) => (
              <div key={`r${index}`} className="flex items-start justify-between gap-3 border-b border-border py-2.5 text-sm last:border-0">
                <span><strong>Redeemed: {item.option}</strong>{item.value_text ? ` · ${item.value_text}` : ""}<br /><span className="text-xs text-muted-foreground">{spokenTime(item.created_at)}</span></span>
                <strong className="whitespace-nowrap">−{item.points}</strong>
              </div>
            ))}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>How points are earned</CardTitle><CardDescription>{data?.principle}</CardDescription></CardHeader>
          <CardContent className="grid gap-2 pt-0 text-sm">
            {data?.rules.filter((rule) => rule.active).map((rule) => (
              <div key={rule.kind} className="flex items-start justify-between gap-3">
                <span><strong>{rule.label}</strong><br /><span className="text-muted-foreground">{rule.description}</span></span>
                <strong className="whitespace-nowrap">{rule.points}</strong>
              </div>
            ))}
            {data && <p className="m-0 text-xs text-muted-foreground">Up to {data.monthly_cap} points a month. {data.point_value}</p>}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function AwardsWall() {
  const awards = useQuery({ queryKey: ["awards"], queryFn: () => api<AwardRow[]>("/api/v1/awards") });
  return (
    <Card>
      <CardHeader><CardTitle className="flex items-center gap-2"><Trophy className="size-5 text-warning" /> Awards</CardTitle><CardDescription>Employee of the Month, Quarter and Year.</CardDescription></CardHeader>
      <CardContent className="grid gap-3 pt-0">
        {awards.data && !awards.data.length && <p className="m-0 text-sm text-muted-foreground">No awards yet.</p>}
        {awards.data?.map((award) => (
          <article key={award.id} aria-label={`${award.award_label} ${award.period}`} className="grid gap-1 rounded-lg border border-border p-3 text-sm">
            <span className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-muted-foreground"><Award className="size-4" /> {award.award_label} · {award.period}{award.scope !== "Overall" ? ` · ${award.scope}` : ""}</span>
            <strong className="text-base">{award.name} <span className="font-normal text-muted-foreground">· {award.section || "Cross-section"}</span></strong>
            <span>{award.citation}</span>
            {award.prize && <span className="text-muted-foreground">Prize: {award.prize}</span>}
          </article>
        ))}
      </CardContent>
    </Card>
  );
}

function PeopleTable({ manage }: { manage: boolean }) {
  const queryClient = useQueryClient();
  const [type, setType] = useState<PeriodType>("YEAR");
  const period = currentKey(type);
  const table = useQuery({
    queryKey: ["points", "people", type, period.key],
    queryFn: () => api<{ rows: PersonRow[]; period_label: string }>(`/api/v1/points/people?period_type=${type}&period=${encodeURIComponent(period.key)}`),
  });
  const [redeeming, setRedeeming] = useState<string | null>(null);
  const [redeem, setRedeem] = useState({ points: "", option: "CASH", value_text: "" });
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function submit(userId: string) {
    setError("");
    try {
      await api("/api/v1/points/redemptions", { method: "POST", body: JSON.stringify({ user_id: userId, points: Number(redeem.points), option: redeem.option, value_text: redeem.value_text }) });
      setMessage("Redemption recorded; the person has been emailed.");
      setRedeeming(null);
      setRedeem({ points: "", option: "CASH", value_text: "" });
      await queryClient.invalidateQueries({ queryKey: ["points"] });
    } catch (reason) {
      setError(errorMessage(reason, "Not recorded."));
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Points by person · {period.label}</CardTitle>
        <CardDescription>Points for verified contributions only. Response times and number of reports are not part of this.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3 pt-0">
        <ChoiceButtons label="Period" options={PERIOD_TYPES} value={type} onChange={setType} />
        {message && <Alert variant="success">{message}</Alert>}
        {error && <Alert variant="destructive">{error}</Alert>}
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Person</TableHead><TableHead className="text-right">This period</TableHead><TableHead>For</TableHead>
              <TableHead className="text-right">Balance</TableHead>{manage && <TableHead />}
            </TableRow>
          </TableHeader>
          <TableBody>
            {table.data?.rows.map((row) => (
              <TableRow key={row.user_id}>
                <TableCell><strong>{row.name}</strong><br /><span className="text-muted-foreground">{row.role} · {row.section}</span></TableCell>
                <TableCell className="text-right font-bold tabular-nums">{row.period_points}</TableCell>
                <TableCell className="text-sm">{Object.entries(row.by_kind).map(([kind, count]) => `${count} × ${kind.toLowerCase()}`).join("; ") || "—"}</TableCell>
                <TableCell className="text-right tabular-nums">{row.balance}<br /><span className="text-xs text-muted-foreground">{row.redeemed} redeemed</span></TableCell>
                {manage && (
                  <TableCell>
                    {redeeming === row.user_id ? (
                      <div className="grid gap-2" role="group" aria-label={`Redeem points for ${row.name}`}>
                        <Input aria-label="Points" type="number" min={1} max={row.balance} value={redeem.points} onChange={(event) => setRedeem({ ...redeem, points: event.target.value })} />
                        <NativeSelect aria-label="As" value={redeem.option} onChange={(event) => setRedeem({ ...redeem, option: event.target.value })}>
                          <option value="CASH">Cash</option><option value="VOUCHER">Voucher</option><option value="DAY_OFF">Day off</option><option value="OTHER">Other</option>
                        </NativeSelect>
                        <Input aria-label="Value" placeholder="e.g. KES 2,000" value={redeem.value_text} onChange={(event) => setRedeem({ ...redeem, value_text: event.target.value })} />
                        <div className="flex gap-2">
                          <Button size="sm" disabled={!Number(redeem.points)} onClick={() => void submit(row.user_id)}>Record</Button>
                          <Button size="sm" variant="ghost" onClick={() => setRedeeming(null)}>Cancel</Button>
                        </div>
                      </div>
                    ) : (
                      <Button size="sm" variant="outline" disabled={row.balance <= 0} onClick={() => setRedeeming(row.user_id)}>Redeem…</Button>
                    )}
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function AwardDesk({ manage }: { manage: boolean }) {
  const queryClient = useQueryClient();
  const [type, setType] = useState<PeriodType>("MONTH");
  const [period, setPeriod] = useState("");
  const [scope, setScope] = useState("Overall");
  const current = currentKey(type);
  const chosen = period || current.key;
  const list = useQuery({
    queryKey: ["awards", "shortlist", type, chosen, scope],
    queryFn: () => api<Shortlist>(`/api/v1/awards/shortlist?award_type=${type}&period=${encodeURIComponent(chosen)}&scope=${encodeURIComponent(scope)}`),
  });
  const [form, setForm] = useState({ user_id: "", citation: "", prize: "" });
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function give() {
    setError("");
    try {
      await api("/api/v1/awards", { method: "POST", body: JSON.stringify({ award_type: type, period: chosen, scope, ...form }) });
      setMessage("Award recorded; the winner has been emailed.");
      setForm({ user_id: "", citation: "", prize: "" });
      await queryClient.invalidateQueries({ queryKey: ["awards"] });
    } catch (reason) {
      setError(errorMessage(reason, "Not recorded."));
    }
  }

  const data = list.data;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Award shortlist</CardTitle>
        <CardDescription>The five people with the most points in the period, with what they did. The panel decides; this only proposes.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3 pt-0">
        <div className="flex flex-wrap items-end gap-3">
          <ChoiceButtons label="Award" options={PERIOD_TYPES.map((item) => ({ ...item, label: `Employee of the ${item.label === "Financial year" ? "Year" : item.label}` }))}
            value={type} onChange={(value) => { setType(value); setPeriod(""); }} />
          <NativeSelect aria-label="Award period" className="w-auto" value={chosen} onChange={(event) => setPeriod(event.target.value)}>
            <option value={current.key}>{current.label}</option>
            {data?.periods.filter((item) => item.key !== current.key).map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}
          </NativeSelect>
          <NativeSelect aria-label="Award scope" className="w-auto" value={scope} onChange={(event) => setScope(event.target.value)}>
            {(data?.scopes ?? ["Overall"]).map((item) => <option key={item}>{item}</option>)}
          </NativeSelect>
        </div>
        {data?.awarded && <Alert variant="success">Already awarded to {data.awarded.name}: {data.awarded.citation}</Alert>}
        {data && !data.shortlist.length && <p className="m-0 text-sm text-muted-foreground">Nobody earned points in this period yet.</p>}
        {data?.shortlist.map((row, index) => (
          <label key={row.user_id} className="flex items-start gap-3 rounded-lg border border-border p-3 text-sm">
            {manage && !data.awarded && <input type="radio" name="winner" className="mt-1 size-4" checked={form.user_id === row.user_id} onChange={() => setForm({ ...form, user_id: row.user_id })} />}
            <span>
              <strong>{index + 1}. {row.name}</strong> <span className="text-muted-foreground">· {row.section} · {row.points} points</span><br />{row.evidence}
            </span>
          </label>
        ))}
        {manage && data && !data.awarded && data.shortlist.length > 0 && (
          <div className="grid gap-2">
            <Field label="Citation (what they did)"><Textarea value={form.citation} onChange={(event) => setForm({ ...form, citation: event.target.value })} /></Field>
            <Field label="Prize"><Input value={form.prize} placeholder="e.g. Certificate and KES 10,000 voucher" onChange={(event) => setForm({ ...form, prize: event.target.value })} /></Field>
            {message && <Alert variant="success">{message}</Alert>}
            {error && <Alert variant="destructive">{error}</Alert>}
            <Button className="justify-self-start" disabled={!form.user_id || form.citation.trim().length < 10} onClick={() => void give()}>Record award</Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function RulesEditor() {
  const queryClient = useQueryClient();
  const rules = useQuery({ queryKey: ["points", "rules"], queryFn: () => api<{ rules: Rule[]; monthly_cap: number; point_value: string }>("/api/v1/points/rules") });
  const [edits, setEdits] = useState<Record<string, number>>({});
  const [cap, setCap] = useState<string>("");
  const [value, setValue] = useState<string>("");
  const [message, setMessage] = useState("");
  async function save() {
    await api("/api/v1/points/rules", {
      method: "PUT",
      body: JSON.stringify({
        rules: Object.entries(edits).map(([kind, points]) => ({ kind, points, active: true })),
        ...(cap ? { monthly_cap: Number(cap) } : {}), ...(value ? { point_value: value } : {}),
      }),
    });
    setMessage("Saved. New values apply to points earned from now on.");
    setEdits({});
    await queryClient.invalidateQueries({ queryKey: ["points"] });
  }
  return (
    <details className="rounded-lg border border-border bg-card">
      <summary className="cursor-pointer px-5 py-4 font-bold">Point values and monthly limit</summary>
      <div className="grid gap-2 px-5 pb-5 text-sm">
        {rules.data?.rules.map((rule) => (
          <label key={rule.kind} className="flex items-center justify-between gap-3">
            <span>{rule.label}</span>
            <Input type="number" min={0} className="w-24" aria-label={`Points for ${rule.label}`} value={edits[rule.kind] ?? rule.points}
              onChange={(event) => setEdits({ ...edits, [rule.kind]: Number(event.target.value) })} />
          </label>
        ))}
        <label className="flex items-center justify-between gap-3"><span>Most points one person can earn in a month</span>
          <Input type="number" min={0} className="w-24" value={cap || rules.data?.monthly_cap || ""} onChange={(event) => setCap(event.target.value)} /></label>
        <Field label="What a point is worth (shown to staff)"><Input value={value || rules.data?.point_value || ""} onChange={(event) => setValue(event.target.value)} /></Field>
        {message && <Alert variant="success">{message}</Alert>}
        <Button className="justify-self-start" onClick={() => void save()}>Save</Button>
      </div>
    </details>
  );
}

/** Points earned for sharing knowledge, what they are worth, and the awards. */
export function Recognition({ user }: { user: User }) {
  const viewAll = can(user, "points.view_all");
  const manage = can(user, "points.manage");
  return (
    <Page>
      <PageHeader eyebrow={`${user.access.level} · Recognition`} title={viewAll ? "Recognition" : "My points & awards"}
        description="Points come from knowledge others can use: approved procedures, colleagues fixing things with your know-how, expert sessions, drawing differences and answers." />
      <div className="grid gap-4">
        {manage && <RulesEditor />}
        {viewAll && <PeopleTable manage={manage} />}
        {viewAll && <AwardDesk manage={manage} />}
        {user.role !== "hr_officer" && <MyPoints />}
        <AwardsWall />
      </div>
    </Page>
  );
}
