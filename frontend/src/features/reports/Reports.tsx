import { useMutation, useQuery } from "@tanstack/react-query";
import { Mail, Printer } from "lucide-react";
import { useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { can, type User } from "../../auth";
import { TrendLine } from "../../components/charts/TrendLine";
import { Alert } from "../../components/ui/alert";
import { Button } from "../../components/ui/button";
import { ChoiceButtons, type Choice } from "../../components/ui/choice";
import { NativeSelect } from "../../components/ui/form-controls";
import { Page } from "../../components/ui/page";
import { spokenTime } from "../../lib/format";
import { errorMessage } from "../../lib/query";
import { api } from "../../offline/api";
import { formatValue, SummaryTile, type SummaryMeasure } from "../analytics/SummaryTile";

type Kind = "week" | "month" | "year";
const KINDS: Array<Choice<Kind>> = [
  { value: "week", label: "Weekly" },
  { value: "month", label: "Monthly" },
  { value: "year", label: "Financial year", hint: "July to June" },
];
const SECTIONS = ["Systems Automation", "Electrical", "Instrumentation", "Mechanical"];
// The report is laid out as an A4 sheet on screen too (760 px card, 32 px padding): charts fit both.
const REPORT_CHART_WIDTH = 690;

type Cell = { value: number | null; n: number };
type Report = {
  kind: Kind; title: string; key: string; label: string; partial: boolean; scope: string; section: string | null;
  version: "full" | "headline"; generated_at: string; data_type: string; link: string; min_n_to_compare: number;
  period: { from: string; to: string; days: number };
  previous_period: { from: string; to: string; label: string };
  headline: SummaryMeasure[];
  trend: { buckets: Array<{ label: string; partial: boolean; days: number; full_days: number }>; measures: Array<{ key: string; label: string; unit: string }>; series: Record<string, Cell[]> };
  sections?: Array<{ section: string; faults: number; open_now: number } & Record<string, Cell | number | string>>;
  attention?: Array<{ equipment_id: string; equipment_tag: string; equipment_name: string; section: string; reasons: string[]; common_cause: string | null }>;
  open_faults?: { count: number; oldest: Array<{ reference: string; equipment: string; section: string; symptom: string; status: string; days_open: number }> };
  procedures_published?: number;
  data_quality?: Array<{ key: string; label: string; count: number | null; total: number; median_hours?: number; why: string }>;
};

const day = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

function cell(value: Cell | undefined, unit: string) {
  if (!value || value.value == null) return "—";
  return `${formatValue(value.value, unit)} (n=${value.n})`;
}

function Section({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <section className="mt-6">
      <h3 className="mb-1 break-after-avoid text-base">{title}</h3>
      {note && <p className="mb-2 mt-0 text-xs text-muted-foreground">{note}</p>}
      {children}
    </section>
  );
}

const th = "border-b border-border py-1.5 pr-3 text-left text-xs font-semibold text-muted-foreground";
const td = "border-b border-border py-1.5 pr-3 align-top text-sm";

/** The report as a document: what is printed, and what the email links to. */
function ReportDocument({ report }: { report: Report }) {
  const previous = report.previous_period.label.replace(/^the /, "");
  return (
    <article aria-label="Report" className="mx-auto max-w-[760px] overflow-x-auto rounded-xl border border-border bg-card p-8 print:max-w-none print:overflow-visible print:border-0 print:p-0">
      <header className="border-b-2 border-foreground pb-3">
        <p className="m-0 text-2xs font-extrabold uppercase tracking-[0.12em] text-muted-foreground">KPC Maintenance · {report.scope}</p>
        <h2 className="mb-1 mt-1">{report.title}</h2>
        <p className="m-0 text-sm">
          {day(report.period.from)} – {day(report.period.to)} · compared with {report.previous_period.label} ({day(report.previous_period.from)} – {day(report.previous_period.to)})
        </p>
        <p className="m-0 text-xs text-muted-foreground">Prepared {spokenTime(report.generated_at)} · {report.data_type}</p>
      </header>
      {report.partial && <Alert variant="warning" className="mt-4">This period has not ended: figures are to date and will change.</Alert>}

      <Section title="Headline" note="Medians for times. Every figure says how many faults it comes from; fewer than 5 is too few to compare.">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 print:grid-cols-4">
          {report.headline.map((measure) => <SummaryTile key={measure.key} measure={measure} rangeWords={previous} minN={report.min_n_to_compare} />)}
        </div>
      </Section>

      <Section title="Trend" note={report.kind === "week" ? "The 8 weeks up to this one." : report.kind === "month" ? "The 12 months up to this one." : "Each month of the financial year."}>
        {/* Fixed-width charts: the same drawing on screen and on A4 (nothing re-measures while printing). */}
        <div className="grid gap-4">
          {report.trend.measures.map((measure) => (
            <figure key={measure.key} className="m-0 break-inside-avoid">
              <figcaption className="text-sm font-semibold">{measure.label}{measure.unit !== "faults" ? ` (${measure.unit})` : ""}</figcaption>
              <TrendLine title={measure.label} unit={measure.unit} width={REPORT_CHART_WIDTH}
                points={report.trend.buckets.map((bucket, index) => ({ ...bucket, ...report.trend.series[measure.key][index] }))} />
            </figure>
          ))}
        </div>
      </Section>

      {report.version === "headline" && (
        <p className="mt-6 text-sm text-muted-foreground">Executive version: headline figures and trends only. Section and equipment detail is in the managers' reports.</p>
      )}

      {report.sections && report.sections.length > 0 && (
        <Section title="Sections" note="Sections look after different equipment: compare each with its own trend first.">
          <table className="w-full border-collapse">
            <thead><tr>{["Section", "Faults", "First response", "Restore", "First-time fix", "Repeats", "Open now"].map((h) => <th key={h} className={th}>{h}</th>)}</tr></thead>
            <tbody>
              {report.sections.map((row) => (
                <tr key={row.section}>
                  <td className={`${td} font-semibold`}>{row.section}</td>
                  <td className={td}>{row.faults}</td>
                  <td className={td}>{cell(row.first_response_min as Cell, "min")}</td>
                  <td className={td}>{cell(row.restore_h as Cell, "h")}</td>
                  <td className={td}>{cell(row.first_time_fix_pct as Cell, "%")}</td>
                  <td className={td}>{cell(row.repeat_pct as Cell, "%")}</td>
                  <td className={td}>{row.open_now}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
      )}

      {report.attention && (
        <Section title="Equipment needing attention" note="Ranked by faults, repeats within 90 days and faults that came back after a fix.">
          {report.attention.length === 0 ? <p className="m-0 text-sm text-muted-foreground">Nothing stands out in this period.</p> : (
            <table className="w-full border-collapse">
              <thead><tr><th className={th}>Equipment</th><th className={th}>Why it is listed</th><th className={th}>Most common cause</th></tr></thead>
              <tbody>
                {report.attention.map((row) => (
                  <tr key={row.equipment_id}>
                    <td className={td}><strong>{row.equipment_tag}</strong><br /><span className="text-muted-foreground">{row.equipment_name} · {row.section}</span></td>
                    <td className={td}>{row.reasons.join(" · ")}</td>
                    <td className={td}>{row.common_cause ?? "Not recorded"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Section>
      )}

      {report.open_faults && (
        <Section title={`Still open at the end of the period: ${report.open_faults.count}`} note="The longest-open first.">
          {report.open_faults.oldest.length > 0 && (
            <table className="w-full border-collapse">
              <thead><tr>{["Reference", "Equipment", "Problem", "Section", "Status", "Days open"].map((h) => <th key={h} className={th}>{h}</th>)}</tr></thead>
              <tbody>
                {report.open_faults.oldest.map((row) => (
                  <tr key={row.reference}>
                    <td className={`${td} whitespace-nowrap`}>{row.reference}</td><td className={td}>{row.equipment}</td><td className={td}>{row.symptom}</td>
                    <td className={td}>{row.section}</td><td className={td}>{row.status.replace(/_/g, " ").toLowerCase()}</td><td className={td}>{row.days_open}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Section>
      )}

      {report.procedures_published != null && (
        <Section title="Knowledge">
          <p className="m-0 text-sm">Procedures published in the period: <strong>{report.procedures_published}</strong></p>
        </Section>
      )}

      {report.data_quality && (
        <Section title="How complete are the records?" note="Gaps here make the figures above less reliable.">
          <ul className="m-0 grid gap-1 p-0">
            {report.data_quality.map((check) => (
              <li key={check.key} className="list-none text-sm">
                <strong>{check.label}:</strong> {check.median_hours != null ? `${check.median_hours} h (n=${check.total})` : `${check.count} of ${check.total}`}
                <span className="text-muted-foreground"> — {check.why}</span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      <footer className="mt-8 border-t border-border pt-3 text-xs text-muted-foreground">
        Definitions: METRICS.md. Periods are cut at midnight Kenya time; weeks start Monday; the financial year runs July to June.
        <span className="hidden print:inline"> Online: {report.link}</span>
      </footer>
    </article>
  );
}

/** Weekly, monthly and financial-year reports: choose, read, print, or email to yourself. */
export function Reports({ user }: { user: User }) {
  const [params, setParams] = useSearchParams();
  const kind = (["week", "month", "year"].includes(params.get("kind") ?? "") ? params.get("kind") : "week") as Kind;
  const section = params.get("section") ?? "";
  const orgWide = can(user, "analytics.org");

  const periods = useQuery({
    queryKey: ["reports", "periods", kind],
    queryFn: () => api<{ periods: Array<{ key: string; label: string; partial: boolean }>; default: string }>(`/api/v1/reports/periods?kind=${kind}`),
  });
  const period = params.get("period") ?? periods.data?.default ?? "";
  const query = new URLSearchParams({ ...(period ? { period } : {}), ...(section ? { section } : {}) }).toString();
  const report = useQuery({
    queryKey: ["reports", kind, period, section],
    enabled: Boolean(period),
    queryFn: () => api<Report>(`/api/v1/reports/${kind}?${query}`),
  });
  const email = useMutation({ mutationFn: () => api<{ message: string }>(`/api/v1/reports/${kind}/email?${query}`, { method: "POST" }) });

  function choose(next: Record<string, string>) {
    const merged = { kind, ...(period ? { period } : {}), ...(section ? { section } : {}), ...next };
    setParams(Object.fromEntries(Object.entries(merged).filter(([, value]) => value)));
    email.reset();
  }

  useEffect(() => {
    if (report.data) document.title = `${report.data.title} — ${report.data.scope}`;
    return () => { document.title = "KPC Maintenance"; };
  }, [report.data]);

  return (
    <Page>
      <div className="mb-5 grid gap-3 print:hidden">
        <div>
          <p className="m-0 text-2xs font-extrabold uppercase tracking-[0.12em] text-muted-foreground">{user.access.level} · {user.access.scope}</p>
          <h1 className="mb-0 mt-1 text-2xl">Reports</h1>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <ChoiceButtons label="Report" options={KINDS} value={kind} onChange={(value) => choose({ kind: value, period: "" })} />
          <NativeSelect aria-label="Period" className="w-auto" value={period} onChange={(event) => choose({ period: event.target.value })}>
            {periods.data?.periods.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}
          </NativeSelect>
          {orgWide && (
            <NativeSelect aria-label="Section" className="w-auto" value={section} onChange={(event) => choose({ section: event.target.value })}>
              <option value="">All sections</option>
              {SECTIONS.map((item) => <option key={item}>{item}</option>)}
            </NativeSelect>
          )}
          <Button variant="outline" disabled={!report.data} onClick={() => window.print()}><Printer /> Print</Button>
          <Button variant="outline" disabled={!report.data || email.isPending} onClick={() => email.mutate()}><Mail /> Email it to me</Button>
        </div>
        {email.isSuccess && <Alert variant="success">{email.data.message} (Demonstration: see the demo mailbox.)</Alert>}
        {email.isError && <Alert variant="destructive">{errorMessage(email.error, "Not sent.")}</Alert>}
        <p className="m-0 text-xs text-muted-foreground">Reports are also emailed automatically: weekly on Monday, monthly on the 1st, the financial year on 1 July (07:00). Choose which in My account.</p>
      </div>
      {report.isError && <Alert variant="destructive">{errorMessage(report.error, "This report could not be prepared.")}</Alert>}
      {report.isLoading && <p className="text-sm text-muted-foreground" role="status">Preparing the report…</p>}
      {report.data && <ReportDocument report={report.data} />}
    </Page>
  );
}
