import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { JsonView } from '@/components/json-view';
import { Page } from '@/components/shell';
import { Badge, Button } from '@/components/ui';
import { api } from '@/lib/api';
import type { ExecutionDetail, ExecutionSummary } from '@/lib/types';
import { cn, duration, formatClock, formatWhen } from '@/lib/utils';

const tones: Record<string, 'good' | 'bad' | 'warn' | 'neutral' | 'info'> = {
  success: 'good',
  error: 'bad',
  running: 'warn',
  queued: 'info',
  skipped: 'warn',
  cancelled: 'neutral',
};

export function ExecutionsPage() {
  const executions = useQuery({
    queryKey: ['executions'],
    queryFn: () => api<{ executions: ExecutionSummary[] }>('/api/executions?limit=50'),
  });
  return (
    <Page
      title="Executions"
      lede="Every run keeps the trigger, the version, and the input and output of each step."
    >
      <div className="overflow-hidden rounded-3xl border border-line">
        {executions.data?.executions.length === 0 ? (
          <p className="p-6 text-sm text-mist">No runs yet.</p>
        ) : null}
        {executions.data?.executions.map((execution) => (
          <Link
            key={execution.id}
            to={`/executions/${execution.id}`}
            className="grid grid-cols-[1fr_auto] gap-3 border-b border-line px-4 py-3 last:border-b-0 hover:bg-white/[0.03] md:grid-cols-[1.4fr_0.6fr_0.5fr_0.6fr]"
          >
            <div>
              <div className="text-sm text-white">{execution.workflowName}</div>
              <div className="text-xs text-mist">
                v{execution.version} · attempt {execution.attempt}
              </div>
            </div>
            <div className="hidden text-sm text-mist md:block">{execution.trigger}</div>
            <Badge tone={tones[execution.status] ?? 'neutral'}>{execution.status}</Badge>
            <div className="text-right text-xs text-mist">{formatWhen(execution.createdAt)}</div>
          </Link>
        ))}
      </div>
    </Page>
  );
}

export function ExecutionPage() {
  const { id = '' } = useParams();
  const queryClient = useQueryClient();
  const execution = useQuery({
    queryKey: ['execution', id],
    queryFn: () => api<{ execution: ExecutionDetail }>(`/api/executions/${id}`),
  });
  const [selected, setSelected] = useState(0);
  const retry = useMutation({
    mutationFn: () =>
      api<{ execution: ExecutionDetail }>(`/api/executions/${id}/retry`, { method: 'POST' }),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: ['executions'] });
      window.location.assign(`/executions/${result.execution.id}`);
    },
  });
  const detail = execution.data?.execution;
  if (!detail)
    return (
      <div className="p-8 text-sm text-mist">
        {execution.isError ? 'Run not found.' : 'Loading the run…'}
      </div>
    );
  const step = detail.steps[selected] ?? detail.steps[0];
  return (
    <Page
      title={detail.workflowName}
      lede={`${detail.trigger} · version ${detail.version} · attempt ${detail.attempt} · ${formatClock(detail.startedAt)}`}
      action={
        <div className="flex items-center gap-2">
          <Badge tone={tones[detail.status] ?? 'neutral'}>{detail.status}</Badge>
          <Button
            variant="quiet"
            type="button"
            onClick={() => retry.mutate()}
            disabled={retry.isPending || detail.status === 'running' || detail.status === 'queued'}
          >
            Retry
          </Button>
          <Link to={`/workflows/${detail.workflowId}`}>
            <Button variant="ghost" type="button">
              Open canvas
            </Button>
          </Link>
        </div>
      }
    >
      {detail.error ? (
        <p className="mb-4 rounded-2xl border border-rose-400/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
          {detail.error}
        </p>
      ) : null}
      <div className="grid gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
        <div className="space-y-2">
          {detail.steps.map((entry, index) => (
            <button
              key={entry.id}
              type="button"
              onClick={() => setSelected(index)}
              className={cn(
                'w-full rounded-2xl border px-3 py-3 text-left',
                index === selected ? 'border-mint-400/60 bg-white/5' : 'border-line',
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm text-white">{entry.nodeName}</span>
                <Badge tone={tones[entry.status] ?? 'neutral'}>{entry.status}</Badge>
              </div>
              <div className="mt-1 text-xs text-mist">
                {entry.nodeType} · attempt {entry.attempt} ·{' '}
                {duration(entry.startedAt, entry.finishedAt)}
              </div>
            </button>
          ))}
          {detail.steps.length === 0 ? (
            <p className="text-sm text-mist">This run has no step records.</p>
          ) : null}
        </div>
        {step ? (
          <div className="space-y-4">
            <div>
              <h2 className="text-lg text-white">{step.nodeName}</h2>
              {step.error ? <p className="mt-2 text-sm text-rose-200">{step.error}</p> : null}
              {step.warnings?.map((warning) => (
                <p key={warning} className="mt-2 text-sm text-amber-200">
                  {warning}
                </p>
              ))}
            </div>
            <div className="grid gap-4 xl:grid-cols-2">
              <div>
                <h3 className="mb-2 text-sm text-mist">Input</h3>
                <JsonView value={step.input} />
              </div>
              <div>
                <h3 className="mb-2 text-sm text-mist">Output</h3>
                <JsonView value={step.output} />
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </Page>
  );
}
