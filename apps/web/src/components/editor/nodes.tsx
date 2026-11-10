import { getNodeDefinition, type NodeType } from '@flowpilot/shared';
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import {
  Clock3,
  Code2,
  Database,
  FileJson,
  Globe,
  Mail,
  Play,
  Repeat,
  Send,
  Sparkles,
  Split,
  Table2,
  Tags,
  Timer,
  Webhook,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';

export interface StepData extends Record<string, unknown> {
  nodeType: NodeType;
  name: string;
  config: Record<string, unknown>;
  credentialId?: string | null;
  credentialName?: string | null;
  retry?: { maxAttempts: number; backoffMs: number };
  onError?: 'stop' | 'continue' | 'errorWorkflow';
  disabled?: boolean;
  runStatus?: 'success' | 'error' | 'skipped';
}

export type StepNode = Node<StepData, 'step'>;

const icons: Record<string, LucideIcon> = {
  Play,
  Webhook,
  Clock3,
  Send,
  Table2,
  Globe,
  Code2,
  Split,
  Repeat,
  Timer,
  Mail,
  Database,
  Sparkles,
  Tags,
  FileJson,
};

const tones: Record<string, string> = {
  trigger: 'bg-mint-400/15 text-mint-300',
  action: 'bg-sky-400/15 text-sky-200',
  logic: 'bg-amber-400/15 text-amber-200',
  ai: 'bg-violet-400/15 text-violet-200',
};

export function StepCard({ data, selected }: NodeProps<StepNode>) {
  const definition = getNodeDefinition(data.nodeType);
  const Icon = icons[definition?.icon ?? 'Play'] ?? Play;
  const outputs = definition?.outputs ?? [{ id: 'output', label: 'Output' }];
  const isTrigger = data.nodeType.startsWith('trigger.');
  return (
    <div
      className={cn(
        'step-node',
        selected && 'selected',
        data.runStatus && `run-${data.runStatus}`,
        data.disabled && 'opacity-60',
      )}
    >
      {!isTrigger ? <Handle type="target" position={Position.Left} /> : null}
      <div className="flex items-center gap-2 px-3 pt-3">
        <span
          className={cn(
            'grid h-7 w-7 place-items-center rounded-lg',
            tones[definition?.group ?? 'action'],
          )}
        >
          <Icon className="h-3.5 w-3.5" />
        </span>
        <div className="min-w-0">
          <div className="truncate text-[13px] font-medium text-white">{data.name}</div>
          <div className="text-[11px] text-mist">{definition?.title}</div>
        </div>
      </div>
      <div className="truncate px-3 pb-3 pt-2 text-[11px] text-mist">{summarize(data)}</div>
      {outputs.map((output, index) => (
        <Handle
          key={output.id}
          id={output.id}
          type="source"
          position={Position.Right}
          style={{ top: outputs.length === 1 ? '50%' : `${32 + index * 28}px` }}
        />
      ))}
      {outputs.length > 1 ? (
        <div className="flex justify-end gap-3 px-3 pb-2 text-[10px] uppercase tracking-wider text-mist">
          {outputs.map((output) => (
            <span key={output.id}>{output.label}</span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function summarize(data: StepData): string {
  const config = data.config;
  switch (data.nodeType) {
    case 'trigger.webhook':
      return `${String(config.method || 'POST')} /${String(config.path || 'set a path')}`;
    case 'trigger.telegram':
      return `/${String(config.path || 'set a path')}`;
    case 'trigger.cron':
      return `${String(config.cron || 'cron')} · ${String(config.timezone || 'UTC')}`;
    case 'trigger.sheets':
      return config.mode === 'api' ? 'Google Sheets' : 'CSV rows';
    case 'action.http':
      return `${String(config.method || 'GET')} ${hostOf(String(config.url || ''))}`;
    case 'action.delay':
      return `${Number(config.ms || 0)} ms`;
    case 'action.telegram':
      return config.chatId ? `Chat ${String(config.chatId)}` : 'Choose a chat';
    case 'action.email':
      return String(config.to || 'Add a recipient');
    case 'action.postgres':
      return String(config.sql || 'INSERT or UPDATE').slice(0, 42);
    case 'action.condition':
      return String(config.expression || 'expression');
    case 'action.loop':
      return `Batch ${Number(config.batchSize || 1)}`;
    case 'ai.classify':
      return Array.isArray(config.categories) ? config.categories.join(' · ') : 'Categories';
    case 'ai.prompt':
    case 'ai.extract':
      return data.credentialId ? 'Model connected' : 'Runs when a key is saved';
    default:
      return data.disabled ? 'Turned off' : 'Ready';
  }
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url || 'Add a URL';
  }
}

export const nodeTypes = { step: StepCard };
