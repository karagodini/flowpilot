import type { Prisma, PrismaClient } from '@flowpilot/db';
import {
  getTemplate,
  validateGraph,
  WORKFLOW_TEMPLATES,
  type WorkflowExport,
  type WorkflowGraph,
  type WorkflowNode,
} from '@flowpilot/shared';
import { HttpError } from './errors.js';
import { syncTriggers } from './triggers.js';

export async function ownedWorkflow(prisma: PrismaClient, id: string, ownerId: string) {
  const workflow = await prisma.workflow.findFirst({
    where: { id, ownerId },
    include: {
      currentVersion: true,
      webhooks: true,
      schedule: true,
      errorWorkflow: { select: { id: true, name: true } },
    },
  });
  if (!workflow) throw new HttpError(404, 'Workflow not found.');
  return workflow;
}

export function graphFromVersion(version: {
  nodes: Prisma.JsonValue;
  edges: Prisma.JsonValue;
}): WorkflowGraph {
  return {
    nodes: version.nodes as unknown as WorkflowGraph['nodes'],
    edges: version.edges as unknown as WorkflowGraph['edges'],
  };
}

export function defaultGraph(): WorkflowGraph {
  return {
    nodes: [
      {
        id: 'start',
        type: 'trigger.manual',
        name: 'Manual run',
        position: { x: 120, y: 180 },
        config: {},
      },
    ],
    edges: [],
  };
}

export async function withAvailablePaths(
  prisma: PrismaClient,
  graph: WorkflowGraph,
): Promise<WorkflowGraph> {
  const existing = await prisma.webhook.findMany({ select: { path: true } });
  const taken = new Set(existing.map((hook) => hook.path));
  return {
    ...graph,
    nodes: graph.nodes.map((node) => {
      if (node.type !== 'trigger.webhook' && node.type !== 'trigger.telegram') return node;
      const path = String(node.config.path ?? '')
        .trim()
        .toLowerCase();
      if (!path || !taken.has(path)) {
        if (path) taken.add(path);
        return node;
      }
      let suffix = 2;
      let next = `${path}-${suffix}`.slice(0, 63);
      while (taken.has(next)) {
        suffix += 1;
        next = `${path}-${suffix}`.slice(0, 63);
      }
      taken.add(next);
      return { ...node, config: { ...node.config, path: next } };
    }),
  };
}

export async function saveVersion(
  prisma: PrismaClient,
  workflowId: string,
  graph: WorkflowGraph,
  note: string,
) {
  const { graph: clean, errors } = validateGraph(graph);
  if (errors.length > 0) throw new HttpError(400, errors[0] ?? 'The workflow graph is not valid.');
  const latest = await prisma.workflowVersion.findFirst({
    where: { workflowId },
    orderBy: { version: 'desc' },
  });
  const created = await prisma.workflowVersion.create({
    data: {
      workflowId,
      version: (latest?.version ?? 0) + 1,
      nodes: clean.nodes as unknown as Prisma.InputJsonValue,
      edges: clean.edges as unknown as Prisma.InputJsonValue,
      note,
    },
  });
  await prisma.workflow.update({
    where: { id: workflowId },
    data: { currentVersionId: created.id },
  });
  await syncTriggers(prisma, workflowId, clean);
  return created;
}

export async function attachCredentialNames(
  prisma: PrismaClient,
  ownerId: string,
  nodes: WorkflowNode[],
): Promise<WorkflowNode[]> {
  const ids = [
    ...new Set(nodes.map((node) => node.credentialId).filter((id): id is string => Boolean(id))),
  ];
  if (ids.length === 0) return nodes;
  const credentials = await prisma.credential.findMany({
    where: { ownerId, id: { in: ids } },
    select: { id: true, name: true },
  });
  const names = new Map(credentials.map((credential) => [credential.id, credential.name]));
  return nodes.map((node) =>
    node.credentialId
      ? { ...node, credentialName: names.get(node.credentialId) ?? node.credentialName ?? null }
      : node,
  );
}

export async function relinkCredentials(
  prisma: PrismaClient,
  ownerId: string,
  nodes: WorkflowNode[],
): Promise<WorkflowNode[]> {
  const names = [
    ...new Set(
      nodes.map((node) => node.credentialName).filter((name): name is string => Boolean(name)),
    ),
  ];
  const ids = [
    ...new Set(nodes.map((node) => node.credentialId).filter((id): id is string => Boolean(id))),
  ];
  const credentials =
    names.length === 0 && ids.length === 0
      ? []
      : await prisma.credential.findMany({
          where: {
            ownerId,
            OR: [
              ...(names.length ? [{ name: { in: names } }] : []),
              ...(ids.length ? [{ id: { in: ids } }] : []),
            ],
          },
          select: { id: true, name: true },
        });
  const byName = new Map(credentials.map((credential) => [credential.name, credential.id]));
  const ownedIds = new Set(credentials.map((credential) => credential.id));
  return nodes.map((node) => {
    if (node.credentialId && ownedIds.has(node.credentialId)) {
      const name = credentials.find((credential) => credential.id === node.credentialId)?.name;
      return { ...node, credentialName: name ?? node.credentialName ?? null };
    }
    const match = node.credentialName ? byName.get(node.credentialName) : undefined;
    return { ...node, credentialId: match ?? null };
  });
}

export function exportDocument(
  workflow: { name: string; description: string; errorWorkflow?: { name: string } | null },
  graph: WorkflowGraph,
): WorkflowExport {
  return {
    format: 'flowpilot.workflow',
    formatVersion: 1,
    exportedAt: new Date().toISOString(),
    workflow: {
      name: workflow.name,
      description: workflow.description,
      errorWorkflowName: workflow.errorWorkflow?.name ?? null,
      graph: {
        nodes: graph.nodes.map((node) => ({ ...node, credentialId: null })),
        edges: graph.edges,
      },
    },
  };
}

export function templateSummaries() {
  return WORKFLOW_TEMPLATES.map((template) => ({
    id: template.id,
    name: template.name,
    summary: template.summary,
    description: template.description,
    category: template.category,
    nodeCount: template.graph.nodes.length,
  }));
}

export function requireTemplate(id: string) {
  const template = getTemplate(id);
  if (!template) throw new HttpError(404, 'Workflow template not found.');
  return template;
}
