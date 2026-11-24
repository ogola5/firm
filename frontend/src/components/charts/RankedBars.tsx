import { Bar, BarChart, CartesianGrid, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

/** Single-series horizontal bars (magnitude by category). One hue; no legend — the card title names the series. */
const BAR = "#2c6688"; // 6.24:1 on the white card surface
const GRID = "#e3eaee";
const AXIS_TEXT = "#587083";
const VALUE_TEXT = "#163044";

export type RankedDatum = { label: string; value: number | null };

function TooltipBody({ active, payload, format }: {
  active?: boolean;
  payload?: Array<{ payload: RankedDatum }>;
  format: (value: number) => string;
}) {
  if (!active || !payload?.length) return null;
  const datum = payload[0].payload;
  return (
    <div className="rounded-md border border-border bg-card px-3 py-2 text-xs shadow-md">
      <div className="font-semibold">{datum.label}</div>
      <div className="text-muted-foreground">{datum.value == null ? "No data" : format(datum.value)}</div>
    </div>
  );
}

export function RankedBars({
  data, title, format = (value) => value.toLocaleString(), sort = true, labelWidth = 130,
}: {
  data: RankedDatum[];
  /** Used for the accessible name and the table view caption. */
  title: string;
  format?: (value: number) => string;
  /** Largest first; pass false for data with a natural order (e.g. workflow stages). */
  sort?: boolean;
  labelWidth?: number;
}) {
  const rows = sort ? [...data].sort((a, b) => (b.value ?? 0) - (a.value ?? 0)) : data;
  const height = Math.max(120, rows.length * 34 + 28);
  return (
    <figure className="m-0">
      <div role="img" aria-label={`${title}: ${rows.map((row) => `${row.label} ${row.value == null ? "no data" : format(row.value)}`).join(", ")}`}>
        <ResponsiveContainer width="100%" height={height}>
          <BarChart data={rows} layout="vertical" margin={{ top: 4, right: 72, bottom: 4, left: 0 }} barCategoryGap={8}>
            <CartesianGrid horizontal={false} stroke={GRID} strokeWidth={1} />
            <XAxis type="number" tick={{ fill: AXIS_TEXT, fontSize: 11 }} axisLine={false} tickLine={false} allowDecimals={false} />
            <YAxis type="category" dataKey="label" width={labelWidth} tick={{ fill: AXIS_TEXT, fontSize: 12 }} axisLine={false} tickLine={false} />
            <Tooltip cursor={{ fill: "rgba(44,102,136,0.06)" }} content={<TooltipBody format={format} />} />
            <Bar dataKey="value" fill={BAR} maxBarSize={18} radius={[0, 4, 4, 0]} isAnimationActive={false}>
              <LabelList
                dataKey="value"
                position="right"
                fill={VALUE_TEXT}
                fontSize={12}
                fontWeight={700}
                formatter={(value: unknown) => (value == null ? "—" : format(Number(value)))}
              />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <details className="mt-1 text-xs text-muted-foreground">
        <summary className="cursor-pointer">Show as table</summary>
        <table className="mt-2 w-full text-sm">
          <caption className="sr-only">{title}</caption>
          <tbody>
            {rows.map((row) => (
              <tr key={row.label} className="border-b border-border last:border-0">
                <th scope="row" className="py-1 text-left font-normal">{row.label}</th>
                <td className="py-1 text-right font-semibold tabular-nums text-foreground">{row.value == null ? "—" : format(row.value)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}
