import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { api, ApiError } from '../../lib/api';
import type { CampaignDetail, Link, Utm } from '../../lib/types';
import { Button, Dialog, Field, Input, Textarea } from '../ui';

const UTM_FIELDS: Array<{ key: keyof Utm; label: string; placeholder: string }> = [
  { key: 'source', label: 'utm_source', placeholder: 'e.g. expo-2026' },
  { key: 'medium', label: 'utm_medium', placeholder: 'e.g. qr' },
  { key: 'campaign', label: 'utm_campaign', placeholder: 'e.g. spring-launch' },
  { key: 'content', label: 'utm_content', placeholder: 'e.g. stand-banner' },
];

function useDebounced<T>(value: T, ms = 300) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/** Create or edit a source variant (one short link + QR code). */
export function LinkDialog(props: { campaign: CampaignDetail; link?: Link; open: boolean; onClose: () => void }) {
  // Remount the form for each opening so it starts from the link's current values.
  return props.open ? <LinkDialogForm key={props.link?.id ?? 'new'} {...props} /> : null;
}

function LinkDialogForm({ campaign, link, open, onClose }: { campaign: CampaignDetail; link?: Link; open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const [sourceLabel, setSourceLabel] = useState(link?.sourceLabel ?? '');
  const [code, setCode] = useState(link?.code ?? '');
  const [override, setOverride] = useState(link?.destinationUrl ?? '');
  const [notes, setNotes] = useState(link?.notes ?? '');
  const [utm, setUtm] = useState<Utm>(link?.utm ?? {});

  const normalised = code.trim().toLowerCase();
  const debouncedCode = useDebounced(normalised);
  const checkCode = open && debouncedCode.length >= 2 && debouncedCode !== link?.code;
  const availability = useQuery({
    queryKey: ['code', debouncedCode],
    queryFn: () => api.codeAvailable(debouncedCode),
    enabled: checkCode,
  });
  const config = useQuery({ queryKey: ['config'], queryFn: api.config, staleTime: Infinity });
  const codeHint =
    !normalised || normalised === link?.code
      ? 'Leave blank to generate a short random code.'
      : !checkCode || availability.isFetching
        ? 'Checking…'
        : availability.data?.available
          ? `✓ ${config.data?.publicBaseUrl ?? ''}/${normalised} is available`
          : undefined;
  const codeError =
    checkCode && !availability.isFetching && availability.data && !availability.data.available
      ? availability.data.reason === 'taken'
        ? 'That code is already in use'
        : availability.data.reason === 'reserved'
          ? 'That code is reserved'
          : 'Use letters, digits and hyphens (2-64 characters)'
      : undefined;

  const save = useMutation({
    mutationFn: () => {
      const body = {
        sourceLabel,
        code: normalised || undefined,
        destinationUrl: override.trim() || null,
        notes,
        utm: Object.fromEntries(Object.entries(utm).filter(([, v]) => v?.trim())) as Utm,
      };
      return link ? api.updateLink(link.id, body) : api.createLink(campaign.id, body);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['campaign', campaign.id] });
      qc.invalidateQueries({ queryKey: ['campaigns'] });
      onClose();
    },
  });
  const err = save.error instanceof ApiError ? save.error : null;
  const codeChanged = link && normalised && normalised !== link.code;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      wide
      title={link ? 'Edit source' : 'Add a source'}
      description="Each source has its own short link and QR code, so you can see where scans come from."
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" form="link-form" loading={save.isPending} disabled={Boolean(codeError)}>
            {link ? 'Save changes' : 'Add source'}
          </Button>
        </>
      }
    >
      <form
        id="link-form"
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Source name" hint="Where this code will appear." error={err?.field('sourceLabel')}>
            {(id) => <Input id={id} value={sourceLabel} onChange={(e) => setSourceLabel(e.target.value)} placeholder="Trade show stand" required autoFocus />}
          </Field>
          <Field label="Short code" hint={codeHint} error={codeError ?? (err?.code === 'code_taken' ? err.message : err?.field('code'))}>
            {(id) => <Input id={id} value={code} onChange={(e) => setCode(e.target.value)} placeholder="auto" className="font-mono" autoCapitalize="none" spellCheck={false} />}
          </Field>
        </div>
        {codeChanged && (
          <p className="rounded-lg bg-warning-soft px-3 py-2 text-xs text-warning">
            Changing the code breaks any QR codes already printed with “{link.code}”.
          </p>
        )}
        <Field label="Destination override" hint={`Optional. Defaults to the campaign destination (${campaign.destinationUrl}).`} error={err?.field('destinationUrl')}>
          {(id) => <Input id={id} type="url" value={override} onChange={(e) => setOverride(e.target.value)} placeholder={campaign.destinationUrl} />}
        </Field>
        <fieldset>
          <legend className="mb-2 text-sm font-medium text-fg">UTM tags</legend>
          <p className="mb-3 text-xs text-muted">Added to the destination so analytics tools like Google Analytics can attribute visits too.</p>
          <div className="grid gap-3 sm:grid-cols-2">
            {UTM_FIELDS.map((f) => (
              <Field key={f.key} label={f.label}>
                {(id) => (
                  <Input id={id} value={utm[f.key] ?? ''} placeholder={f.placeholder} className="font-mono text-xs" onChange={(e) => setUtm({ ...utm, [f.key]: e.target.value })} />
                )}
              </Field>
            ))}
          </div>
        </fieldset>
        <Field label="Notes">{(id) => <Textarea id={id} rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />}</Field>
        {save.error && !err?.details && err?.code !== 'code_taken' && (
          <p className="text-sm text-danger" role="alert">
            {save.error.message}
          </p>
        )}
      </form>
    </Dialog>
  );
}
