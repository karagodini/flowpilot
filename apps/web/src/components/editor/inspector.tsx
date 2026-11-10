import { credentialTypeFor, getNodeDefinition } from '@flowpilot/shared';
import type { CredentialRow, ExecutionStep } from '@/lib/types';
import { JsonView } from '@/components/json-view';
import { Button, Input, Label, Textarea, Toggle } from '@/components/ui';
import type { StepData } from './nodes';

export function Inspector({
  data,
  credentials,
  step,
  onChange,
  onDelete,
}: {
  data: StepData | null;
  credentials: CredentialRow[];
  step?: ExecutionStep;
  onChange: (patch: Partial<StepData>) => void;
  onDelete: () => void;
}) {
  if (!data) {
    return (
      <div className="p-5 text-sm leading-6 text-mist">
        Select a step to edit its settings, or add one from the palette. Connections leave from the
        right side of a card.
      </div>
    );
  }
  const definition = getNodeDefinition(data.nodeType);
  const credentialType = credentialTypeFor(data.nodeType);
  const matching = credentials.filter((credential) => credential.type === credentialType);
  const config = data.config;

  function setConfig(patch: Record<string, unknown>) {
    onChange({ config: { ...config, ...patch } });
  }

  return (
    <div className="space-y-4 p-4">
      <div>
        <div className="text-[11px] uppercase tracking-[0.16em] text-mist">{definition?.group}</div>
        <h2 className="mt-1 text-lg text-white">{definition?.title}</h2>
        <p className="mt-1 text-sm leading-5 text-mist">{definition?.description}</p>
      </div>
      <div>
        <Label>Name</Label>
        <Input value={data.name} onChange={(event) => onChange({ name: event.target.value })} />
      </div>
      <Fields type={data.nodeType} config={config} setConfig={setConfig} />
      {credentialType ? (
        <div>
          <Label>Credential</Label>
          <select
            className="h-10 w-full rounded-xl border border-line bg-ink-950/70 px-3 text-sm"
            value={data.credentialId ?? ''}
            onChange={(event) => {
              const credential = matching.find((entry) => entry.id === event.target.value);
              onChange({
                credentialId: credential?.id ?? null,
                credentialName: credential?.name ?? null,
              });
            }}
          >
            <option value="">None</option>
            {matching.map((credential) => (
              <option key={credential.id} value={credential.id}>
                {credential.name}
              </option>
            ))}
          </select>
          {matching.length === 0 ? (
            <p className="mt-1 text-xs text-mist">
              Add a {credentialType.replace('_', ' ')} credential in the vault.
            </p>
          ) : null}
        </div>
      ) : null}
      {!data.nodeType.startsWith('trigger.') ? (
        <>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label>Attempts</Label>
              <Input
                type="number"
                min={1}
                max={8}
                value={data.retry?.maxAttempts ?? 1}
                onChange={(event) =>
                  onChange({
                    retry: {
                      maxAttempts: Number(event.target.value),
                      backoffMs: data.retry?.backoffMs ?? 500,
                    },
                  })
                }
              />
            </div>
            <div>
              <Label>Backoff ms</Label>
              <Input
                type="number"
                min={0}
                value={data.retry?.backoffMs ?? 0}
                onChange={(event) =>
                  onChange({
                    retry: {
                      maxAttempts: data.retry?.maxAttempts ?? 1,
                      backoffMs: Number(event.target.value),
                    },
                  })
                }
              />
            </div>
          </div>
          <div>
            <Label>When this step fails</Label>
            <select
              className="h-10 w-full rounded-xl border border-line bg-ink-950/70 px-3 text-sm"
              value={data.onError ?? 'stop'}
              onChange={(event) => onChange({ onError: event.target.value as StepData['onError'] })}
            >
              <option value="stop">Stop the run</option>
              <option value="continue">Continue with the incoming items</option>
              <option value="errorWorkflow">Stop and start the error workflow</option>
            </select>
          </div>
          <Toggle
            checked={Boolean(data.disabled)}
            onCheckedChange={(disabled) => onChange({ disabled })}
            label="Turn this step off"
          />
        </>
      ) : null}
      {step ? (
        <div className="space-y-2 border-t border-line pt-4">
          <div className="text-sm text-white">Last run · {step.status}</div>
          {step.error ? <p className="text-sm text-rose-200">{step.error}</p> : null}
          {step.warnings?.map((warning) => (
            <p key={warning} className="text-sm text-amber-200">
              {warning}
            </p>
          ))}
          <JsonView value={step.output} />
        </div>
      ) : null}
      <Button variant="danger" type="button" onClick={onDelete}>
        Remove step
      </Button>
      <p className="text-[11px] leading-5 text-mist">
        Fields accept {'{{ $json.field }}'} and {'{{ $node["Step name"].json.field }}'}. A field
        that is only {'={{ expression }}'} is evaluated as JavaScript.
      </p>
    </div>
  );
}

function Fields({
  type,
  config,
  setConfig,
}: {
  type: string;
  config: Record<string, unknown>;
  setConfig: (patch: Record<string, unknown>) => void;
}) {
  if (type === 'trigger.webhook') {
    return (
      <>
        <Field
          label="Path"
          value={String(config.path ?? '')}
          onChange={(path) => setConfig({ path })}
        />
        <SelectField
          label="Method"
          value={String(config.method ?? 'POST')}
          options={['POST', 'GET', 'PUT', 'ANY']}
          onChange={(method) => setConfig({ method })}
        />
      </>
    );
  }
  if (type === 'trigger.telegram')
    return (
      <Field
        label="Path"
        value={String(config.path ?? '')}
        onChange={(path) => setConfig({ path })}
      />
    );
  if (type === 'trigger.cron') {
    return (
      <>
        <Field
          label="Cron"
          value={String(config.cron ?? '')}
          onChange={(cron) => setConfig({ cron })}
        />
        <Field
          label="Timezone"
          value={String(config.timezone ?? 'UTC')}
          onChange={(timezone) => setConfig({ timezone })}
        />
      </>
    );
  }
  if (type === 'trigger.sheets') {
    return (
      <>
        <SelectField
          label="Source"
          value={String(config.mode ?? 'csv')}
          options={['csv', 'api']}
          onChange={(mode) => setConfig({ mode })}
        />
        {config.mode === 'api' ? (
          <>
            <Field
              label="Spreadsheet id"
              value={String(config.spreadsheetId ?? '')}
              onChange={(spreadsheetId) => setConfig({ spreadsheetId })}
            />
            <Field
              label="Range"
              value={String(config.range ?? '')}
              onChange={(range) => setConfig({ range })}
            />
          </>
        ) : (
          <Area
            label="CSV"
            value={String(config.csvText ?? '')}
            onChange={(csvText) => setConfig({ csvText })}
            mono
          />
        )}
        <Field
          label="Poll every (minutes)"
          value={String(config.intervalMinutes ?? 15)}
          onChange={(intervalMinutes) => setConfig({ intervalMinutes: Number(intervalMinutes) })}
        />
      </>
    );
  }
  if (type === 'action.http') {
    return (
      <>
        <SelectField
          label="Method"
          value={String(config.method ?? 'GET')}
          options={['GET', 'POST', 'PUT', 'PATCH', 'DELETE']}
          onChange={(method) => setConfig({ method })}
        />
        <Field
          label="URL"
          value={String(config.url ?? '')}
          onChange={(url) => setConfig({ url })}
        />
        <Area
          label="JSON body"
          value={
            typeof config.body === 'string'
              ? config.body
              : JSON.stringify(config.body ?? '', null, 2)
          }
          onChange={(body) => setConfig({ body })}
          mono
        />
        <Field
          label="Timeout ms"
          value={String(config.timeoutMs ?? 15000)}
          onChange={(timeoutMs) => setConfig({ timeoutMs: Number(timeoutMs) })}
        />
      </>
    );
  }
  if (type === 'action.transform')
    return (
      <Area
        label="JavaScript"
        value={String(config.code ?? '')}
        onChange={(code) => setConfig({ code })}
        mono
        rows={14}
      />
    );
  if (type === 'action.condition')
    return (
      <Area
        label="Expression"
        value={String(config.expression ?? '')}
        onChange={(expression) => setConfig({ expression })}
        mono
      />
    );
  if (type === 'action.loop')
    return (
      <Field
        label="Batch size"
        value={String(config.batchSize ?? 1)}
        onChange={(batchSize) => setConfig({ batchSize: Number(batchSize) })}
      />
    );
  if (type === 'action.delay')
    return (
      <Field
        label="Milliseconds"
        value={String(config.ms ?? 1000)}
        onChange={(ms) => setConfig({ ms: Number(ms) })}
      />
    );
  if (type === 'action.telegram') {
    return (
      <>
        <Field
          label="Chat id"
          value={String(config.chatId ?? '')}
          onChange={(chatId) => setConfig({ chatId })}
        />
        <Area
          label="Message"
          value={String(config.text ?? '')}
          onChange={(text) => setConfig({ text })}
        />
      </>
    );
  }
  if (type === 'action.email') {
    return (
      <>
        <Field label="To" value={String(config.to ?? '')} onChange={(to) => setConfig({ to })} />
        <Field
          label="Subject"
          value={String(config.subject ?? '')}
          onChange={(subject) => setConfig({ subject })}
        />
        <Area
          label="Text"
          value={String(config.text ?? '')}
          onChange={(text) => setConfig({ text })}
        />
      </>
    );
  }
  if (type === 'action.postgres') {
    const params = Array.isArray(config.params) ? config.params.map(String).join('\n') : '';
    return (
      <>
        <Area
          label="SQL"
          value={String(config.sql ?? '')}
          onChange={(sql) => setConfig({ sql })}
          mono
        />
        <Area
          label="Parameters, one per line"
          value={params}
          onChange={(value) =>
            setConfig({ params: value.split('\n').filter((line) => line.length > 0) })
          }
          mono
        />
      </>
    );
  }
  if (type === 'ai.prompt') {
    return (
      <>
        <Area
          label="System"
          value={String(config.system ?? '')}
          onChange={(system) => setConfig({ system })}
        />
        <Area
          label="Prompt"
          value={String(config.prompt ?? '')}
          onChange={(prompt) => setConfig({ prompt })}
        />
        <Field
          label="Model"
          value={String(config.model ?? 'gpt-4o-mini')}
          onChange={(model) => setConfig({ model })}
        />
      </>
    );
  }
  if (type === 'ai.classify') {
    return (
      <>
        <Area
          label="Text"
          value={String(config.text ?? '')}
          onChange={(text) => setConfig({ text })}
        />
        <Field
          label="Categories"
          value={Array.isArray(config.categories) ? config.categories.join(', ') : ''}
          onChange={(value) =>
            setConfig({
              categories: value
                .split(',')
                .map((entry) => entry.trim())
                .filter(Boolean),
            })
          }
        />
        <Field
          label="Model"
          value={String(config.model ?? 'gpt-4o-mini')}
          onChange={(model) => setConfig({ model })}
        />
      </>
    );
  }
  if (type === 'ai.extract') {
    return (
      <>
        <Area
          label="Text"
          value={String(config.text ?? '')}
          onChange={(text) => setConfig({ text })}
        />
        <Area
          label="JSON shape"
          value={String(config.schemaHint ?? '')}
          onChange={(schemaHint) => setConfig({ schemaHint })}
          mono
        />
        <Field
          label="Model"
          value={String(config.model ?? 'gpt-4o-mini')}
          onChange={(model) => setConfig({ model })}
        />
      </>
    );
  }
  return <p className="text-sm text-mist">This step uses the payload it receives.</p>;
}

function Field({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div>
      <Label>{label}</Label>
      <Input value={value} onChange={(event) => onChange(event.target.value)} />
    </div>
  );
}

function Area({
  label,
  value,
  onChange,
  mono,
  rows = 6,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  mono?: boolean;
  rows?: number;
}) {
  return (
    <div>
      <Label>{label}</Label>
      <Textarea
        rows={rows}
        className={mono ? 'font-mono text-[12px]' : undefined}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}

function SelectField({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: string[];
  onChange: (value: string) => void;
}) {
  return (
    <div>
      <Label>{label}</Label>
      <select
        className="h-10 w-full rounded-xl border border-line bg-ink-950/70 px-3 text-sm"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </div>
  );
}
