import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { api, ApiError } from '../lib/api';
import { Button, Dialog, Field, IconButton, Input, Select, Textarea } from './ui';

/** Create a campaign plus its first source variants in one step. */
export function NewCampaignDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const templates = useQuery({ queryKey: ['templates'], queryFn: api.templates, enabled: open });
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [destinationUrl, setDestinationUrl] = useState('https://');
  const [templateId, setTemplateId] = useState('');
  const [sources, setSources] = useState<string[]>(['']);

  const create = useMutation({
    mutationFn: () =>
      api.createCampaign({
        name,
        description,
        destinationUrl,
        templateId: templateId || undefined,
        links: sources.map((s) => s.trim()).filter(Boolean).map((sourceLabel) => ({ sourceLabel })),
      }),
    onSuccess: (c) => {
      qc.invalidateQueries({ queryKey: ['campaigns'] });
      qc.invalidateQueries({ queryKey: ['overview'] });
      onClose();
      setName('');
      setDescription('');
      setDestinationUrl('https://');
      setSources(['']);
      navigate(`/campaigns/${c.id}`);
    },
  });
  const err = create.error instanceof ApiError ? create.error : null;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="New campaign"
      description="Each source gets its own short link and QR code; reports compare them side by side."
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" form="new-campaign" loading={create.isPending}>
            Create campaign
          </Button>
        </>
      }
    >
      <form
        id="new-campaign"
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          create.mutate();
        }}
      >
        <Field label="Campaign name" error={err?.field('name')}>
          {(id) => <Input id={id} value={name} onChange={(e) => setName(e.target.value)} placeholder="Spring product launch" required autoFocus />}
        </Field>
        <Field label="Destination URL" hint="Where visitors land. You can change this at any time, even after printing." error={err?.field('destinationUrl')}>
          {(id) => <Input id={id} type="url" value={destinationUrl} onChange={(e) => setDestinationUrl(e.target.value)} required />}
        </Field>
        <Field label="Description" hint="Optional notes for your team.">
          {(id) => <Textarea id={id} value={description} onChange={(e) => setDescription(e.target.value)} rows={2} />}
        </Field>
        <Field label="QR design">
          {(id) => (
            <Select id={id} value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
              <option value="">Default design</option>
              {templates.data?.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium text-fg">Sources</legend>
          <p className="text-xs text-muted">Where will the code appear? e.g. &ldquo;Trade show stand&rdquo;, &ldquo;Brochure p.4&rdquo;. Leave blank for a single default link.</p>
          {sources.map((s, i) => (
            <div key={i} className="flex gap-2">
              <Input
                aria-label={`Source ${i + 1}`}
                value={s}
                placeholder={i === 0 ? 'e.g. Trade show stand' : 'Another source'}
                onChange={(e) => setSources(sources.map((x, j) => (j === i ? e.target.value : x)))}
              />
              {sources.length > 1 && (
                <IconButton label={`Remove source ${i + 1}`} className="size-10" onClick={() => setSources(sources.filter((_, j) => j !== i))}>
                  <Trash2 className="size-4" />
                </IconButton>
              )}
            </div>
          ))}
          <Button size="sm" variant="ghost" icon={<Plus className="size-4" />} onClick={() => setSources([...sources, ''])}>
            Add source
          </Button>
        </fieldset>
        {create.error && !err?.details && <p className="text-sm text-danger" role="alert">{create.error.message}</p>}
      </form>
    </Dialog>
  );
}
