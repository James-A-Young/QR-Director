import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Save } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { api, ApiError } from '../lib/api';
import type { QrStyle } from '../lib/types';
import { DEFAULT_STYLE } from '../components/designer/presets';
import { DesignerWorkspace } from '../components/designer/DesignerWorkspace';
import { Button, ErrorNotice, Input, PageHeader, Spinner, useToast } from '../components/ui';

export function TemplateEditorPage() {
  const { id } = useParams();
  const template = useQuery({ queryKey: ['template', id], queryFn: () => api.template(id!), enabled: Boolean(id) });
  if (!id) return <TemplateEditor key="new" initialName="New template" initialStyle={DEFAULT_STYLE} />;
  if (template.isPending) return <Spinner />;
  if (template.error) return <ErrorNotice error={template.error} />;
  return <TemplateEditor key={id} id={id} initialName={template.data.name} initialStyle={template.data.style} />;
}

function TemplateEditor({ id, initialName, initialStyle }: { id?: string; initialName: string; initialStyle: QrStyle }) {
  const isNew = !id;
  const navigate = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const templates = useQuery({ queryKey: ['templates'], queryFn: api.templates });
  const [name, setName] = useState(initialName);
  const [style, setStyle] = useState<QrStyle>(initialStyle);

  const save = useMutation({
    mutationFn: () => (isNew ? api.createTemplate({ name, style }) : api.updateTemplate(id, { name, style })),
    onSuccess: (t) => {
      qc.invalidateQueries({ queryKey: ['templates'] });
      qc.setQueryData(['template', t.id], t);
      toast('Template saved');
      if (isNew) navigate(`/templates/${t.id}`, { replace: true });
    },
    onError: (e) => toast(e instanceof ApiError ? e.message : 'Could not save', 'error'),
  });

  return (
    <>
      <PageHeader
        back={
          <Link to="/templates" className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-fg">
            <ArrowLeft className="size-4" /> Templates
          </Link>
        }
        title={
          <Input
            aria-label="Template name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="h-11 border-transparent bg-transparent px-1 text-2xl font-semibold shadow-none hover:border-border focus:border-accent"
          />
        }
        actions={
          <Button variant="primary" icon={<Save className="size-4" />} loading={save.isPending} disabled={!name.trim()} onClick={() => save.mutate()}>
            Save template
          </Button>
        }
      />
      <DesignerWorkspace style={style} onChange={setStyle} templates={templates.data?.filter((t) => t.id !== id)} />
    </>
  );
}
