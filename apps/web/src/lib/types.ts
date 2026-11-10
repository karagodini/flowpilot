import type { WorkflowGraph } from '@flowpilot/shared';

export interface User {
  id: string;
  email: string;
  name: string;
}

export interface WorkflowSummary {
  id: string;
  name: string;
  description: string;
  active: boolean;
  updatedAt: string;
  createdAt: string;
  version: number | null;
  lastExecution: { id: string; status: string; trigger: string; createdAt: string } | null;
}

export interface WorkflowDetail {
  id: string;
  name: string;
  description: string;
  active: boolean;
  errorWorkflowId: string | null;
  errorWorkflowName: string | null;
  createdAt: string;
  updatedAt: string;
  version: { id: string; version: number; note: string; createdAt: string } | null;
  graph: WorkflowGraph;
  webhooks: { path: string; method: string; kind: string; url: string }[];
  schedule: { cron: string; timezone: string; nextRunAt: string | null; enabled: boolean } | null;
}

export interface VersionRow {
  id: string;
  version: number;
  note: string;
  createdAt: string;
}

export interface ExecutionSummary {
  id: string;
  workflowId: string;
  workflowName: string;
  version: number;
  status: string;
  trigger: string;
  mode: string;
  attempt: number;
  error: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
}

export interface ExecutionStep {
  id: string;
  nodeId: string;
  nodeName: string;
  nodeType: string;
  status: string;
  input: unknown;
  output: unknown;
  error: string | null;
  warnings: string[] | null;
  attempt: number;
  startedAt: string;
  finishedAt: string;
  order: number;
}

export interface ExecutionDetail extends ExecutionSummary {
  versionId: string;
  parentId: string | null;
  input: unknown;
  output: unknown;
  steps: ExecutionStep[];
}

export interface CredentialRow {
  id: string;
  name: string;
  type: string;
  preview: string;
  createdAt: string;
  updatedAt?: string;
}

export interface TemplateCard {
  id: string;
  name: string;
  summary: string;
  description: string;
  category: string;
  nodeCount: number;
}
