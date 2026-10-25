import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Archive, ArchiveRestore, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { api, ApiError } from '../../lib/api';
import type { CampaignDetail } from '../../lib/types';
import { Button, Card, CardHeader, Dialog, Field, Input, Textarea, useToast } from '../ui';

export function SettingsTab({ campaign }: { campaign: CampaignDetail }) {
  const qc = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();
  const [name, setName] = useState(campaign.name);
  const [description, setDescription] = useState(campaign.description);
  const [destinationUrl, setDestinationUrl] = useState(campaign.destinationUrl);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [typed, setTyped] = useState('');

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['campaign', campaign.id] });
    qc.invalidateQueries({ queryKey: ['campaigns'] });
    qc.invalidateQueries({ queryKey: ['history', campaign.id] });
  };
  const save = useMutation({
    mutationFn: () => api.updateCampaign(campaign.id, { name, description, destinationUrl }),
    onSuccess: () => {
      invalidate();
      toast('Campaign saved');
    },
  });
  const archive = useMutation({
    mutationFn: () => api.updateCampaign(campaign.id, { archived: !campaign.archived }),
    onSuccess: (c) => {
      invalidate();
      toast(c.archived ? 'Campaign archived. Its links keep working.' : 'Campaign restored');
    },
    onError: (e) => toast(e.message, 'error'),
  });
  const remove = useMutation({
    mutationFn: () => api.deleteCampaign(campaign.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['campaigns'] });
      toast('Campaign deleted');
      navigate('/campaigns');
    },
    onError: (e) => toast(e.message, 'error'),
  });
  const err = save.error instanceof ApiError ? save.error : null;
  const dirty = name !== campaign.name || description !== campaign.description || destinationUrl !== campaign.destinationUrl;

  return (
    <div className="grid gap-6 lg:max-w-3xl">
      <Card>
        <CardHeader title="Details" description="Changing the destination redirects every source without reprinting." />
        <form
          className="space-y-4 p-5"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
        >
          <Field label="Name" error={err?.field('name')}>
            {(id) => <Input id={id} value={name} onChange={(e) => setName(e.target.value)} required />}
          </Field>
          <Field label="Destination URL" error={err?.field('destinationUrl')} hint="Sources with their own destination override are not affected.">
            {(id) => <Input id={id} type="url" value={destinationUrl} onChange={(e) => setDestinationUrl(e.target.value)} required />}
          </Field>
          <Field label="Description">{(id) => <Textarea id={id} value={description} onChange={(e) => setDescription(e.target.value)} />}</Field>
          <div className="flex justify-end">
            <Button type="submit" variant="primary" loading={save.isPending} disabled={!dirty}>
              Save changes
            </Button>
          </div>
        </form>
      </Card>

      <Card>
        <CardHeader title="Archive" description="Hide the campaign from the list. Its short links keep redirecting and recording scans." />
        <div className="p-5">
          <Button
            icon={campaign.archived ? <ArchiveRestore className="size-4" /> : <Archive className="size-4" />}
            loading={archive.isPending}
            onClick={() => archive.mutate()}
          >
            {campaign.archived ? 'Restore campaign' : 'Archive campaign'}
          </Button>
        </div>
      </Card>

      <Card className="border-danger/40">
        <CardHeader title="Delete campaign" description="Permanently deletes all sources and scan history. Printed codes stop working." />
        <div className="p-5">
          <Button variant="danger" icon={<Trash2 className="size-4" />} onClick={() => setConfirmDelete(true)}>
            Delete campaign
          </Button>
        </div>
      </Card>

      <Dialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title="Delete this campaign?"
        description="This cannot be undone."
        footer={
          <>
            <Button onClick={() => setConfirmDelete(false)}>Cancel</Button>
            <Button variant="danger" disabled={typed !== campaign.name} loading={remove.isPending} onClick={() => remove.mutate()}>
              Delete forever
            </Button>
          </>
        }
      >
        <Field label={`Type “${campaign.name}” to confirm`}>{(id) => <Input id={id} value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" />}</Field>
      </Dialog>
    </div>
  );
}
