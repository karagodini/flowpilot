import {
  getNodeDefinition,
  NODE_CATALOG,
  type WorkflowEdge,
  type WorkflowNode,
} from '@flowpilot/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  addEdge,
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlow,
  useEdgesState,
  useNodesState,
  type Connection,
  type Edge,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { ArrowLeft, Download, History, Play, Save, Settings2, Upload } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Inspector } from '@/components/editor/inspector';
import { nodeTypes, type StepData, type StepNode } from '@/components/editor/nodes';
import { Badge, Button, Input, Label, Modal, Textarea, Toggle } from '@/components/ui';
import { ApiError, api } from '@/lib/api';
import type {
  CredentialRow,
  ExecutionDetail,
  VersionRow,
  WorkflowDetail,
  WorkflowSummary,
} from '@/lib/types';
import { cn } from '@/lib/utils';

export function EditorPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const workflowQuery = useQuery({
    queryKey: ['workflow', id],
    queryFn: () => api<{ workflow: WorkflowDetail }>(`/api/workflows/${id}`),
  });
  const credentialsQuery = useQuery({
    queryKey: ['credentials'],
    queryFn: () => api<{ credentials: CredentialRow[] }>('/api/credentials'),
  });
  const workflowsQuery = useQuery({
    queryKey: ['workflows'],
    queryFn: () => api<{ workflows: WorkflowSummary[] }>('/api/workflows'),
  });
  const [nodes, setNodes, onNodesChange] = useNodesState<StepNode>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [note, setNote] = useState('');
  const [versionsOpen, setVersionsOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [lastRun, setLastRun] = useState<ExecutionDetail | null>(null);
  const loaded = useRef<string | null>(null);
  const workflow = workflowQuery.data?.workflow;

  useEffect(() => {
    if (!workflow) return;
    const key = workflow.version?.id ?? 'new';
    if (loaded.current === key) return;
    loaded.current = key;
    setNodes(workflow.graph.nodes.map(toNode));
    setEdges(workflow.graph.edges.map(toEdge));
    setDirty(false);
  }, [setEdges, setNodes, workflow]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        save.mutate();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const save = useMutation({
    mutationFn: () =>
      api<{ workflow: WorkflowDetail }>(`/api/workflows/${id}/graph`, {
        method: 'PUT',
        body: JSON.stringify({ graph: currentGraph(nodes, edges), note: note || undefined }),
      }),
    onSuccess: async (result) => {
      loaded.current = result.workflow.version?.id ?? null;
      setDirty(false);
      setNote('');
      setMessage('Version saved.');
      await queryClient.invalidateQueries({ queryKey: ['workflow', id] });
    },
    onError: (error) => setMessage(error instanceof ApiError ? error.message : 'Save failed.'),
  });

  const run = useMutation({
    mutationFn: () =>
      api<{ execution: ExecutionDetail }>(`/api/workflows/${id}/run`, {
        method: 'POST',
        body: JSON.stringify({ payload: {} }),
      }),
    onSuccess: (result) => {
      setLastRun(result.execution);
      const statusByNode = new Map<string, StepData['runStatus']>();
      for (const step of result.execution.steps)
        statusByNode.set(step.nodeId, step.status as StepData['runStatus']);
      setNodes((current) =>
        current.map((node) => ({
          ...node,
          data: { ...node.data, runStatus: statusByNode.get(node.id) },
        })),
      );
      setMessage(
        result.execution.status === 'success'
          ? 'Run finished.'
          : result.execution.error || 'Run failed.',
      );
    },
    onError: (error) => setMessage(error instanceof ApiError ? error.message : 'Run failed.'),
  });

  const selectedNode = nodes.find((node) => node.id === selected) ?? null;
  const selectedStep = lastRun?.steps.filter((step) => step.nodeId === selected).at(-1);

  const grouped = useMemo(() => {
    const groups = [
      ['trigger', 'Triggers'],
      ['logic', 'Logic'],
      ['action', 'Actions'],
      ['ai', 'AI'],
    ] as const;
    return groups.map(([group, label]) => ({
      label,
      nodes: NODE_CATALOG.filter((entry) => entry.group === group),
    }));
  }, []);

  function addNode(type: WorkflowNode['type']) {
    const definition = getNodeDefinition(type);
    if (!definition) return;
    const count = nodes.filter((node) => node.data.nodeType === type).length;
    const name = count === 0 ? definition.title : `${definition.title} ${count + 1}`;
    const node: StepNode = {
      id: crypto.randomUUID(),
      type: 'step',
      position: { x: 160 + nodes.length * 24, y: 80 + (nodes.length % 5) * 36 },
      data: {
        nodeType: type,
        name,
        config: structuredClone(definition.defaultConfig),
      },
    };
    setNodes((current) => [...current, node]);
    setSelected(node.id);
    setDirty(true);
  }

  if (workflowQuery.isLoading || !workflow) {
    return (
      <div className="p-8 text-sm text-mist">
        {workflowQuery.isError ? 'This workflow is not available.' : 'Opening the canvas…'}
      </div>
    );
  }

  return (
    <div className="flex h-screen min-h-[720px] flex-col">
      <header className="flex flex-wrap items-center gap-2 border-b border-line bg-ink-900 px-3 py-2">
        <Link
          to="/workflows"
          className="rounded-full p-2 text-mist hover:bg-white/5 hover:text-white"
          aria-label="Back to workflows"
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <div className="min-w-0">
          <div className="truncate text-sm font-medium text-white">{workflow.name}</div>
          <div className="text-[11px] text-mist">
            Version {workflow.version?.version ?? 0}
            {dirty ? ' · unsaved' : ''}
          </div>
        </div>
        <Badge tone={workflow.active ? 'good' : 'neutral'}>
          {workflow.active ? 'Active' : 'Paused'}
        </Badge>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Button variant="ghost" size="sm" type="button" onClick={() => setSettingsOpen(true)}>
            <Settings2 className="h-4 w-4" /> Settings
          </Button>
          <Button variant="ghost" size="sm" type="button" onClick={() => setVersionsOpen(true)}>
            <History className="h-4 w-4" /> Versions
          </Button>
          <label className="inline-flex cursor-pointer items-center">
            <input
              type="file"
              accept="application/json"
              className="hidden"
              onChange={async (event) => {
                const file = event.target.files?.[0];
                event.target.value = '';
                if (!file) return;
                const parsed = JSON.parse(await file.text()) as {
                  workflow?: { graph?: { nodes: WorkflowNode[]; edges: WorkflowEdge[] } };
                };
                const graph = parsed.workflow?.graph;
                if (!graph) {
                  setMessage('That file is not a FlowPilot workflow.');
                  return;
                }
                setNodes(graph.nodes.map(toNode));
                setEdges(graph.edges.map(toEdge));
                setDirty(true);
              }}
            />
            <span className="inline-flex h-8 items-center gap-2 rounded-full px-3 text-[13px] text-mist hover:bg-white/5 hover:text-white">
              <Upload className="h-4 w-4" /> Import
            </span>
          </label>
          <Button
            variant="ghost"
            size="sm"
            type="button"
            onClick={async () => {
              const document = await api<unknown>(`/api/workflows/${id}/export`);
              const blob = new Blob([JSON.stringify(document, null, 2)], {
                type: 'application/json',
              });
              const url = URL.createObjectURL(blob);
              const anchor = window.document.createElement('a');
              anchor.href = url;
              anchor.download = `${workflow.name.replace(/\s+/g, '-').toLowerCase()}.json`;
              anchor.click();
              URL.revokeObjectURL(url);
            }}
          >
            <Download className="h-4 w-4" /> Export
          </Button>
          <Button
            variant="quiet"
            size="sm"
            type="button"
            onClick={() => save.mutate()}
            disabled={save.isPending}
          >
            <Save className="h-4 w-4" /> Save
          </Button>
          <Button
            size="sm"
            type="button"
            onClick={() => run.mutate()}
            disabled={run.isPending || dirty}
          >
            <Play className="h-4 w-4" /> {dirty ? 'Save to run' : 'Run'}
          </Button>
        </div>
      </header>
      {message ? (
        <div className="border-b border-line bg-ink-850 px-4 py-2 text-sm text-mint-200">
          {message}{' '}
          {lastRun ? (
            <button
              className="underline"
              type="button"
              onClick={() => navigate(`/executions/${lastRun.id}`)}
            >
              Open the run
            </button>
          ) : null}
        </div>
      ) : null}
      <div className="grid min-h-0 flex-1 lg:grid-cols-[240px_minmax(0,1fr)_340px]">
        <aside className="hidden overflow-auto border-r border-line bg-ink-900/80 p-3 lg:block">
          {grouped.map((group) => (
            <div key={group.label} className="mb-4">
              <div className="mb-2 px-1 text-[11px] uppercase tracking-[0.16em] text-mist">
                {group.label}
              </div>
              <div className="space-y-1">
                {group.nodes.map((entry) => (
                  <button
                    key={entry.type}
                    type="button"
                    draggable
                    onDragStart={(event) =>
                      event.dataTransfer.setData('application/flowpilot', entry.type)
                    }
                    onClick={() => addNode(entry.type)}
                    className="block w-full rounded-xl px-2 py-2 text-left hover:bg-white/5"
                  >
                    <div className="text-sm text-white">{entry.title}</div>
                    <div className="text-[11px] leading-4 text-mist">{entry.description}</div>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </aside>
        <div
          className="canvas-grid h-full min-h-[520px]"
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => {
            event.preventDefault();
            const type = event.dataTransfer.getData(
              'application/flowpilot',
            ) as WorkflowNode['type'];
            if (type) addNode(type);
          }}
        >
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            onNodesChange={(changes) => {
              onNodesChange(changes);
              if (
                changes.some(
                  (change) =>
                    change.type === 'remove' || change.type === 'position' || change.type === 'add',
                )
              )
                setDirty(true);
            }}
            onEdgesChange={(changes) => {
              onEdgesChange(changes);
              if (changes.some((change) => change.type === 'remove' || change.type === 'add'))
                setDirty(true);
            }}
            onConnect={(connection: Connection) => {
              setEdges((current) =>
                addEdge(
                  {
                    ...connection,
                    id: crypto.randomUUID(),
                    label:
                      connection.sourceHandle && connection.sourceHandle !== 'output'
                        ? connection.sourceHandle
                        : undefined,
                  },
                  current,
                ),
              );
              setDirty(true);
            }}
            onSelectionChange={({ nodes: selectedNodes }) =>
              setSelected(selectedNodes[0]?.id ?? null)
            }
            fitView
            proOptions={{ hideAttribution: false }}
            deleteKeyCode={['Backspace', 'Delete']}
          >
            <Background
              variant={BackgroundVariant.Dots}
              gap={22}
              size={1}
              color="rgba(214,224,244,0.18)"
            />
            <Controls showInteractive={false} />
            <MiniMap pannable zoomable maskColor="rgba(7,11,20,0.7)" nodeColor={() => '#5eead4'} />
          </ReactFlow>
        </div>
        <aside className="overflow-auto border-t border-line bg-ink-900 lg:border-l lg:border-t-0">
          <div className="border-b border-line p-3 lg:hidden">
            <Label>Add a step</Label>
            <select
              className="h-10 w-full rounded-xl border border-line bg-ink-950 px-3 text-sm"
              defaultValue=""
              onChange={(event) => {
                if (event.target.value) addNode(event.target.value as WorkflowNode['type']);
                event.target.value = '';
              }}
            >
              <option value="">Choose</option>
              {NODE_CATALOG.map((entry) => (
                <option key={entry.type} value={entry.type}>
                  {entry.title}
                </option>
              ))}
            </select>
          </div>
          <Inspector
            data={selectedNode?.data ?? null}
            credentials={credentialsQuery.data?.credentials ?? []}
            step={selectedStep}
            onDelete={() => {
              if (!selected) return;
              setNodes((current) => current.filter((node) => node.id !== selected));
              setEdges((current) =>
                current.filter((edge) => edge.source !== selected && edge.target !== selected),
              );
              setSelected(null);
              setDirty(true);
            }}
            onChange={(patch) => {
              if (!selected) return;
              setNodes((current) =>
                current.map((node) =>
                  node.id === selected ? { ...node, data: { ...node.data, ...patch } } : node,
                ),
              );
              setDirty(true);
            }}
          />
        </aside>
      </div>
      <VersionsDialog
        open={versionsOpen}
        workflowId={id}
        onOpenChange={setVersionsOpen}
        onRestored={() => {
          loaded.current = null;
          void queryClient.invalidateQueries({ queryKey: ['workflow', id] });
        }}
      />
      <SettingsDialog
        open={settingsOpen}
        workflow={workflow}
        workflows={workflowsQuery.data?.workflows ?? []}
        onOpenChange={setSettingsOpen}
        onSaved={(text) => {
          setMessage(text);
          void queryClient.invalidateQueries({ queryKey: ['workflow', id] });
        }}
      />
    </div>
  );
}

function toNode(node: WorkflowNode): StepNode {
  return {
    id: node.id,
    type: 'step',
    position: node.position ?? { x: 0, y: 0 },
    data: {
      nodeType: node.type,
      name: node.name,
      config: node.config ?? {},
      credentialId: node.credentialId ?? null,
      credentialName: node.credentialName ?? null,
      retry: node.retry,
      onError: node.onError,
      disabled: node.disabled,
    },
  };
}

function toEdge(edge: WorkflowEdge): Edge {
  return {
    id: edge.id,
    source: edge.source,
    target: edge.target,
    sourceHandle: edge.sourceHandle,
    targetHandle: edge.targetHandle,
    label: edge.sourceHandle && edge.sourceHandle !== 'output' ? edge.sourceHandle : undefined,
  };
}

function currentGraph(nodes: StepNode[], edges: Edge[]) {
  return {
    nodes: nodes.map((node) => ({
      id: node.id,
      type: node.data.nodeType,
      name: node.data.name.trim() || 'Step',
      position: node.position,
      config: node.data.config,
      credentialId: node.data.credentialId ?? null,
      credentialName: node.data.credentialName ?? null,
      retry: node.data.retry,
      onError: node.data.onError,
      disabled: node.data.disabled,
    })),
    edges: edges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      sourceHandle: edge.sourceHandle ?? null,
      targetHandle: edge.targetHandle ?? null,
    })),
  };
}

function VersionsDialog({
  open,
  onOpenChange,
  workflowId,
  onRestored,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workflowId: string;
  onRestored: () => void;
}) {
  const versions = useQuery({
    queryKey: ['versions', workflowId],
    queryFn: () =>
      api<{ versions: VersionRow[]; currentVersionId: string | null }>(
        `/api/workflows/${workflowId}/versions`,
      ),
    enabled: open,
  });
  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Versions"
      description="Restoring a version makes it the one that runs. Older versions stay in the list."
    >
      <div className="space-y-2">
        {versions.data?.versions.map((version) => (
          <div
            key={version.id}
            className="flex items-center justify-between gap-3 rounded-2xl border border-line px-3 py-2"
          >
            <div>
              <div className="text-sm text-white">v{version.version}</div>
              <div className="text-xs text-mist">
                {version.note || 'No note'} · {new Date(version.createdAt).toLocaleString()}
              </div>
            </div>
            <Button
              variant="quiet"
              size="sm"
              type="button"
              disabled={version.id === versions.data?.currentVersionId}
              onClick={async () => {
                await api(`/api/workflows/${workflowId}/versions/${version.id}/restore`, {
                  method: 'POST',
                });
                onRestored();
                onOpenChange(false);
              }}
            >
              {version.id === versions.data?.currentVersionId ? 'Current' : 'Restore'}
            </Button>
          </div>
        ))}
      </div>
    </Modal>
  );
}

function SettingsDialog({
  open,
  onOpenChange,
  workflow,
  workflows,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workflow: WorkflowDetail;
  workflows: WorkflowSummary[];
  onSaved: (message: string) => void;
}) {
  const [name, setName] = useState(workflow.name);
  const [description, setDescription] = useState(workflow.description);
  const [active, setActive] = useState(workflow.active);
  const [errorWorkflowId, setErrorWorkflowId] = useState(workflow.errorWorkflowId ?? '');
  useEffect(() => {
    setName(workflow.name);
    setDescription(workflow.description);
    setActive(workflow.active);
    setErrorWorkflowId(workflow.errorWorkflowId ?? '');
  }, [workflow]);
  return (
    <Modal open={open} onOpenChange={onOpenChange} title="Workflow settings">
      <form
        className="space-y-3"
        onSubmit={async (event) => {
          event.preventDefault();
          try {
            await api(`/api/workflows/${workflow.id}`, {
              method: 'PATCH',
              body: JSON.stringify({
                name,
                description,
                active,
                errorWorkflowId: errorWorkflowId || null,
              }),
            });
            onSaved(active ? 'Workflow is active.' : 'Settings saved.');
            onOpenChange(false);
          } catch (error) {
            onSaved(error instanceof ApiError ? error.message : 'Could not save settings.');
          }
        }}
      >
        <div>
          <Label>Name</Label>
          <Input value={name} onChange={(event) => setName(event.target.value)} />
        </div>
        <div>
          <Label>Description</Label>
          <Textarea value={description} onChange={(event) => setDescription(event.target.value)} />
        </div>
        <Toggle checked={active} onCheckedChange={setActive} label="Active" />
        <div>
          <Label>Error workflow</Label>
          <select
            className={cn('h-10 w-full rounded-xl border border-line bg-ink-950 px-3 text-sm')}
            value={errorWorkflowId}
            onChange={(event) => setErrorWorkflowId(event.target.value)}
          >
            <option value="">None</option>
            {workflows
              .filter((item) => item.id !== workflow.id)
              .map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
          </select>
        </div>
        {workflow.webhooks.length > 0 ? (
          <div className="rounded-2xl border border-line p-3 text-sm text-mist">
            {workflow.webhooks.map((hook) => (
              <div key={hook.path}>
                {hook.method} {hook.url}
              </div>
            ))}
          </div>
        ) : null}
        <Button type="submit">Save settings</Button>
      </form>
    </Modal>
  );
}
