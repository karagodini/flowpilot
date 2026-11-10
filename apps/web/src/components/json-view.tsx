import { useState } from 'react';
import { Button } from './ui';

export function JsonView({ value }: { value: unknown }) {
  const [copied, setCopied] = useState(false);
  const text = JSON.stringify(value ?? null, null, 2);
  return (
    <div className="overflow-hidden rounded-2xl border border-line bg-ink-950">
      <div className="flex items-center justify-between border-b border-line px-3 py-2">
        <span className="text-[11px] uppercase tracking-[0.14em] text-mist">JSON</span>
        <Button
          variant="ghost"
          size="sm"
          type="button"
          onClick={() => {
            void navigator.clipboard.writeText(text);
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1200);
          }}
        >
          {copied ? 'Copied' : 'Copy'}
        </Button>
      </div>
      <pre className="max-h-[420px] overflow-auto p-3 font-mono text-[12px] leading-5 text-slate-200">
        <code dangerouslySetInnerHTML={{ __html: highlight(text) }} />
      </pre>
    </div>
  );
}

function highlight(text: string): string {
  const escaped = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return escaped.replace(
    /("(?:\\.|[^"\\])*")\s*:|("(?:\\.|[^"\\])*")|\b(-?\d+(?:\.\d+)?)\b|\b(true|false|null)\b/g,
    (
      full: string,
      key: string | undefined,
      str: string | undefined,
      num: string | undefined,
      literal: string | undefined,
    ) => {
      if (key) return `<span class="json-key">${key}</span>:`;
      if (str) return `<span class="json-string">${str}</span>`;
      if (num) return `<span class="json-number">${num}</span>`;
      if (literal) return `<span class="json-literal">${literal}</span>`;
      return full;
    },
  );
}
