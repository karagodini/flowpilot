import type { WorkflowTemplate } from './types.js';

const normalizeLead = `const source = items[0] && items[0].json ? items[0].json : {}
const body = source.body && typeof source.body === 'object' ? source.body : source
const email = String(body.email || '').trim().toLowerCase()
const name = String(body.name || '').trim()
const company = String(body.company || '').trim()
const employees = Number(body.employees || 0)
const note = String(body.note || body.message || '')
let score = 10
if (employees >= 200) score += 45
else if (employees >= 50) score += 30
else if (employees >= 10) score += 15
if (company) score += 15
if (note.length > 40) score += 10
return [{ json: { email, name, company, employees, note, score, source: 'website-form' } }]
`;

export const WORKFLOW_TEMPLATES: WorkflowTemplate[] = [
  {
    id: 'lead-qualification',
    name: 'Website lead to Telegram',
    summary:
      'Score an inbound form, read buying intent when a model key is available, and alert sales.',
    description:
      'Harbor & Lane uses this path for marketing-site requests. The form is normalized, scored from company size and the note, then classified when an OpenAI-compatible key is in the vault. Hot leads post to the sales Telegram channel. Everyone else receives a short follow-up by email.',
    category: 'Sales',
    graph: {
      nodes: [
        {
          id: 'form',
          type: 'trigger.webhook',
          name: 'Website form',
          position: { x: 40, y: 180 },
          config: { path: 'inbound-lead', method: 'POST' },
        },
        {
          id: 'norm',
          type: 'action.transform',
          name: 'Normalize lead',
          position: { x: 340, y: 180 },
          config: { code: normalizeLead },
        },
        {
          id: 'intent',
          type: 'ai.classify',
          name: 'Read buying intent',
          position: { x: 660, y: 80 },
          config: {
            text: '{{ $json.name }} at {{ $json.company }} ({{ $json.employees }} people) wrote: {{ $json.note }}',
            categories: ['hot', 'warm', 'cold'],
            model: 'gpt-4o-mini',
          },
          onError: 'continue',
        },
        {
          id: 'gate',
          type: 'action.condition',
          name: 'Worth a call',
          position: { x: 980, y: 180 },
          config: {
            expression: 'Number($json.score) >= 55 || ($json.ai && $json.ai.category === "hot")',
          },
        },
        {
          id: 'alert',
          type: 'action.telegram',
          name: 'Alert sales',
          position: { x: 1300, y: 40 },
          credentialName: 'Sales channel bot',
          config: {
            chatId: '',
            text: 'New lead: {{ $json.name }} at {{ $json.company }} (score {{ $json.score }}). {{ $json.email }}',
            parseMode: '',
          },
        },
        {
          id: 'nurture',
          type: 'action.email',
          name: 'Send follow-up',
          position: { x: 1300, y: 320 },
          credentialName: 'Harbor Lane mail',
          config: {
            to: '{{ $json.email }}',
            subject: 'We received your note, {{ $json.name }}',
            text: 'Hi {{ $json.name }},\n\nThanks for writing to Harbor & Lane. A producer will reply within one business day.\n',
          },
        },
      ],
      edges: [
        { id: 'e1', source: 'form', target: 'norm' },
        { id: 'e2', source: 'norm', target: 'intent' },
        { id: 'e3', source: 'intent', target: 'gate' },
        { id: 'e4', source: 'gate', target: 'alert', sourceHandle: 'true' },
        { id: 'e5', source: 'gate', target: 'nurture', sourceHandle: 'false' },
      ],
    },
  },
  {
    id: 'weekday-digest',
    name: 'Weekday pipeline digest',
    summary: 'Each weekday morning, pull the pipeline summary and mail it to the partners.',
    description:
      'A cron trigger fires at 08:00 America/New_York on weekdays. The HTTP step loads the internal pipeline summary, a transform flattens the numbers, and SMTP delivers the digest.',
    category: 'Operations',
    graph: {
      nodes: [
        {
          id: 'clock',
          type: 'trigger.cron',
          name: 'Weekday 8:00',
          position: { x: 60, y: 160 },
          config: { cron: '0 8 * * 1-5', timezone: 'America/New_York' },
        },
        {
          id: 'fetch',
          type: 'action.http',
          name: 'Load pipeline',
          position: { x: 380, y: 160 },
          config: {
            method: 'GET',
            url: 'https://ops.harborlane.com/v1/pipeline/summary',
            headers: { Accept: 'application/json' },
            body: '',
            timeoutMs: 15000,
          },
          retry: { maxAttempts: 3, backoffMs: 1000 },
        },
        {
          id: 'shape',
          type: 'action.transform',
          name: 'Shape digest',
          position: { x: 700, y: 160 },
          config: {
            code: `const body = items[0] && items[0].json && items[0].json.http ? items[0].json.http.body : {}
const open = Number(body.open || 0)
const won = Number(body.wonThisWeek || 0)
const stalled = Number(body.stalled || 0)
return [{ json: { open, won, stalled, sentFor: items[0] && items[0].json ? items[0].json.firedAt : '' } }]
`,
          },
        },
        {
          id: 'mail',
          type: 'action.email',
          name: 'Mail partners',
          position: { x: 1020, y: 160 },
          credentialName: 'Harbor Lane mail',
          config: {
            to: 'partners@harborlane.com',
            subject: 'Pipeline for the morning',
            text: 'Open: {{ $json.open }}\nWon this week: {{ $json.won }}\nStalled: {{ $json.stalled }}\n',
          },
        },
      ],
      edges: [
        { id: 'd1', source: 'clock', target: 'fetch' },
        { id: 'd2', source: 'fetch', target: 'shape' },
        { id: 'd3', source: 'shape', target: 'mail' },
      ],
    },
  },
  {
    id: 'telegram-desk',
    name: 'Telegram intake desk',
    summary: 'Classify an on-call Telegram message and either reply in chat or escalate by email.',
    description:
      'Messages that hit the bot webhook are classified as billing, access, or other. Billing stays in Telegram. Access issues and anything unclear are emailed to the on-call producer. Without a model key the classify step is skipped and the message escalates.',
    category: 'Support',
    graph: {
      nodes: [
        {
          id: 'in',
          type: 'trigger.telegram',
          name: 'On-call bot',
          position: { x: 40, y: 180 },
          config: { path: 'oncall-desk' },
        },
        {
          id: 'cls',
          type: 'ai.classify',
          name: 'Classify intent',
          position: { x: 360, y: 180 },
          config: {
            text: '{{ $json.text }}',
            categories: ['billing', 'access', 'other'],
            model: 'gpt-4o-mini',
          },
          onError: 'continue',
        },
        {
          id: 'branch',
          type: 'action.condition',
          name: 'Billing only',
          position: { x: 680, y: 180 },
          config: { expression: '$json.ai && $json.ai.category === "billing"' },
        },
        {
          id: 'reply',
          type: 'action.telegram',
          name: 'Reply in chat',
          position: { x: 1000, y: 40 },
          credentialName: 'On-call bot',
          config: {
            chatId: '{{ $json.chatId }}',
            text: 'Received. Billing questions are handled in this chat within the hour.',
            parseMode: '',
          },
        },
        {
          id: 'escalate',
          type: 'action.email',
          name: 'Escalate to on-call',
          position: { x: 1000, y: 320 },
          credentialName: 'Harbor Lane mail',
          config: {
            to: 'oncall@harborlane.com',
            subject: 'Telegram intake needs a person',
            text: 'From chat {{ $json.chatId }}:\n{{ $json.text }}\n',
          },
        },
      ],
      edges: [
        { id: 't1', source: 'in', target: 'cls' },
        { id: 't2', source: 'cls', target: 'branch' },
        { id: 't3', source: 'branch', target: 'reply', sourceHandle: 'true' },
        { id: 't4', source: 'branch', target: 'escalate', sourceHandle: 'false' },
      ],
    },
  },
  {
    id: 'sheet-to-accounts',
    name: 'Sheet rows to accounts',
    summary: 'Take new rows from a sheet or CSV and insert them into PostgreSQL.',
    description:
      'Use a Google Sheets API key when the sheet is live. Until then, paste a CSV into the trigger. Each new row is looped, lightly cleaned, and written with a single INSERT.',
    category: 'Data',
    graph: {
      nodes: [
        {
          id: 'rows',
          type: 'trigger.sheets',
          name: 'Account rows',
          position: { x: 40, y: 160 },
          credentialName: 'Sheets key',
          config: {
            mode: 'csv',
            spreadsheetId: '',
            range: 'Accounts!A:D',
            intervalMinutes: 30,
            csvText:
              'email,plan,seats\namina.rahman@fieldnote.io,studio,12\njonas.berg@northpier.com,atlas,40\n',
          },
        },
        {
          id: 'each',
          type: 'action.loop',
          name: 'Each row',
          position: { x: 360, y: 160 },
          config: { batchSize: 1 },
        },
        {
          id: 'clean',
          type: 'action.transform',
          name: 'Clean row',
          position: { x: 680, y: 40 },
          config: {
            code: `return items.map((item) => ({\n  json: {\n    email: String(item.json.email || '').trim().toLowerCase(),\n    plan: String(item.json.plan || 'studio').trim().toLowerCase(),\n    seats: Number(item.json.seats || 1),\n  },\n}))\n`,
          },
        },
        {
          id: 'write',
          type: 'action.postgres',
          name: 'Insert account',
          position: { x: 1000, y: 260 },
          credentialName: 'Accounts database',
          config: {
            sql: 'INSERT INTO accounts (email, plan, seats) VALUES ($1, $2, $3)',
            params: ['{{ $json.email }}', '{{ $json.plan }}', '{{ $json.seats }}'],
          },
        },
      ],
      edges: [
        { id: 's1', source: 'rows', target: 'each' },
        { id: 's2', source: 'each', target: 'clean', sourceHandle: 'each' },
        { id: 's3', source: 'each', target: 'write', sourceHandle: 'done' },
      ],
    },
  },
  {
    id: 'failure-notice',
    name: 'Failure notice',
    summary: 'Receive a failed run and post a short note to Telegram.',
    description:
      'Point another workflow at this one as its error workflow. FlowPilot sends the failed node, the message, and the execution id. This workflow posts that payload to the operations channel.',
    category: 'Reliability',
    graph: {
      nodes: [
        {
          id: 'fail',
          type: 'trigger.manual',
          name: 'Failure payload',
          position: { x: 80, y: 160 },
          config: {},
        },
        {
          id: 'ping',
          type: 'action.telegram',
          name: 'Notify operations',
          position: { x: 420, y: 160 },
          credentialName: 'Ops channel bot',
          config: {
            chatId: '',
            text: 'Run failed in {{ $json.workflowName }} at {{ $json.nodeName }}: {{ $json.error }}',
            parseMode: '',
          },
        },
      ],
      edges: [{ id: 'f1', source: 'fail', target: 'ping' }],
    },
  },
];

export function getTemplate(id: string): WorkflowTemplate | undefined {
  return WORKFLOW_TEMPLATES.find((template) => template.id === id);
}
