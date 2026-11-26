import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { can, type User } from "../../auth";
import { TrendLine } from "../../components/charts/TrendLine";
import { Alert } from "../../components/ui/alert";
import { Badge } from "../../components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../components/ui/card";
import { ChoiceButtons, type Choice } from "../../components/ui/choice";
import { NativeSelect } from "../../components/ui/form-controls";
import { Page, PageHeader } from "../../components/ui/page";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../../components/ui/table";
import { errorMessage } from "../../lib/query";
import { api } from "../../offline/api";
import { formatValue, SummaryTile, type SummaryMeasure } from "./SummaryTile";

const SECTIONS = ["Systems Automation", "Electrical", "Mechanical"];

type Range = "4w" | "12w" | "12m";
const RANGES: Array<Choice<Range> & { days: number; granularity: "week" | "month"; words: string }> = [
  { value: "4w", label: "Last 4 weeks", days: 28, granularity: "week", words: "previous 4 weeks" },
  { value: "12w", label: "Last 12 weeks", days: 84, granularity: "week", words: "previous 12 weeks" },
  { value: "12m", label: "Last 12 months", days: 365, granularity: "month", words: "previous 12 months" },
];
const TREND_KEYS = ["faults_reported", "first_response_min", "restore_h", "first_time_fix_pct", "repeat_pct", "came_back_pct"];

type MeasureInfo = { key: string; label: string; unit: string; better: "lower" | "higher" | null; definition: string };
type Summary = { measures: SummaryMeasure[]; scope: string; min_n_to_compare: number };
type Trends = { buckets: Array<{ label: string; partial: boolean; days: number; full_days: number }>; measures: MeasureInfo[]; series: Record<string, Array<{ value: number | null; n: number }>> };
type Attention = { equipment: Array<Record<string, unknown> & { reasons: string[] }>; ranking: string };
type SectionRow = { section: string; faults: number; open_now: number } & Record<string, { value: number | null; n: number } | number | string>;
type QualityCheck = { key: string; label: string; count: number | null; total: number; percent: number | null; median_hours?: number; why: string };

function isoDay(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function cell(value: { value: number | null; n: number } | undefined, unit: string) {
  if (!value || value.value == null) return <span className="text-muted-foreground">—</span>;
  return <>{formatValue(value.value, unit)} <span className="text-xs text-muted-foreground">(n={value.n})</span></>;
}

/** Trends, comparisons and intelligence, all from the definitions in METRICS.md. */
export function Analytics({ user }: { user: User }) {
  const [range, setRange] = useState<Range>("12w");
  const [section, setSection] = useState("");
  const orgWide = can(user, "analytics.org");
  const detail = orgWide || can(user, "analytics.section");
  const chosen = RANGES.find((item) => item.value === range)!;
  const end = new Date();
  const start = new Date(end);
  start.setDate(start.getDate() - chosen.days + 1);
  const params = new URLSearchParams({ start: isoDay(start), end: isoDay(end), ...(section ? { section } : {}) });
  const key = [range, section];

  const summary = useQuery({ queryKey: ["analytics", "summary", ...key], queryFn: () => api<Summary>(`/api/v1/analytics/summary?${params}`) });
  const trends = useQuery({
    queryKey: ["analytics", "trends", ...key],
    queryFn: () => {
      const query = new URLSearchParams(params);
      query.set("granularity", chosen.granularity);
      TREND_KEYS.forEach((measure) => query.append("measure", measure));
      return api<Trends>(`/api/v1/analytics/trends?${query}`);
    },
  });
  const attention = useQuery({ queryKey: ["analytics", "attention", ...key], enabled: detail, queryFn: () => api<Attention>(`/api/v1/analytics/equipment-attention?${params}`) });
  const sections = useQuery({ queryKey: ["analytics", "sections", range], enabled: detail, queryFn: () => api<{ sections: SectionRow[]; note: string }>(`/api/v1/analytics/sections?start=${params.get("start")}&end=${params.get("end")}`) });
  const quality = useQuery({ queryKey: ["analytics", "quality", ...key], enabled: detail, queryFn: () => api<{ checks: QualityCheck[] }>(`/api/v1/analytics/data-quality?${params}`) });

  return (
    <Page>
      <PageHeader
        eyebrow="Illustrative demonstration data"
        title="Analytics"
        description={`${summary.data?.scope ?? (orgWide ? "All sections" : `${user.section} section`)} · how the work is going, compared with the period before. Every figure shows how many faults are behind it.`}
      />
      <div className="mb-5 flex flex-wrap items-center gap-4">
        <ChoiceButtons label="Period" options={RANGES} value={range} onChange={setRange} />
        {orgWide && (
          <NativeSelect aria-label="Section" className="w-auto" value={section} onChange={(event) => setSection(event.target.value)}>
            <option value="">All sections</option>
            {SECTIONS.map((item) => <option key={item} value={item}>{item}</option>)}
          </NativeSelect>
        )}
      </div>

      {summary.isError && <Alert variant="destructive" className="mb-4">{errorMessage(summary.error, "Analytics are not available for this role.")}</Alert>}
      {summary.data && (
        <section aria-label="Headline measures" className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
          {summary.data.measures.map((measure) => (
            <SummaryTile key={measure.key} measure={measure} rangeWords={chosen.words} minN={summary.data.min_n_to_compare} />
          ))}
        </section>
      )}

      {trends.data && (
        <section aria-label="Trends" className="mb-6 grid gap-4 lg:grid-cols-2">
          {trends.data.measures.map((measure) => (
            <Card key={measure.key}>
              <CardHeader className="pb-1">
                <CardTitle className="text-base">{measure.label}{measure.unit !== "faults" && measure.unit !== "attempts" ? ` (${measure.unit})` : ""}</CardTitle>
                <CardDescription className="text-xs">
                  {measure.definition}{measure.better ? ` ${measure.better === "lower" ? "Lower" : "Higher"} is better.` : ""}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <TrendLine
                  title={measure.label}
                  unit={measure.unit}
                  points={trends.data.buckets.map((bucket, index) => ({ ...bucket, ...trends.data.series[measure.key][index] }))}
                />
              </CardContent>
            </Card>
          ))}
        </section>
      )}

      {detail && (
        <div className="grid gap-4">
          <Card>
            <CardHeader>
              <CardTitle>Equipment needing attention</CardTitle>
              <CardDescription>{attention.data?.ranking ?? "Ranked by faults, repeats and faults that came back after a fix."}</CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              {attention.data && !attention.data.equipment.length && <p className="px-5 pb-5 text-sm text-muted-foreground">No faults on identified equipment in this period.</p>}
              {attention.data && attention.data.equipment.length > 0 && (
                <Table>
                  <TableHeader><TableRow><TableHead>Equipment</TableHead><TableHead>Why it is listed</TableHead><TableHead>Most common cause</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {attention.data.equipment.map((row) => (
                      <TableRow key={String(row.equipment_id)}>
                        <TableCell><strong>{String(row.equipment_tag)}</strong><br /><span className="text-muted-foreground">{String(row.equipment_name)} · {String(row.section)}</span></TableCell>
                        <TableCell>{row.reasons.join(" · ")}</TableCell>
                        <TableCell>{row.common_cause ? String(row.common_cause) : <span className="text-muted-foreground">Not recorded</span>}</TableCell>                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          <div className="grid gap-4 xl:grid-cols-[1.4fr_1fr]">
            <Card>
              <CardHeader>
                <CardTitle>Sections</CardTitle>
                <CardDescription>{sections.data?.note}</CardDescription>
              </CardHeader>
              <CardContent className="p-0">
                {sections.data && (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Section</TableHead><TableHead className="text-right">Faults</TableHead><TableHead className="text-right">First response</TableHead>
                        <TableHead className="text-right">Restore</TableHead><TableHead className="text-right">First-time fix</TableHead><TableHead className="text-right">Repeats</TableHead>
                        <TableHead className="text-right">Open now</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {sections.data.sections.map((row) => (
                        <TableRow key={row.section}>
                          <TableCell className="font-bold">{row.section}</TableCell>
                          <TableCell className="text-right tabular-nums">{row.faults}</TableCell>
                          <TableCell className="text-right tabular-nums">{cell(row.first_response_min as { value: number | null; n: number }, "min")}</TableCell>
                          <TableCell className="text-right tabular-nums">{cell(row.restore_h as { value: number | null; n: number }, "h")}</TableCell>
                          <TableCell className="text-right tabular-nums">{cell(row.first_time_fix_pct as { value: number | null; n: number }, "%")}</TableCell>
                          <TableCell className="text-right tabular-nums">{cell(row.repeat_pct as { value: number | null; n: number }, "%")}</TableCell>
                          <TableCell className="text-right tabular-nums">{row.open_now}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>How complete are the records?</CardTitle>
                <CardDescription>Gaps here make the figures above less reliable.</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-0">
                {quality.data?.checks.map((check) => (
                  <div key={check.key} className="grid gap-0.5 border-b border-border py-2.5 text-sm last:border-0">
                    <div className="flex items-start justify-between gap-3">
                      <span className="font-semibold">{check.label}</span>
                      {check.median_hours != null
                        ? <Badge variant="outline" className="normal-case">{check.median_hours} h (n={check.total})</Badge>
                        : <Badge variant={check.count ? "warning" : "success"} className="normal-case">{check.count} of {check.total}</Badge>}
                    </div>
                    <span className="text-muted-foreground">{check.why}</span>
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>
        </div>
      )}
      <p className="mt-6 text-xs text-muted-foreground">
        Definitions: METRICS.md. Periods are cut at midnight Kenya time; weeks start on Monday. Illustrative data: these figures demonstrate the method, not KPC performance.
      </p>
    </Page>
  );
}
