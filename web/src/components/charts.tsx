import { clsx } from 'clsx';
import type { ReactNode } from 'react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis, type TooltipContentProps } from 'recharts';
import type { NameType, ValueType } from 'recharts/types/component/DefaultTooltipContent';
import { bucketLabel, formatNumber } from '../lib/format';

const MAX_SERIES = 8;

/** Series colours are assigned by a stable entity order (not rank) so filtering never repaints. */
export const seriesColor = (index: number) => (index < MAX_SERIES ? `var(--series-${index + 1})` : 'var(--series-other)');

export interface Series {
  key: string;
  label: string;
  colorIndex: number;
}

export function StatTile({ label, value, hint, icon }: { label: string; value: ReactNode; hint?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="rounded-xl border border-border bg-surface p-5 shadow-xs">
      <div className="flex items-center justify-between text-sm text-muted">
        {label}
        {icon && <span className="text-muted/70">{icon}</span>}
      </div>
      <div className="mt-2 text-3xl font-semibold tracking-tight text-fg tabular-nums">{value}</div>
      {hint && <div className="mt-1 text-xs text-muted">{hint}</div>}
    </div>
  );
}

export function Legend({ series }: { series: Series[] }) {
  if (series.length < 2) return null;
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-muted" aria-label="Legend">
      {series.map((s) => (
        <li key={s.key} className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm" style={{ background: seriesColor(s.colorIndex) }} />
          {s.label}
        </li>
      ))}
    </ul>
  );
}

function ChartTooltip({ active, payload, label, bucket, series }: TooltipContentProps<ValueType, NameType> & { bucket: 'hour' | 'day'; series: Series[] }) {
  if (!active || !payload?.length) return null;
  const rows = series
    .map((s) => ({ s, v: Number(payload.find((p) => p.dataKey === s.key)?.value ?? 0) }))
    .filter((r) => r.v > 0);
  const total = rows.reduce((n, r) => n + r.v, 0);
  return (
    <div className="min-w-44 rounded-lg border border-border bg-surface px-3 py-2 text-xs shadow-lg">
      <div className="mb-1.5 font-medium text-fg">{bucketLabel(String(label), bucket)}</div>
      {rows.length === 0 && <div className="text-muted">No scans</div>}
      {rows.map(({ s, v }) => (
        <div key={s.key} className="flex items-center justify-between gap-4 py-0.5">
          <span className="flex items-center gap-1.5 text-muted">
            <span className="size-2 rounded-sm" style={{ background: seriesColor(s.colorIndex) }} />
            {s.label}
          </span>
          <span className="font-medium text-fg tabular-nums">{formatNumber(v)}</span>
        </div>
      ))}
      {rows.length > 1 && (
        <div className="mt-1 flex justify-between border-t border-border pt-1 font-medium text-fg">
          <span>Total</span>
          <span className="tabular-nums">{formatNumber(total)}</span>
        </div>
      )}
    </div>
  );
}

/** Stacked columns of scans per time bucket, one colour per source. */
export function TimeSeriesChart({
  data,
  series,
  bucket,
  height = 260,
}: {
  data: Array<Record<string, number | string>>;
  series: Series[];
  bucket: 'hour' | 'day';
  height?: number;
}) {
  return (
    <div style={{ height }} role="img" aria-label="Scans over time">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 4, bottom: 0, left: -12 }} barCategoryGap="18%">
          <CartesianGrid vertical={false} stroke="var(--grid)" />
          <XAxis
            dataKey="t"
            tickFormatter={(t: string) => bucketLabel(t, bucket)}
            tick={{ fill: 'var(--muted)', fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            minTickGap={24}
          />
          <YAxis allowDecimals={false} tick={{ fill: 'var(--muted)', fontSize: 11 }} axisLine={false} tickLine={false} width={44} />
          <Tooltip cursor={{ fill: 'var(--surface-2)' }} content={(p) => <ChartTooltip {...p} bucket={bucket} series={series} />} />
          {series.map((s, i) => (
            <Bar
              key={s.key}
              dataKey={s.key}
              name={s.label}
              stackId="hits"
              fill={seriesColor(s.colorIndex)}
              stroke="var(--surface)"
              strokeWidth={1}
              radius={i === series.length - 1 ? [4, 4, 0, 0] : 0}
              isAnimationActive={false}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Ranked horizontal bars rendered in HTML: readable labels, values always visible. */
export function BreakdownList({
  items,
  total,
  renderLabel = (k) => k,
  colorFor,
  empty = 'No data yet',
  limit = 8,
}: {
  items: Array<{ key: string; hits: number; uniqueVisitors?: number }>;
  total?: number;
  renderLabel?: (key: string) => ReactNode;
  colorFor?: (key: string) => string;
  empty?: string;
  limit?: number;
}) {
  if (items.length === 0) return <p className="py-6 text-center text-sm text-muted">{empty}</p>;
  const max = Math.max(...items.map((i) => i.hits), 1);
  const sum = total ?? items.reduce((n, i) => n + i.hits, 0);
  return (
    <ul className="space-y-2.5">
      {items.slice(0, limit).map((item) => {
        const pct = sum ? Math.round((item.hits / sum) * 100) : 0;
        return (
          <li key={item.key} className="group" title={`${formatNumber(item.hits)} scans${item.uniqueVisitors !== undefined ? `, ${formatNumber(item.uniqueVisitors)} unique` : ''} (${pct}%)`}>
            <div className="mb-1 flex items-baseline justify-between gap-3 text-sm">
              <span className="min-w-0 truncate text-fg">{renderLabel(item.key)}</span>
              <span className="shrink-0 tabular-nums text-muted">
                <span className="font-medium text-fg">{formatNumber(item.hits)}</span> · {pct}%
              </span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-surface-2">
              <div
                className="h-full rounded-full transition-[width] group-hover:opacity-80"
                style={{ width: `${Math.max(2, (item.hits / max) * 100)}%`, background: colorFor?.(item.key) ?? 'var(--series-1)' }}
              />
            </div>
          </li>
        );
      })}
    </ul>
  );
}

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** Day-of-week by hour-of-day grid; single-hue sequential scale. */
export function Heatmap({ cells }: { cells: Array<{ dow: number; hour: number; hits: number }> }) {
  const grid = new Map(cells.map((c) => [`${c.dow}-${c.hour}`, c.hits]));
  const max = Math.max(...cells.map((c) => c.hits), 1);
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[560px] border-separate border-spacing-[3px] text-[10px] text-muted" aria-label="Scans by day and hour">
        <thead>
          <tr>
            <th />
            {Array.from({ length: 24 }, (_, h) => (
              <th key={h} className="font-normal">
                {h % 3 === 0 ? String(h).padStart(2, '0') : ''}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {DAYS.map((day, d) => (
            <tr key={day}>
              <th className="pr-1 text-right font-normal">{day}</th>
              {Array.from({ length: 24 }, (_, h) => {
                const v = grid.get(`${d + 1}-${h}`) ?? 0;
                const intensity = v === 0 ? 0 : 0.15 + 0.85 * (v / max);
                return (
                  <td
                    key={h}
                    title={`${day} ${String(h).padStart(2, '0')}:00 – ${formatNumber(v)} scans`}
                    className={clsx('h-5 rounded-[4px]', v === 0 && 'bg-surface-2')}
                    style={v ? { background: `color-mix(in oklab, var(--series-1) ${Math.round(intensity * 100)}%, var(--surface))` } : undefined}
                  />
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
