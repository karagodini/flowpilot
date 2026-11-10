import { z } from 'zod';
import { getNodeDefinition } from './catalog.js';
import { NODE_TYPES } from './types.js';
import type { WorkflowGraph } from './types.js';

const nodeSchema = z.object({
  id: z.string().min(1).max(80),
  type: z.enum(NODE_TYPES),
  name: z.string().min(1).max(120),
  position: z.object({
    x: z.number().finite(),
    y: z.number().finite(),
  }),
  config: z.record(z.unknown()).default({}),
  credentialId: z.string().min(1).max(80).nullable().optional(),
  credentialName: z.string().min(1).max(120).nullable().optional(),
  retry: z
    .object({
      maxAttempts: z.number().int().min(1).max(8),
      backoffMs: z.number().int().min(0).max(60_000),
    })
    .optional(),
  onError: z.enum(['stop', 'continue', 'errorWorkflow']).optional(),
  disabled: z.boolean().optional(),
});

const edgeSchema = z.object({
  id: z.string().min(1).max(80),
  source: z.string().min(1),
  target: z.string().min(1),
  sourceHandle: z.string().max(40).nullable().optional(),
  targetHandle: z.string().max(40).nullable().optional(),
});

const graphSchema = z.object({
  nodes: z.array(nodeSchema).min(1).max(200),
  edges: z.array(edgeSchema).max(400),
});

export function validateGraph(input: unknown): { graph: WorkflowGraph; errors: string[] } {
  const parsed = graphSchema.safeParse(input);
  if (!parsed.success) {
    return {
      graph: { nodes: [], edges: [] },
      errors: parsed.error.issues.map(
        (issue) => `${issue.path.join('.') || 'graph'}: ${issue.message}`,
      ),
    };
  }

  const graph = parsed.data as WorkflowGraph;
  const errors: string[] = [];
  const ids = new Set<string>();
  const names = new Set<string>();

  for (const node of graph.nodes) {
    if (ids.has(node.id)) errors.push(`Duplicate node id "${node.id}".`);
    ids.add(node.id);
    if (names.has(node.name))
      errors.push(`Node names must be unique. "${node.name}" is used twice.`);
    names.add(node.name);
    if (!getNodeDefinition(node.type)) errors.push(`Unknown step type "${node.type}".`);
    const encoded = JSON.stringify(node.config);
    if (encoded.length > 100_000) errors.push(`Configuration for "${node.name}" is too large.`);
    const code = node.config.code;
    if (typeof code === 'string' && code.length > 20_000) {
      errors.push(`JavaScript on "${node.name}" exceeds 20,000 characters.`);
    }
  }

  if (!graph.nodes.some((node) => node.type.startsWith('trigger.'))) {
    errors.push('Add a trigger before saving this workflow.');
  }

  const edgeIds = new Set<string>();
  for (const edge of graph.edges) {
    if (edgeIds.has(edge.id)) errors.push(`Duplicate connection id "${edge.id}".`);
    edgeIds.add(edge.id);
    if (!ids.has(edge.source) || !ids.has(edge.target)) {
      errors.push('A connection points at a step that is not on the canvas.');
    }
    if (edge.source === edge.target) errors.push('A step cannot connect to itself.');
    const source = graph.nodes.find((node) => node.id === edge.source);
    if (source) {
      const definition = getNodeDefinition(source.type);
      const handle = edge.sourceHandle || 'output';
      if (definition && !definition.outputs.some((output) => output.id === handle)) {
        errors.push(`"${source.name}" has no "${handle}" output.`);
      }
    }
  }

  return { graph, errors };
}
