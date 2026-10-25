import { useQuery } from '@tanstack/react-query';
import { Link2, Megaphone, MousePointerClick, Plus, Users } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { api } from '../lib/api';
import { formatNumber } from '../lib/format';
import { BreakdownList, StatTile, TimeSeriesChart } from '../components/charts';
import { Button, Card, CardHeader, EmptyState, ErrorNotice, PageHeader, Segmented, Spinner } from '../components/ui';
import { NewCampaignDialog } from '../components/NewCampaignDialog';
import { useMe } from '../components/AppLayout';

export function DashboardPage() {
  const [days, setDays] = useState<'7' | '30' | '90'>('30');
  const [creating, setCreating] = useState(false);
  const me = useMe();
  const overview = useQuery({ queryKey: ['overview', days], queryFn: () => api.overview({ days: Number(days) }) });
  const firstName = me.data?.name?.split(' ')[0];

  return (
    <>
      <PageHeader
        title={firstName ? `Welcome back, ${firstName}` : 'Dashboard'}
        description="Scans across all campaigns."
        actions={
          <>
            <Segmented label="Period" value={days} onChange={setDays} options={[{ value: '7', label: '7 days' }, { value: '30', label: '30 days' }, { value: '90', label: '90 days' }]} />
            <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>
              New campaign
            </Button>
          </>
        }
      />
      {overview.isPending ? (
        <Spinner />
      ) : overview.error ? (
        <ErrorNotice error={overview.error} retry={() => overview.refetch()} />
      ) : (
        <div className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatTile label="Scans" value={formatNumber(overview.data.totals.hits)} hint={`Last ${days} days`} icon={<MousePointerClick className="size-4" />} />
            <StatTile label="Unique visitors" value={formatNumber(overview.data.totals.uniqueVisitors)} hint={`Last ${days} days`} icon={<Users className="size-4" />} />
            <StatTile label="Active campaigns" value={formatNumber(overview.data.totals.campaigns)} icon={<Megaphone className="size-4" />} />
            <StatTile label="Short links" value={formatNumber(overview.data.totals.links)} icon={<Link2 className="size-4" />} />
          </div>
          {overview.data.totals.campaigns === 0 ? (
            <Card>
              <EmptyState
                icon={<Megaphone className="size-5" />}
                title="Create your first campaign"
                description="A campaign groups the short links and QR codes you print for each event, flyer or placement, so you can compare where people found you."
                action={
                  <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>
                    New campaign
                  </Button>
                }
              />
            </Card>
          ) : (
            <div className="grid gap-6 lg:grid-cols-3">
              <Card className="lg:col-span-2">
                <CardHeader title="Scans per day" />
                <div className="p-5">
                  <TimeSeriesChart
                    data={overview.data.timeseries.map((p) => ({ t: p.t, total: p.total }))}
                    series={[{ key: 'total', label: 'Scans', colorIndex: 0 }]}
                    bucket="day"
                  />
                </div>
              </Card>
              <Card>
                <CardHeader title="Top campaigns" />
                <div className="p-5">
                  <BreakdownList
                    items={overview.data.topCampaigns.map((c) => ({ key: c.id, hits: c.hits }))}
                    renderLabel={(id) => {
                      const c = overview.data.topCampaigns.find((x) => x.id === id)!;
                      return (
                        <Link to={`/campaigns/${c.id}`} className="hover:text-accent hover:underline">
                          {c.name}
                        </Link>
                      );
                    }}
                    empty="No scans in this period"
                  />
                </div>
              </Card>
            </div>
          )}
        </div>
      )}
      <NewCampaignDialog open={creating} onClose={() => setCreating(false)} />
    </>
  );
}
