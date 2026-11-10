import type { CredentialType, NodeDefinition, NodeType } from './types.js';

export const NODE_CATALOG: NodeDefinition[] = [
  {
    type: 'trigger.manual',
    group: 'trigger',
    title: 'Manual run',
    description: 'Start the workflow from the editor or the API, with an optional JSON payload.',
    icon: 'Play',
    outputs: [{ id: 'output', label: 'Output' }],
    defaultConfig: {},
  },
  {
    type: 'trigger.webhook',
    group: 'trigger',
    title: 'Webhook',
    description: 'Listen for an HTTP call and pass the request into the workflow.',
    icon: 'Webhook',
    outputs: [{ id: 'output', label: 'Output' }],
    defaultConfig: { path: '', method: 'POST' },
  },
  {
    type: 'trigger.cron',
    group: 'trigger',
    title: 'Schedule',
    description: 'Run on a cron schedule in a chosen timezone.',
    icon: 'Clock3',
    outputs: [{ id: 'output', label: 'Output' }],
    defaultConfig: { cron: '0 8 * * 1-5', timezone: 'UTC' },
  },
  {
    type: 'trigger.telegram',
    group: 'trigger',
    title: 'Telegram message',
    description: 'Start when the Telegram bot receives a message on its webhook.',
    icon: 'Send',
    outputs: [{ id: 'output', label: 'Output' }],
    defaultConfig: { path: '' },
  },
  {
    type: 'trigger.sheets',
    group: 'trigger',
    title: 'New sheet row',
    description: 'Watch a Google Sheet via an API key, or read rows from a CSV file.',
    icon: 'Table2',
    outputs: [{ id: 'output', label: 'Output' }],
    defaultConfig: {
      mode: 'csv',
      spreadsheetId: '',
      range: 'Leads!A:Z',
      csvText: '',
      intervalMinutes: 15,
    },
    credentialType: 'google_sheets',
  },
  {
    type: 'action.http',
    group: 'action',
    title: 'HTTP request',
    description: 'Call an external HTTP API and keep the status, headers, and body.',
    icon: 'Globe',
    outputs: [{ id: 'output', label: 'Output' }],
    defaultConfig: { method: 'GET', url: '', headers: {}, body: '', timeoutMs: 15000 },
    credentialType: 'http',
  },
  {
    type: 'action.transform',
    group: 'logic',
    title: 'Transform',
    description: 'Reshape items with JavaScript that runs in a restricted sandbox.',
    icon: 'Code2',
    outputs: [{ id: 'output', label: 'Output' }],
    defaultConfig: {
      code: 'return items.map((item) => ({\n  json: {\n    ...item.json,\n  },\n}))\n',
    },
  },
  {
    type: 'action.condition',
    group: 'logic',
    title: 'Condition',
    description: 'Split items between the true and false branches with an expression.',
    icon: 'Split',
    outputs: [
      { id: 'true', label: 'True' },
      { id: 'false', label: 'False' },
    ],
    defaultConfig: { expression: 'Boolean($json.ok)' },
  },
  {
    type: 'action.loop',
    group: 'logic',
    title: 'Loop',
    description:
      'Run the each branch once per item, then continue on done with the combined result.',
    icon: 'Repeat',
    outputs: [
      { id: 'each', label: 'Each' },
      { id: 'done', label: 'Done' },
    ],
    defaultConfig: { batchSize: 1 },
  },
  {
    type: 'action.delay',
    group: 'action',
    title: 'Delay',
    description: 'Pause the run for a number of milliseconds before continuing.',
    icon: 'Timer',
    outputs: [{ id: 'output', label: 'Output' }],
    defaultConfig: { ms: 1000 },
  },
  {
    type: 'action.telegram',
    group: 'action',
    title: 'Send Telegram',
    description: 'Post a message with a bot token stored in the vault.',
    icon: 'Send',
    outputs: [{ id: 'output', label: 'Output' }],
    defaultConfig: { chatId: '', text: '', parseMode: '' },
    credentialType: 'telegram',
  },
  {
    type: 'action.email',
    group: 'action',
    title: 'Send email',
    description: 'Deliver mail through an SMTP credential.',
    icon: 'Mail',
    outputs: [{ id: 'output', label: 'Output' }],
    defaultConfig: { to: '', subject: '', text: '' },
    credentialType: 'smtp',
  },
  {
    type: 'action.postgres',
    group: 'action',
    title: 'Write to PostgreSQL',
    description: 'Run a single INSERT or UPDATE with bound parameters.',
    icon: 'Database',
    outputs: [{ id: 'output', label: 'Output' }],
    defaultConfig: { sql: '', params: [] },
    credentialType: 'postgres',
  },
  {
    type: 'ai.prompt',
    group: 'ai',
    title: 'LLM prompt',
    description: 'Send a prompt to an OpenAI-compatible chat API. Skipped when no key is saved.',
    icon: 'Sparkles',
    outputs: [{ id: 'output', label: 'Output' }],
    defaultConfig: {
      system: 'You are a precise operations assistant.',
      prompt: '',
      model: 'gpt-4o-mini',
      temperature: 0.2,
    },
    credentialType: 'openai',
  },
  {
    type: 'ai.classify',
    group: 'ai',
    title: 'Classify',
    description: 'Pick one category for a piece of text. Skipped when no key is saved.',
    icon: 'Tags',
    outputs: [{ id: 'output', label: 'Output' }],
    defaultConfig: {
      text: '{{ $json.note }}',
      categories: ['hot', 'warm', 'cold'],
      model: 'gpt-4o-mini',
    },
    credentialType: 'openai',
  },
  {
    type: 'ai.extract',
    group: 'ai',
    title: 'Extract JSON',
    description:
      'Ask a model for a JSON object that matches a described shape. Skipped when no key is saved.',
    icon: 'FileJson',
    outputs: [{ id: 'output', label: 'Output' }],
    defaultConfig: {
      text: '{{ $json.note }}',
      schemaHint: '{ "company": string, "seats": number }',
      model: 'gpt-4o-mini',
    },
    credentialType: 'openai',
  },
];

const byType = new Map(NODE_CATALOG.map((entry) => [entry.type, entry]));

export function getNodeDefinition(type: string): NodeDefinition | undefined {
  return byType.get(type as NodeType);
}

export function credentialTypeFor(nodeType: string): CredentialType | undefined {
  return getNodeDefinition(nodeType)?.credentialType;
}
