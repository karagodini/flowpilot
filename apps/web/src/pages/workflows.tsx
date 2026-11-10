import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Page } from '@/components/shell';
import { Badge, Button, Input, Label, Modal, Textarea } from '@/components/ui';
import { api } from '@/lib/api';
import type { ExecutionSummary, WorkflowDetail, WorkflowSummary } from '@/lib/types';
import { formatWhen } from '@/lib/utils';

const tones: Record<string, 'good' | 'bad' | 'warn' | 'neutral' | 'info'> = {
  success: 'good',
  error: 'bad',
  running: 'warn',
  queued: 'info',
  cancelled: 'neutral',
};

export function WorkflowsPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const workflows = useQuery({
    queryKey: ['workflows'],
    queryFn: () => api<{ workflows: WorkflowSummary[] }>('/api/workflows'),
  });
  const executions = useQuery({
    queryKey: ['executions'],
    queryFn: () => api<{ executions: ExecutionSummary[] }>('/api/executions?limit=6'),
  });
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const create = useMutation({
    mutationFn: () =>
      api<{ workflow: WorkflowDetail }>('/api/workflows', {
        method: 'POST',
        body: JSON.stringify({ name, description }),
      }),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: ['workflows'] });
      navigate(`/workflows/${result.workflow.id}`);
    },
  });

  return (
    <Page
      title="Workflows"
      lede="Each workflow is a versioned graph. Turn it on when a webhook, schedule, or sheet should start it on its own."
      action={
        <div className="flex gap-2">
          <Link to="/templates">
            <Button variant="quiet" type="button">
              Templates
            </Button>
          </Link>
          <Button type="button" onClick={() => setOpen(true)}>
            New workflow
          </Button>
        </div>
      }
    >
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_280px]">
        <div className="space-y-3">
          {workflows.data?.workflows.length === 0 ? (
            <div className="rounded-3xl border border-dashed border-line p-8">
              <h2 className="text-lg text-white">No workflows yet</h2>
              <p className="mt-2 max-w-md text-sm leading-6 text-mist">
                Start from a template if you want the lead path, the weekday digest, or the on-call
                desk already laid out.
              </p>
            </div>
          ) : null}
          {workflows.data?.workflows.map((workflow) => (
            <Link
              key={workflow.id}
              to={`/workflows/${workflow.id}`}
              className="block rounded-3xl border border-line bg-ink-900 px-5 py-4 hover:border-mint-400/40"
            >
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-lg text-white">{workflow.name}</h2>
                <Badge tone={workflow.active ? 'good' : 'neutral'}>
                  {workflow.active ? 'Active' : 'Paused'}
                </Badge>
                {workflow.lastExecution ? (
                  <Badge tone={tones[workflow.lastExecution.status] ?? 'neutral'}>
                    {workflow.lastExecution.status}
                  </Badge>
                ) : null}
              </div>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-mist">
                {workflow.description || 'No description yet.'}
              </p>
              <div className="mt-3 text-xs text-mist">
                Version {workflow.version ?? 0} · Updated {formatWhen(workflow.updatedAt)}
                {workflow.lastExecution
                  ? ` · Last run ${formatWhen(workflow.lastExecution.createdAt)}`
                  : ''}
              </div>
            </Link>
          ))}
        </div>
        <aside className="rounded-3xl border border-line bg-ink-900 p-4">
          <h2 className="text-sm font-medium text-white">Recent runs</h2>
          <div className="mt-3 space-y-3">
            {executions.data?.executions.length === 0 ? (
              <p className="text-sm text-mist">Runs will show up here.</p>
            ) : null}
            {executions.data?.executions.map((execution) => (
              <Link key={execution.id} to={`/executions/${execution.id}`} className="block">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-sm text-white">{execution.workflowName}</span>
                  <Badge tone={tones[execution.status] ?? 'neutral'}>{execution.status}</Badge>
                </div>
                <div className="text-xs text-mist">
                  {execution.trigger} · {formatWhen(execution.createdAt)}
                </div>
              </Link>
            ))}
          </div>
        </aside>
      </div>
      <Modal
        open={open}
        onOpenChange={setOpen}
        title="New workflow"
        description="You can rename it later. A manual trigger is placed on the canvas so you can run it immediately."
      >
        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            create.mutate();
          }}
        >
          <div>
            <Label>Name</Label>
            <Input value={name} onChange={(event) => setName(event.target.value)} required />
          </div>
          <div>
            <Label>Description</Label>
            <Textarea
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
          </div>
          <Button type="submit" disabled={create.isPending}>
            Create workflow
          </Button>
        </form>
      </Modal>
    </Page>
  );
}
