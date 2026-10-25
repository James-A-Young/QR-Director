import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Layers, Save } from 'lucide-react';
import { useState } from 'react';
import { Link, useBlocker, useParams } from 'react-router';
import { api } from '../lib/api';
import type { QrStyle } from '../lib/types';
import { DesignerWorkspace } from '../components/designer/DesignerWorkspace';
import { ExportPanel } from '../components/designer/ExportPanel';
import { useQrPreview } from '../components/designer/QrPreview';
import { Button, Card, CardHeader, CopyButton, Dialog, ErrorNotice, Field, Input, PageHeader, Spinner, useToast } from '../components/ui';

export function LinkDesignerPage() {
  const { id = '' } = useParams();
  const link = useQuery({ queryKey: ['link', id], queryFn: () => api.link(id) });
  if (link.isPending) return <Spinner />;
  if (link.error) return <ErrorNotice error={link.error} retry={() => link.refetch()} />;
  return <LinkDesigner key={id} id={id} initialStyle={link.data.qrStyle} />;
}

function LinkDesigner({ id, initialStyle }: { id: string; initialStyle: QrStyle }) {
  const qc = useQueryClient();
  const toast = useToast();
  const link = useQuery({ queryKey: ['link', id], queryFn: () => api.link(id) });
  const templates = useQuery({ queryKey: ['templates'], queryFn: api.templates });
  const [draft, setDraft] = useState<QrStyle>(initialStyle);
  const [templateName, setTemplateName] = useState<string | null>(null);
  const [confirmApplyAll, setConfirmApplyAll] = useState(false);

  const saved = link.data?.qrStyle ?? initialStyle;
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);
  const blocker = useBlocker(dirty);
  const preview = useQrPreview(draft, { linkId: id });

  const save = useMutation({
    mutationFn: () => api.updateLink(id, { qrStyle: draft }),
    onSuccess: (l) => {
      qc.setQueryData(['link', id], l);
      qc.invalidateQueries({ queryKey: ['campaign', l.campaignId] });
      toast('Design saved');
    },
    onError: (e) => toast(e.message, 'error'),
  });
  const applyAll = useMutation({
    mutationFn: async () => {
      await api.applyStyle(link.data!.campaignId, draft);
      return api.link(id);
    },
    onSuccess: (l) => {
      qc.setQueryData(['link', id], l);
      qc.invalidateQueries({ queryKey: ['campaign', l.campaignId] });
      setConfirmApplyAll(false);
      toast('Design applied to every source in the campaign');
    },
    onError: (e) => toast(e.message, 'error'),
  });
  const saveTemplate = useMutation({
    mutationFn: () => api.createTemplate({ name: templateName!.trim(), style: draft }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['templates'] });
      setTemplateName(null);
      toast('Saved as template');
    },
    onError: (e) => toast(e.message, 'error'),
  });

  const l = link.data;
  if (!l) return <Spinner />;

  return (
    <>
      <PageHeader
        back={
          <Link to={`/campaigns/${l.campaignId}`} className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-fg">
            <ArrowLeft className="size-4" /> {l.campaignName}
          </Link>
        }
        title={`QR code · ${l.sourceLabel}`}
        description={
          <span className="inline-flex items-center gap-1 font-mono">
            {l.shortUrl}
            <CopyButton value={l.shortUrl} className="size-7" />
          </span>
        }
        actions={
          <>
            <Button icon={<Layers className="size-4" />} onClick={() => setTemplateName(`${l.campaignName} style`)}>
              Save as template
            </Button>
            <Button onClick={() => setConfirmApplyAll(true)}>Apply to all sources</Button>
            <Button variant="primary" icon={<Save className="size-4" />} disabled={!dirty} loading={save.isPending} onClick={() => save.mutate()}>
              Save design
            </Button>
          </>
        }
      />
      <DesignerWorkspace
        style={draft}
        onChange={setDraft}
        templates={templates.data}
        linkId={id}
        aside={
          <Card>
            <CardHeader title="Download" description="Print-ready files of the saved design." />
            <div className="p-5">
              <ExportPanel linkId={id} disabled={dirty} aspect={preview.data ? preview.data.height / preview.data.width : 1} />
            </div>
          </Card>
        }
      />

      <Dialog
        open={templateName !== null}
        onClose={() => setTemplateName(null)}
        title="Save as template"
        description="Reuse this design for other campaigns and sources."
        footer={
          <>
            <Button onClick={() => setTemplateName(null)}>Cancel</Button>
            <Button variant="primary" type="submit" form="tpl-form" loading={saveTemplate.isPending} disabled={!templateName?.trim()}>
              Save template
            </Button>
          </>
        }
      >
        <form
          id="tpl-form"
          onSubmit={(e) => {
            e.preventDefault();
            saveTemplate.mutate();
          }}
        >
          <Field label="Template name">{(fid) => <Input id={fid} value={templateName ?? ''} onChange={(e) => setTemplateName(e.target.value)} autoFocus />}</Field>
        </form>
      </Dialog>

      <Dialog
        open={confirmApplyAll}
        onClose={() => setConfirmApplyAll(false)}
        title="Apply to all sources?"
        description="Every source in this campaign will use this design, and new sources will start from it. Each code still points to its own short link."
        footer={
          <>
            <Button onClick={() => setConfirmApplyAll(false)}>Cancel</Button>
            <Button variant="primary" loading={applyAll.isPending} onClick={() => applyAll.mutate()}>
              Apply to all
            </Button>
          </>
        }
      >
        <span />
      </Dialog>

      <Dialog
        open={blocker.state === 'blocked'}
        onClose={() => blocker.reset?.()}
        title="Discard unsaved changes?"
        description="Your design changes have not been saved."
        footer={
          <>
            <Button onClick={() => blocker.reset?.()}>Keep editing</Button>
            <Button variant="danger" onClick={() => blocker.proceed?.()}>
              Discard
            </Button>
          </>
        }
      >
        <span />
      </Dialog>
    </>
  );
}
