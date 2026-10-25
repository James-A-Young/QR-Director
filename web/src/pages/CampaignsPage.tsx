import { useQuery } from '@tanstack/react-query';
import { Megaphone, Plus, Search } from 'lucide-react';
import { useDeferredValue, useState } from 'react';
import { Link } from 'react-router';
import { api } from '../lib/api';
import { formatNumber, formatRelative, hostOf, pluralise } from '../lib/format';
import { Badge, Button, Card, EmptyState, ErrorNotice, Input, PageHeader, Segmented, Spinner } from '../components/ui';
import { NewCampaignDialog } from '../components/NewCampaignDialog';

export function CampaignsPage() {
  const [search, setSearch] = useState('');
  const [archived, setArchived] = useState<'exclude' | 'only'>('exclude');
  const [creating, setCreating] = useState(false);
  const deferred = useDeferredValue(search.trim());
  const campaigns = useQuery({
    queryKey: ['campaigns', { search: deferred, archived }],
    queryFn: () => api.campaigns({ search: deferred || undefined, archived }),
  });

  return (
    <>
      <PageHeader
        title="Campaigns"
        description="Group short links by campaign, with one variant per source."
        actions={
          <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>
            New campaign
          </Button>
        }
      />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative min-w-60 flex-1 sm:max-w-sm">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" />
          <Input className="pl-9" placeholder="Search campaigns, sources or codes" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search campaigns" />
        </div>
        <Segmented label="Show" value={archived} onChange={setArchived} options={[{ value: 'exclude', label: 'Active' }, { value: 'only', label: 'Archived' }]} />
      </div>

      {campaigns.isPending ? (
        <Spinner />
      ) : campaigns.error ? (
        <ErrorNotice error={campaigns.error} retry={() => campaigns.refetch()} />
      ) : campaigns.data.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Megaphone className="size-5" />}
            title={deferred ? 'No matching campaigns' : archived === 'only' ? 'No archived campaigns' : 'No campaigns yet'}
            description={deferred ? 'Try a different search.' : 'Create a campaign to generate short links and QR codes.'}
            action={
              !deferred && archived === 'exclude' ? (
                <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>
                  New campaign
                </Button>
              ) : undefined
            }
          />
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <div className="hidden grid-cols-[1fr_120px_120px_140px] gap-4 border-b border-border bg-surface-2/60 px-5 py-2.5 text-xs font-medium text-muted md:grid">
            <span>Campaign</span>
            <span className="text-right">Scans (7d)</span>
            <span className="text-right">Total scans</span>
            <span className="text-right">Updated</span>
          </div>
          <ul className="divide-y divide-border">
            {campaigns.data.map((c) => (
              <li key={c.id}>
                <Link to={`/campaigns/${c.id}`} className="grid gap-1 px-5 py-4 transition hover:bg-surface-2/60 md:grid-cols-[1fr_120px_120px_140px] md:items-center md:gap-4">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="truncate font-medium text-fg">{c.name}</span>
                      {c.archived && <Badge>Archived</Badge>}
                    </div>
                    <div className="mt-0.5 truncate text-sm text-muted">
                      {pluralise(c.linkCount, 'source')} → {hostOf(c.destinationUrl)}
                    </div>
                  </div>
                  <span className="text-sm tabular-nums text-fg md:text-right">
                    <span className="md:hidden text-muted">7 days: </span>
                    {formatNumber(c.hits7d)}
                  </span>
                  <span className="text-sm tabular-nums text-fg md:text-right">
                    <span className="md:hidden text-muted">Total: </span>
                    {formatNumber(c.hits)}
                  </span>
                  <span className="text-sm text-muted md:text-right">{formatRelative(c.updatedAt)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}
      <NewCampaignDialog open={creating} onClose={() => setCreating(false)} />
    </>
  );
}
