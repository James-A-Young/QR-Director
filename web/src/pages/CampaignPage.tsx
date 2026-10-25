import { useQuery } from '@tanstack/react-query';
import { clsx } from 'clsx';
import { ArrowLeft, ExternalLink } from 'lucide-react';
import { Link, useParams, useSearchParams } from 'react-router';
import { api } from '../lib/api';
import { Badge, ErrorNotice, PageHeader, Spinner } from '../components/ui';
import { LinksTab } from '../components/campaign/LinksTab';
import { AnalyticsTab } from '../components/campaign/AnalyticsTab';
import { HistoryTab } from '../components/campaign/HistoryTab';
import { SettingsTab } from '../components/campaign/SettingsTab';

const TABS = [
  { id: 'links', label: 'Links & QR codes' },
  { id: 'analytics', label: 'Analytics' },
  { id: 'history', label: 'History' },
  { id: 'settings', label: 'Settings' },
] as const;
type TabId = (typeof TABS)[number]['id'];

export function CampaignPage() {
  const { id = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const tab = (TABS.find((t) => t.id === params.get('tab'))?.id ?? 'links') as TabId;
  const campaign = useQuery({ queryKey: ['campaign', id], queryFn: () => api.campaign(id) });

  if (campaign.isPending) return <Spinner />;
  if (campaign.error) return <ErrorNotice error={campaign.error} retry={() => campaign.refetch()} />;
  const c = campaign.data;

  return (
    <>
      <PageHeader
        back={
          <Link to="/campaigns" className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-fg">
            <ArrowLeft className="size-4" /> Campaigns
          </Link>
        }
        title={
          <span className="flex items-center gap-3">
            {c.name}
            {c.archived && <Badge>Archived</Badge>}
          </span>
        }
        description={
          <span className="inline-flex max-w-full items-center gap-1.5">
            Redirects to
            <a href={c.destinationUrl} target="_blank" rel="noreferrer" className="inline-flex min-w-0 items-center gap-1 font-medium text-fg hover:text-accent">
              <span className="truncate">{c.destinationUrl}</span>
              <ExternalLink className="size-3.5 shrink-0" />
            </a>
          </span>
        }
      />
      <div className="mb-6 flex gap-1 overflow-x-auto border-b border-border" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setParams(t.id === 'links' ? {} : { tab: t.id }, { replace: true })}
            className={clsx(
              '-mb-px border-b-2 px-3 py-2.5 text-sm font-medium whitespace-nowrap transition-colors',
              tab === t.id ? 'border-accent text-accent' : 'border-transparent text-muted hover:text-fg',
            )}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tab === 'links' && <LinksTab campaign={c} />}
      {tab === 'analytics' && <AnalyticsTab campaign={c} />}
      {tab === 'history' && <HistoryTab campaign={c} />}
      {tab === 'settings' && <SettingsTab key={c.updatedAt} campaign={c} />}
    </>
  );
}
