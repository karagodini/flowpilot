import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Page } from '@/components/shell';
import { Button, Input, Label, Modal } from '@/components/ui';
import { ApiError, api } from '@/lib/api';
import type { CredentialRow } from '@/lib/types';

const types = [
  { id: 'telegram', label: 'Telegram bot' },
  { id: 'smtp', label: 'SMTP' },
  { id: 'postgres', label: 'PostgreSQL' },
  { id: 'openai', label: 'OpenAI-compatible' },
  { id: 'google_sheets', label: 'Google Sheets' },
  { id: 'http', label: 'HTTP header' },
];

export function CredentialsPage() {
  const queryClient = useQueryClient();
  const credentials = useQuery({
    queryKey: ['credentials'],
    queryFn: () => api<{ credentials: CredentialRow[] }>('/api/credentials'),
  });
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const remove = useMutation({
    mutationFn: (id: string) => api(`/api/credentials/${id}`, { method: 'DELETE' }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['credentials'] }),
  });

  return (
    <Page
      title="Credentials"
      lede="Secrets stay encrypted in the vault. FlowPilot can use them on a step, and it never sends them back to the browser."
      action={
        <Button type="button" onClick={() => setOpen(true)}>
          Add credential
        </Button>
      }
    >
      <div className="space-y-3">
        {credentials.data?.credentials.length === 0 ? (
          <p className="text-sm text-mist">The vault is empty.</p>
        ) : null}
        {credentials.data?.credentials.map((credential) => (
          <div
            key={credential.id}
            className="flex flex-wrap items-center justify-between gap-3 rounded-3xl border border-line bg-ink-900 px-5 py-4"
          >
            <div>
              <div className="text-white">{credential.name}</div>
              <div className="text-sm text-mist">
                {types.find((type) => type.id === credential.type)?.label} · {credential.preview}
              </div>
            </div>
            <Button
              variant="danger"
              size="sm"
              type="button"
              onClick={() => remove.mutate(credential.id)}
            >
              Remove
            </Button>
          </div>
        ))}
      </div>
      <Modal
        open={open}
        onOpenChange={setOpen}
        title="Add credential"
        description="Choose the service, then enter only what that step needs."
      >
        <form
          className="space-y-3"
          onSubmit={async (event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            const type = String(form.get('type'));
            const data: Record<string, unknown> = {};
            for (const [key, value] of form.entries()) {
              if (key === 'name' || key === 'type') continue;
              data[key] =
                key === 'port' ? Number(value) : key === 'secure' ? value === 'on' : value;
            }
            try {
              await api('/api/credentials', {
                method: 'POST',
                body: JSON.stringify({ name: form.get('name'), type, data }),
              });
              setError(null);
              setOpen(false);
              await queryClient.invalidateQueries({ queryKey: ['credentials'] });
            } catch (caught) {
              setError(
                caught instanceof ApiError ? caught.message : 'Could not save the credential.',
              );
            }
          }}
        >
          <div>
            <Label>Name</Label>
            <Input name="name" required />
          </div>
          <CredentialFields />
          {error ? <p className="text-sm text-rose-200">{error}</p> : null}
          <Button type="submit">Save in the vault</Button>
        </form>
      </Modal>
    </Page>
  );
}

function CredentialFields() {
  const [type, setType] = useState('telegram');
  return (
    <>
      <div>
        <Label>Type</Label>
        <select
          name="type"
          className="h-10 w-full rounded-xl border border-line bg-ink-950 px-3 text-sm"
          value={type}
          onChange={(event) => setType(event.target.value)}
        >
          {types.map((entry) => (
            <option key={entry.id} value={entry.id}>
              {entry.label}
            </option>
          ))}
        </select>
      </div>
      {type === 'telegram' ? <Field name="botToken" label="Bot token" /> : null}
      {type === 'smtp' ? (
        <>
          <Field name="host" label="Host" />
          <Field name="port" label="Port" defaultValue="587" />
          <Field name="username" label="Username" />
          <Field name="password" label="Password" secret />
          <Field name="from" label="From" />
        </>
      ) : null}
      {type === 'postgres' ? <Field name="connectionString" label="Connection string" /> : null}
      {type === 'openai' ? (
        <>
          <Field name="apiKey" label="API key" secret />
          <Field name="baseUrl" label="Base URL" defaultValue="https://api.openai.com/v1" />
        </>
      ) : null}
      {type === 'google_sheets' ? <Field name="apiKey" label="API key" secret /> : null}
      {type === 'http' ? (
        <>
          <Field name="headerName" label="Header name" defaultValue="Authorization" />
          <Field name="headerValue" label="Header value" secret />
        </>
      ) : null}
    </>
  );
}

function Field({
  name,
  label,
  secret,
  defaultValue,
}: {
  name: string;
  label: string;
  secret?: boolean;
  defaultValue?: string;
}) {
  return (
    <div>
      <Label>{label}</Label>
      <Input
        name={name}
        type={secret ? 'password' : 'text'}
        required
        defaultValue={defaultValue}
        autoComplete="off"
      />
    </div>
  );
}
