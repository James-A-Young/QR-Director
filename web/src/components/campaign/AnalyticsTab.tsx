import { keepPreviousData, useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { clsx } from 'clsx';
import { Bot, Download, MousePointerClick, Smartphone, Users } from 'lucide-react';
import { useMemo, useState } from 'react';
import { api, type StatsParams } from '../../lib/api';
import { countryFlag, countryName, formatDateTime, formatNumber, formatRelative } from '../../lib/format';
import type { CampaignDetail } from '../../lib/types';
import { BreakdownList, Heatmap, Legend, StatTile, TimeSeriesChart, seriesColor, type Series } from '../charts';
import { Button, Card, CardHeader, ErrorNotice, Segmented, Spinner, Switch } from '../ui';

const PERIODS = [
  { value: '1', label: '24h' },
  { value: '7', label: '7d' },
  { value: '30', label: '30d' },
  { value: '90', label: '90d' },
  { value: '365', label: '1y' },
] as const;

const DEVICE_LABELS: Record<string, string> = {
  mobile: 'Mobile',
  tablet: 'Tablet',
  desktop: 'Desktop',
  tv: 'TV',
  wearable: 'Wearable',
  console: 'Console',
  bot: 'Bot',
  other: 'Other',
};

export function AnalyticsTab({ campaign }: { campaign: CampaignDetail }) {
  const [days, setDays] = useState<(typeof PERIODS)[number]['value']>('30');
  const [includeBots, setIncludeBots] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);

  const params: StatsParams = { days: Number(days), includeBots, links: selected.length ? selected.join(',') : undefined };
  const stats = useQuery({
    queryKey: ['stats', campaign.id, params],
    queryFn: () => api.campaignStats(campaign.id, params),
    placeholderData: keepPreviousData,
  });

  // Colour follows the link's position in the campaign, so filtering never repaints a source.
  const allSeries: Series[] = useMemo(
    () => campaign.links.map((l, i) => ({ key: l.id, label: l.sourceLabel, colorIndex: i })),
    [campaign.links],
  );
  const series = selected.length ? allSeries.filter((s) => selected.includes(s.key)) : allSeries;
  const linkById = new Map(campaign.links.map((l) => [l.id, l]));

  const toggleSource = (id: string) => setSelected((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));

  return (
    <div className="space-y-6">
      {/* Filters: one row above the charts. */}
      <div className="flex flex-wrap items-center gap-3">
        <Segmented label="Period" value={days} onChange={setDays} options={PERIODS.map((p) => ({ value: p.value, label: p.label }))} />
        <label className="flex items-center gap-2 text-sm text-muted">
          <Switch label="Include bots" checked={includeBots} onChange={setIncludeBots} />
          Include bots
        </label>
        <div className="ml-auto">
          <a
            href={api.hitsCsvUrl(campaign.id, params)}
            download
            className="inline-flex h-8 items-center gap-2 rounded-lg border border-border-strong bg-surface px-3 text-sm font-medium text-fg shadow-xs hover:bg-surface-2"
          >
            <Download className="size-4" />
            Export CSV
          </a>
        </div>
      </div>
      {campaign.links.length > 1 && (
        <div className="flex flex-wrap gap-2" aria-label="Filter by source">
          {allSeries.map((s) => {
            const on = selected.length === 0 || selected.includes(s.key);
            return (
              <button
                key={s.key}
                type="button"
                aria-pressed={selected.includes(s.key)}
                onClick={() => toggleSource(s.key)}
                className={clsx(
                  'flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition',
                  on ? 'border-border-strong bg-surface text-fg' : 'border-border text-muted opacity-60',
                )}
              >
                <span className="size-2 rounded-sm" style={{ background: seriesColor(s.colorIndex) }} />
                {s.label}
              </button>
            );
          })}
          {selected.length > 0 && (
            <button type="button" className="px-2 text-xs text-accent hover:underline" onClick={() => setSelected([])}>
              Show all
            </button>
          )}
        </div>
      )}

      {stats.isPending ? (
        <Spinner label="Loading analytics" />
      ) : stats.error ? (
        <ErrorNotice error={stats.error} retry={() => stats.refetch()} />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatTile label="Scans" value={formatNumber(stats.data.totals.hits)} icon={<MousePointerClick className="size-4" />} />
            <StatTile label="Unique visitors" value={formatNumber(stats.data.totals.uniqueVisitors)} icon={<Users className="size-4" />} />
            <StatTile
              label="Mobile share"
              icon={<Smartphone className="size-4" />}
              value={`${stats.data.totals.hits ? Math.round(((stats.data.devices.find((d) => d.key === 'mobile')?.hits ?? 0) / stats.data.totals.hits) * 100) : 0}%`}
              hint="Phones are a good proxy for QR scans"
            />
            <StatTile
              label="Bot visits"
              icon={<Bot className="size-4" />}
              value={formatNumber(stats.data.totals.bots)}
              hint={includeBots ? 'Included in figures' : 'Excluded from figures'}
            />
          </div>

          <Card>
            <CardHeader title={`Scans per ${stats.data.range.bucket}`} description="Stacked by source" actions={<Legend series={series} />} />
            <div className="p-5">
              <TimeSeriesChart
                bucket={stats.data.range.bucket}
                series={series}
                data={stats.data.timeseries.map((p) => ({ t: p.t, ...Object.fromEntries(series.map((s) => [s.key, p.byLink[s.key] ?? 0])) }))}
              />
            </div>
          </Card>

          <Card className="overflow-hidden">
            <CardHeader title="By source" description="Compare where people found the campaign" />
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-sm">
                <thead className="bg-surface-2/60 text-left text-xs text-muted">
                  <tr>
                    <th className="px-5 py-2.5 font-medium">Source</th>
                    <th className="px-3 py-2.5 text-right font-medium">Scans</th>
                    <th className="px-3 py-2.5 text-right font-medium">Unique</th>
                    <th className="w-1/4 px-3 py-2.5 font-medium">Share</th>
                    <th className="px-3 py-2.5 font-medium">Top device</th>
                    <th className="px-5 py-2.5 text-right font-medium">Last scan</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {series.map((s) => {
                    const row = stats.data.bySource.find((b) => b.linkId === s.key);
                    const hits = row?.hits ?? 0;
                    const share = stats.data.totals.hits ? hits / stats.data.totals.hits : 0;
                    const topDevice = stats.data.deviceBySource.filter((d) => d.linkId === s.key).sort((a, b) => b.hits - a.hits)[0];
                    return (
                      <tr key={s.key}>
                        <td className="px-5 py-3">
                          <div className="flex items-center gap-2">
                            <span className="size-2.5 shrink-0 rounded-sm" style={{ background: seriesColor(s.colorIndex) }} />
                            <span className="font-medium text-fg">{s.label}</span>
                            <span className="font-mono text-xs text-muted">/{linkById.get(s.key)?.code}</span>
                          </div>
                        </td>
                        <td className="px-3 py-3 text-right font-medium tabular-nums">{formatNumber(hits)}</td>
                        <td className="px-3 py-3 text-right tabular-nums text-muted">{formatNumber(row?.uniqueVisitors ?? 0)}</td>
                        <td className="px-3 py-3">
                          <div className="flex items-center gap-2">
                            <div className="h-2 flex-1 overflow-hidden rounded-full bg-surface-2">
                              <div className="h-full rounded-full" style={{ width: `${share * 100}%`, background: seriesColor(s.colorIndex) }} />
                            </div>
                            <span className="w-9 text-right text-xs tabular-nums text-muted">{Math.round(share * 100)}%</span>
                          </div>
                        </td>
                        <td className="px-3 py-3 text-muted">{topDevice ? DEVICE_LABELS[topDevice.deviceType] ?? topDevice.deviceType : '—'}</td>
                        <td className="px-5 py-3 text-right text-muted">{formatRelative(row?.lastHitAt ?? null)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>

          <div className="grid gap-6 lg:grid-cols-3">
            <Card>
              <CardHeader title="Devices" />
              <div className="p-5">
                <BreakdownList items={stats.data.devices} renderLabel={(k) => DEVICE_LABELS[k] ?? k} />
              </div>
            </Card>
            <Card>
              <CardHeader title="Operating systems" />
              <div className="p-5">
                <BreakdownList items={stats.data.os} />
              </div>
            </Card>
            <Card>
              <CardHeader title="Browsers" />
              <div className="p-5">
                <BreakdownList items={stats.data.browsers} />
              </div>
            </Card>
            <Card>
              <CardHeader title="Countries" />
              <div className="p-5">
                <BreakdownList
                  items={stats.data.countries}
                  renderLabel={(k) => (
                    <span>
                      <span aria-hidden>{countryFlag(k)}</span> {countryName(k)}
                    </span>
                  )}
                  empty="No location data. Configure GEOIP_DB_PATH or a load balancer geo header."
                />
              </div>
            </Card>
            <Card>
              <CardHeader title="Cities" />
              <div className="p-5">
                <BreakdownList items={stats.data.cities} empty="No city data" />
              </div>
            </Card>
            <Card>
              <CardHeader title="Referrers" description="QR scans usually have none" />
              <div className="p-5">
                <BreakdownList items={stats.data.referrers} renderLabel={(k) => (k === 'Unknown' ? 'Direct / QR scan' : k)} />
              </div>
            </Card>
          </div>

          <Card>
            <CardHeader title="When people scan" description={`Day and hour, in ${stats.data.range.tz}`} />
            <div className="p-5">
              <Heatmap cells={stats.data.heatmap} />
            </div>
          </Card>

          <RecentHits campaign={campaign} params={params} />
        </>
      )}
    </div>
  );
}

function RecentHits({ campaign, params }: { campaign: CampaignDetail; params: StatsParams }) {
  const hits = useInfiniteQuery({
    queryKey: ['hits', campaign.id, params],
    queryFn: ({ pageParam }) => api.hits(campaign.id, { ...params, limit: 25, before: pageParam }),
    initialPageParam: undefined as number | undefined,
    getNextPageParam: (last) => last.nextBefore ?? undefined,
  });
  const items = hits.data?.pages.flatMap((p) => p.items) ?? [];
  return (
    <Card className="overflow-hidden">
      <CardHeader title="Recent scans" description="Individual visits, newest first" />
      {hits.isPending ? (
        <Spinner />
      ) : items.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted">No scans in this period.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] text-sm">
            <thead className="bg-surface-2/60 text-left text-xs text-muted">
              <tr>
                <th className="px-5 py-2.5 font-medium">Time</th>
                <th className="px-3 py-2.5 font-medium">Source</th>
                <th className="px-3 py-2.5 font-medium">Device</th>
                <th className="px-3 py-2.5 font-medium">Location</th>
                <th className="px-3 py-2.5 font-medium">IP</th>
                <th className="px-5 py-2.5 font-medium">Referrer</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {items.map((h) => (
                <tr key={h.id} className={h.isBot ? 'opacity-60' : undefined}>
                  <td className="px-5 py-2.5 whitespace-nowrap text-muted">{formatDateTime(h.occurredAt)}</td>
                  <td className="px-3 py-2.5 text-fg">{h.sourceLabel}</td>
                  <td className="px-3 py-2.5 text-muted">
                    {[h.deviceVendor, h.deviceModel].filter(Boolean).join(' ') || DEVICE_LABELS[h.deviceType] || h.deviceType}
                    <span className="block text-xs">{[h.os && `${h.os} ${h.osVersion ?? ''}`.trim(), h.browser].filter(Boolean).join(' · ')}</span>
                  </td>
                  <td className="px-3 py-2.5 text-muted">
                    {h.country ? (
                      <>
                        <span aria-hidden>{countryFlag(h.country)}</span> {[h.city, h.region, countryName(h.country)].filter(Boolean).join(', ')}
                      </>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="px-3 py-2.5 font-mono text-xs text-muted">{h.ip ?? <span title="Removed by retention policy">redacted</span>}</td>
                  <td className="max-w-48 truncate px-5 py-2.5 text-muted" title={h.referrer ?? undefined}>
                    {h.referrer ?? '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {hits.hasNextPage && (
        <div className="border-t border-border p-3 text-center">
          <Button size="sm" variant="ghost" loading={hits.isFetchingNextPage} onClick={() => hits.fetchNextPage()}>
            Load more
          </Button>
        </div>
      )}
    </Card>
  );
}
