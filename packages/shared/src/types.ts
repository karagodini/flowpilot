export const NODE_TYPES = [
  'trigger.manual',
  'trigger.webhook',
  'trigger.cron',
  'trigger.telegram',
  'trigger.sheets',
  'action.http',
  'action.transform',
  'action.condition',
  'action.loop',
  'action.delay',
  'action.telegram',
  'action.email',
  'action.postgres',
  'ai.prompt',
  'ai.classify',
  'ai.extract',
] as const;

export type NodeType = (typeof NODE_TYPES)[number];

export const CREDENTIAL_TYPES = [
  'telegram',
  'smtp',
  'postgres',
  'openai',
  'google_sheets',
  'http',
] as const;

export type CredentialType = (typeof CREDENTIAL_TYPES)[number];

export type ErrorPolicy = 'stop' | 'continue' | 'errorWorkflow';

export interface RetryPolicy {
  maxAttempts: number;
  backoffMs: number;
}

export type JsonObject = Record<string, unknown>;

export interface WorkflowNode {
  id: string;
  type: NodeType;
  name: string;
  position: { x: number; y: number };
  config: JsonObject;
  credentialId?: string | null;
  credentialName?: string | null;
  retry?: RetryPolicy;
  onError?: ErrorPolicy;
  disabled?: boolean;
}

export interface WorkflowEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string | null;
  targetHandle?: string | null;
}

export interface WorkflowGraph {
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
}

export interface Item {
  json: JsonObject;
}

export interface NodeDefinition {
  type: NodeType;
  group: 'trigger' | 'action' | 'logic' | 'ai';
  title: string;
  description: string;
  icon: string;
  outputs: { id: string; label: string }[];
  defaultConfig: JsonObject;
  credentialType?: CredentialType;
}

export interface WorkflowTemplate {
  id: string;
  name: string;
  summary: string;
  description: string;
  category: string;
  graph: WorkflowGraph;
}

export interface WorkflowExport {
  format: 'flowpilot.workflow';
  formatVersion: 1;
  exportedAt: string;
  workflow: {
    name: string;
    description: string;
    errorWorkflowName: string | null;
    graph: WorkflowGraph;
  };
}
