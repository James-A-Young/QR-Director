import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Palette, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { api } from '../lib/api';
import { formatRelative } from '../lib/format';
import type { Template } from '../lib/types';
import { QrThumb } from '../components/designer/QrPreview';
import { Button, Card, Dialog, EmptyState, ErrorNotice, IconButton, PageHeader, Spinner, useToast } from '../components/ui';

export function TemplatesPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const templates = useQuery({ queryKey: ['templates'], queryFn: api.templates });
  const [deleting, setDeleting] = useState<Template | null>(null);
  const remove = useMutation({
    mutationFn: (t: Template) => api.deleteTemplate(t.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['templates'] });
      setDeleting(null);
      toast('Template deleted');
    },
  });

  const newButton = (
    <Link to="/templates/new" className="inline-flex h-10 items-center gap-2 rounded-lg bg-accent px-4 text-sm font-medium text-accent-fg shadow-sm hover:bg-accent-hover">
      <Plus className="size-4" /> New template
    </Link>
  );

  return (
    <>
      <PageHeader title="Templates" description="Saved QR designs to keep campaigns on brand." actions={newButton} />
      {templates.isPending ? (
        <Spinner />
      ) : templates.error ? (
        <ErrorNotice error={templates.error} retry={() => templates.refetch()} />
      ) : templates.data.length === 0 ? (
        <Card>
          <EmptyState icon={<Palette className="size-5" />} title="No templates yet" description="Design a code once with your colours, logo and call to action, then reuse it everywhere." action={newButton} />
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {templates.data.map((t) => (
            <Card key={t.id} className="group overflow-hidden">
              <Link to={`/templates/${t.id}`} className="checker flex aspect-square items-center justify-center border-b border-border p-6">
                <QrThumb style={t.style} className="size-full max-h-56" />
              </Link>
              <div className="flex items-center justify-between gap-2 px-4 py-3">
                <div className="min-w-0">
                  <Link to={`/templates/${t.id}`} className="block truncate font-medium text-fg hover:text-accent">
                    {t.name}
                  </Link>
                  <div className="text-xs text-muted">Updated {formatRelative(t.updatedAt)}</div>
                </div>
                <IconButton label={`Delete ${t.name}`} onClick={() => setDeleting(t)}>
                  <Trash2 className="size-4" />
                </IconButton>
              </div>
            </Card>
          ))}
        </div>
      )}
      <Dialog
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        title="Delete template?"
        description="Existing QR codes keep their design; only the saved template is removed."
        footer={
          <>
            <Button onClick={() => setDeleting(null)}>Cancel</Button>
            <Button variant="danger" loading={remove.isPending} onClick={() => deleting && remove.mutate(deleting)}>
              Delete
            </Button>
          </>
        }
      >
        <span />
      </Dialog>
    </>
  );
}
