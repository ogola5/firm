import { ArrowDownRight, ArrowUpRight, Info, Minus } from "lucide-react";
import { cn } from "../../lib/utils";

/** Value with its unit, as everywhere in analytics (no chart library needed). */
export function formatValue(value: number, unit: string): string {
  if (unit === "%") return `${value}%`;
  if (unit === "faults") return `${Math.round(value)}`;
  if (unit === "attempts") return `${value}`;
  return `${value} ${unit}`;
}

export type SummaryMeasure = {
  key: string; label: string; unit: string; better: "lower" | "higher" | null; definition: string;
  value: number | null; n: number; previous: number | null; previous_n: number; change: number | null; verdict: string;
};

function changeWords(measure: SummaryMeasure, rangeWords: string, minN: number): { text: string; tone: "better" | "worse" | "neutral" } {
  if (measure.verdict === "no_data") return { text: "No data to compare", tone: "neutral" };
  if (measure.verdict === "too_few") return { text: `Too few faults to compare (fewer than ${minN})`, tone: "neutral" };
  const size = Math.abs(measure.change ?? 0);
  const amount = measure.unit === "%" ? `${size} percentage points` : formatValue(Number(size.toFixed(2)), measure.unit);
  if (measure.verdict === "same") return { text: `Same as the ${rangeWords}`, tone: "neutral" };
  const direction = (measure.change ?? 0) < 0 ? "lower" : "higher";
  if (measure.verdict === "context") return { text: `${amount} ${direction} than the ${rangeWords}`, tone: "neutral" };
  return { text: `${amount} ${direction} than the ${rangeWords}: ${measure.verdict}`, tone: measure.verdict as "better" | "worse" };
}

/** One headline figure: value, how many faults are behind it, and the comparison in words. */
export function SummaryTile({ measure, rangeWords, minN }: { measure: SummaryMeasure; rangeWords: string; minN: number }) {
  const change = changeWords(measure, rangeWords, minN);
  const Icon = change.tone === "neutral" ? Minus : (measure.change ?? 0) < 0 ? ArrowDownRight : ArrowUpRight;
  return (
    <div className="grid content-start gap-1 rounded-lg border border-border bg-card p-4">
      <span className="flex items-center gap-1 text-xs text-muted-foreground" title={measure.definition}>
        {measure.label} <Info className="size-3" aria-hidden />
      </span>
      <strong className="text-2xl leading-tight">{measure.value == null ? "—" : formatValue(measure.value, measure.unit)}</strong>
      <span className="text-xs text-muted-foreground">{measure.n} fault(s) behind this figure</span>
      <span className={cn("flex items-start gap-1 text-xs font-semibold",
        change.tone === "better" && "text-success", change.tone === "worse" && "text-destructive", change.tone === "neutral" && "text-muted-foreground")}>
        <Icon className="mt-px size-3.5 shrink-0" aria-hidden />{change.text}
      </span>
    </div>
  );
}
