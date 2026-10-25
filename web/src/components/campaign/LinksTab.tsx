import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Download, Link2, Palette, Pencil, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Link as RouterLink } from 'react-router';
import { api } from '../../lib/api';
import { formatNumber, formatRelative } from '../../lib/format';
import type { CampaignDetail, Link } from '../../lib/types';
import { seriesColor } from '../charts';
import { QrThumb } from '../designer/QrPreview';
import { Badge, Button, Card, CopyButton, Dialog, EmptyState, IconButton, Switch, useToast } from '../ui';
import { LinkDialog } from './LinkDialog';

export function LinksTab({ campaign }: { campaign: CampaignDetail }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [editing, setEditing] = useState<Link | 'new' | null>(null);
  const [deleting, setDeleting] = useState<Link | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ['campaign', campaign.id] });

  const toggle = useMutation({
    mutationFn: (l: Link) => api.updateLink(l.id, { active: !l.active }),
    onSuccess: (l) => {
      refresh();
      toast(l.active ? `${l.sourceLabel} is live` : `${l.sourceLabel} paused`);
    },
    onError: (e) => toast(e.message, 'error'),
  });
  const remove = useMutation({
    mutationFn: (l: Link) => api.deleteLink(l.id),
    onSuccess: () => {
      refresh();
      setDeleting(null);
      toast('Source deleted');
    },
    onError: (e) => toast(e.message, 'error'),
  });

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted">One short link and QR code per place it appears. Reports compare them as one campaign.</p>
        <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setEditing('new')}>
          Add source
        </Button>
      </div>
      {campaign.links.length === 0 ? (
        <Card>
          <EmptyState icon={<Link2 className="size-5" />} title="No sources yet" description="Add a source to get a short link and QR code." />
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {campaign.links.map((l, i) => (
            <Card key={l.id} className="flex flex-col">
              <div className="flex items-start gap-4 p-5">
                <RouterLink to={`/links/${l.id}/design`} className="checker shrink-0 rounded-lg border border-border p-1.5" title="Design QR code">
                  <QrThumb style={l.qrStyle} linkId={l.id} className="size-20" />
                </RouterLink>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="size-2.5 shrink-0 rounded-sm" style={{ background: seriesColor(i) }} aria-hidden />
                    <h3 className="truncate font-semibold text-fg">{l.sourceLabel}</h3>
                  </div>
                  <div className="mt-1 flex items-center gap-1">
                    <a href={l.shortUrl} target="_blank" rel="noreferrer" className="truncate font-mono text-sm text-accent hover:underline">
                      {l.shortUrl.replace(/^https?:\/\//, '')}
                    </a>
                    <CopyButton value={l.shortUrl} label="Copy short link" className="size-7" />
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {!l.active && <Badge tone="warning">Paused</Badge>}
                    {l.destinationUrl && <Badge tone="accent">Custom destination</Badge>}
                    {Object.keys(l.utm).length > 0 && <Badge>UTM</Badge>}
                  </div>
                </div>
              </div>
              <dl className="grid grid-cols-3 border-y border-border text-center">
                <div className="px-2 py-3">
                  <dt className="text-xs text-muted">Scans</dt>
                  <dd className="text-lg font-semibold tabular-nums text-fg">{formatNumber(l.stats.hits)}</dd>
                </div>
                <div className="border-x border-border px-2 py-3">
                  <dt className="text-xs text-muted">Unique</dt>
                  <dd className="text-lg font-semibold tabular-nums text-fg">{formatNumber(l.stats.uniqueVisitors)}</dd>
                </div>
                <div className="px-2 py-3">
                  <dt className="text-xs text-muted">Last scan</dt>
                  <dd className="truncate pt-1 text-sm text-fg">{formatRelative(l.stats.lastHitAt)}</dd>
                </div>
              </dl>
              <div className="mt-auto flex items-center justify-between gap-2 px-4 py-3">
                <label className="flex items-center gap-2 text-sm text-muted">
                  <Switch label={`${l.sourceLabel} active`} checked={l.active} onChange={() => toggle.mutate(l)} disabled={toggle.isPending} />
                  {l.active ? 'Live' : 'Paused'}
                </label>
                <div className="flex items-center gap-0.5">
                  <a
                    href={api.qrUrl(l.id, { format: 'png', width: 1024, unit: 'px', download: true })}
                    className="inline-flex size-8 items-center justify-center rounded-lg text-muted hover:bg-surface-2 hover:text-fg"
                    aria-label={`Download ${l.sourceLabel} QR code`}
                    title="Download PNG"
                    download
                  >
                    <Download className="size-4" />
                  </a>
                  <RouterLink
                    to={`/links/${l.id}/design`}
                    className="inline-flex size-8 items-center justify-center rounded-lg text-muted hover:bg-surface-2 hover:text-fg"
                    aria-label={`Design ${l.sourceLabel} QR code`}
                    title="Design QR code"
                  >
                    <Palette className="size-4" />
                  </RouterLink>
                  <IconButton label={`Edit ${l.sourceLabel}`} onClick={() => setEditing(l)}>
                    <Pencil className="size-4" />
                  </IconButton>
                  <IconButton label={`Delete ${l.sourceLabel}`} onClick={() => setDeleting(l)}>
                    <Trash2 className="size-4" />
                  </IconButton>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      <LinkDialog campaign={campaign} link={editing === 'new' ? undefined : (editing ?? undefined)} open={editing !== null} onClose={() => setEditing(null)} />
      <Dialog
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        title="Delete source?"
        description={deleting ? `“${deleting.sourceLabel}” and its ${formatNumber(deleting.stats.hits)} recorded scans will be deleted. Printed QR codes for ${deleting.code} will stop working.` : ''}
        footer={
          <>
            <Button onClick={() => setDeleting(null)}>Cancel</Button>
            <Button variant="danger" loading={remove.isPending} onClick={() => deleting && remove.mutate(deleting)}>
              Delete
            </Button>
          </>
        }
      >
        <p className="text-sm text-muted">Tip: pause a source instead to keep its history.</p>
      </Dialog>
    </>
  );
}
