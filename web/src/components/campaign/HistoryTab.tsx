import { useQuery } from '@tanstack/react-query';
import { History } from 'lucide-react';
import { api } from '../../lib/api';
import { formatDateTime } from '../../lib/format';
import type { CampaignDetail, HistoryEntry } from '../../lib/types';
import { Card, EmptyState, ErrorNotice, Spinner } from '../ui';

type Change = { from: unknown; to: unknown };
const isChange = (v: unknown): v is Change => typeof v === 'object' && v !== null && 'to' in v;

function describe(entry: HistoryEntry, campaign: CampaignDetail): string[] {
  const subject =
    entry.entityType === 'campaign' ? 'Campaign' : `Source “${campaign.links.find((l) => l.id === entry.entityId)?.sourceLabel ?? 'deleted'}”`;
  if (entry.action === 'created') return [`${subject} created`];
  const d = entry.details;
  const lines: string[] = [];
  if (isChange(d.destinationUrl)) {
    lines.push(
      d.destinationUrl.to
        ? `${subject} redirected to ${String(d.destinationUrl.to)}`
        : `${subject} now uses the campaign destination`,
    );
  }
  if (isChange(d.code)) lines.push(`${subject} code changed from ${String(d.code.from)} to ${String(d.code.to)}`);
  if (isChange(d.name)) lines.push(`Renamed to “${String(d.name.to)}”`);
  if (isChange(d.sourceLabel)) lines.push(`Source renamed to “${String(d.sourceLabel.to)}”`);
  if (typeof d.active === 'boolean') lines.push(`${subject} ${d.active ? 'resumed' : 'paused'}`);
  if (typeof d.archived === 'boolean') lines.push(d.archived ? 'Campaign archived' : 'Campaign restored');
  if (d.utm) lines.push(`${subject} UTM tags updated`);
  if (d.qrStyle || d.defaultStyle) lines.push(`${subject} QR design updated`);
  return lines.length ? lines : [`${subject} updated`];
}

export function HistoryTab({ campaign }: { campaign: CampaignDetail }) {
  const history = useQuery({ queryKey: ['history', campaign.id], queryFn: () => api.history(campaign.id) });
  if (history.isPending) return <Spinner />;
  if (history.error) return <ErrorNotice error={history.error} />;
  if (history.data.length === 0) {
    return (
      <Card>
        <EmptyState icon={<History className="size-5" />} title="No changes yet" />
      </Card>
    );
  }
  return (
    <Card>
      <ol className="divide-y divide-border">
        {history.data.map((e) => (
          <li key={e.id} className="flex flex-wrap items-start justify-between gap-2 px-5 py-3.5">
            <div className="space-y-0.5">
              {describe(e, campaign).map((line) => (
                <p key={line} className="text-sm text-fg">
                  {line}
                </p>
              ))}
              <p className="text-xs text-muted">{e.userName ?? 'Unknown user'}</p>
            </div>
            <time className="text-xs text-muted" dateTime={e.createdAt}>
              {formatDateTime(e.createdAt)}
            </time>
          </li>
        ))}
      </ol>
    </Card>
  );
}
