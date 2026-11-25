import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatValue } from "../../features/analytics/SummaryTile";

/** One measure over time. Single series, so no legend: the title names it. */
const LINE = "#2c6688"; // 6.24:1 on the white card
const GRID = "#e3eaee";
const AXIS_TEXT = "#587083";

export type TrendPoint = { label: string; value: number | null; n: number; partial?: boolean; days?: number; full_days?: number };

function coverage(point: TrendPoint): string {
  return point.partial ? ` (${point.days} of ${point.full_days} days)` : "";
}

function TooltipBody({ active, payload, unit }: { active?: boolean; payload?: Array<{ payload: TrendPoint }>; unit: string }) {
  if (!active || !payload?.length) return null;
  const point = payload[0].payload;
  return (
    <div className="rounded-md border border-border bg-card px-3 py-2 text-xs shadow-md">
      <div className="font-semibold">{point.label}{coverage(point)}</div>
      <div>{point.value == null ? "No data" : `${formatValue(point.value, unit)}`}</div>
      <div className="text-muted-foreground">{point.n} fault(s)</div>
    </div>
  );
}

export { formatValue };

/**
 * The last point with data gets an end marker (8 px with a 2 px surface ring).
 * A period cut short (part of a week or month) is drawn hollow, so a low count
 * there is not read as a real drop.
 */
function Dot({ cx, cy, index, lastIndex, partial }: { cx?: number; cy?: number; index?: number; lastIndex: number; partial: boolean }) {
  if (cx == null || cy == null) return null;
  if (partial) return <circle cx={cx} cy={cy} r={4} fill="#fff" stroke={LINE} strokeWidth={2} />;
  if (index !== lastIndex) return null;
  return <circle cx={cx} cy={cy} r={4} fill={LINE} stroke="#fff" strokeWidth={2} />;
}

function granularityWord(points: TrendPoint[]): string {
  return (points.find((point) => point.full_days)?.full_days ?? 7) > 7 ? "month" : "week";
}

/**
 * `width` fixes the size (printed reports: the same drawing on screen and on A4);
 * without it the chart fills its container.
 */
export function TrendLine({ title, unit, points, width }: { title: string; unit: string; points: TrendPoint[]; width?: number }) {
  const lastIndex = points.reduce((last, point, index) => (point.value != null ? index : last), -1);
  const total = points.reduce((sum, point) => sum + point.n, 0);
  const chart = (
          <LineChart data={points} margin={{ top: 8, right: 16, bottom: 0, left: 0 }} {...(width ? { width, height: 190 } : {})}>
            <CartesianGrid vertical={false} stroke={GRID} strokeWidth={1} />
            <XAxis dataKey="label" tick={{ fill: AXIS_TEXT, fontSize: 11 }} axisLine={false} tickLine={false} interval="preserveStartEnd" minTickGap={24} />
            <YAxis tick={{ fill: AXIS_TEXT, fontSize: 11 }} axisLine={false} tickLine={false} width={40} allowDecimals={unit !== "faults"} />
            <Tooltip cursor={{ stroke: GRID }} content={<TooltipBody unit={unit} />} />
            <Line
              type="linear"
              dataKey="value"
              stroke={LINE}
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              connectNulls={false}
              isAnimationActive={false}
              dot={(props: { cx?: number; cy?: number; index?: number }) => (
                <Dot key={`dot-${props.index}`} cx={props.cx} cy={props.cy} index={props.index} lastIndex={lastIndex}
                  partial={Boolean(points[props.index ?? -1]?.partial && points[props.index ?? -1]?.value != null)} />
              )}
              activeDot={{ r: 5, fill: LINE, stroke: "#fff", strokeWidth: 2 }}
            />
          </LineChart>
  );
  return (
    <figure className="m-0 break-inside-avoid">
      <div
        role="img"
        aria-label={`${title}: ${points.map((point) => `${point.label} ${point.value == null ? "no data" : formatValue(point.value, unit)}`).join(", ")}`}
      >
        {width ? chart : <ResponsiveContainer width="100%" height={190}>{chart}</ResponsiveContainer>}
      </div>
      {points.some((point) => point.partial) && (
        <p className="m-0 mt-1 text-xs text-muted-foreground">Hollow points cover only part of a {granularityWord(points)}; counts there are not comparable.</p>
      )}
      <details className="mt-1 text-xs text-muted-foreground print:hidden">
        <summary className="cursor-pointer">Show as table ({total} fault(s) in total)</summary>
        <table className="mt-2 w-full text-sm">
          <caption className="sr-only">{title}</caption>
          <thead>
            <tr className="border-b border-border text-left text-xs"><th className="py-1 font-semibold">Period</th><th className="py-1 text-right font-semibold">Value</th><th className="py-1 text-right font-semibold">Faults</th></tr>
          </thead>
          <tbody>
            {points.map((point) => (
              <tr key={point.label} className="border-b border-border last:border-0">
                <td className="py-1">{point.label}{coverage(point)}</td>
                <td className="py-1 text-right font-semibold tabular-nums text-foreground">{point.value == null ? "—" : formatValue(point.value, unit)}</td>
                <td className="py-1 text-right tabular-nums">{point.n}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}
