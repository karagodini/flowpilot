import { useMutation, useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Page } from '@/components/shell';
import { Badge, Button } from '@/components/ui';
import { api } from '@/lib/api';
import type { TemplateCard, WorkflowDetail } from '@/lib/types';

export function TemplatesPage() {
  const navigate = useNavigate();
  const templates = useQuery({
    queryKey: ['templates'],
    queryFn: () => api<{ templates: TemplateCard[] }>('/api/templates'),
  });
  const useTemplate = useMutation({
    mutationFn: (id: string) =>
      api<{ workflow: WorkflowDetail }>(`/api/templates/${id}/use`, { method: 'POST' }),
    onSuccess: (result) => navigate(`/workflows/${result.workflow.id}`),
  });
  return (
    <Page
      title="Templates"
      lede="Ready workflows for the paths Harbor & Lane runs most often. Using one copies it into your account so you can change the paths and credentials."
    >
      <div className="grid gap-4 md:grid-cols-2">
        {templates.data?.templates.map((template) => (
          <article
            key={template.id}
            className="flex flex-col rounded-3xl border border-line bg-ink-900 p-5"
          >
            <div className="flex items-center gap-2">
              <Badge tone="info">{template.category}</Badge>
              <span className="text-xs text-mist">{template.nodeCount} steps</span>
            </div>
            <h2 className="mt-3 text-xl text-white">{template.name}</h2>
            <p className="mt-2 text-sm leading-6 text-mist">{template.summary}</p>
            <p className="mt-3 flex-1 text-sm leading-6 text-mist/90">{template.description}</p>
            <Button
              className="mt-4 self-start"
              type="button"
              onClick={() => useTemplate.mutate(template.id)}
              disabled={useTemplate.isPending}
            >
              Use this workflow
            </Button>
          </article>
        ))}
      </div>
    </Page>
  );
}
