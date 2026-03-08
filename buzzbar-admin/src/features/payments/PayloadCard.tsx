import { Copy } from 'lucide-react';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '../../components/ui/button.js';
import { Card } from '../../components/ui/card.js';

function stringifyPayload(value: unknown) {
  try {
    return JSON.stringify(value ?? null, null, 2);
  } catch {
    return String(value);
  }
}

export function PayloadCard(props: { title: string; subtitle?: string; payload: unknown }) {
  const [expanded, setExpanded] = useState(false);
  const text = useMemo(() => stringifyPayload(props.payload), [props.payload]);
  const preview = expanded ? text : text.slice(0, 1800);
  const truncated = !expanded && text.length > preview.length;

  return (
    <Card className="border-white/10 bg-black/20 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-xs uppercase tracking-[0.22em] text-muted-foreground">{props.title}</div>
          {props.subtitle ? <div className="mt-1 text-xs text-muted-foreground">{props.subtitle}</div> : null}
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(text);
              toast.success(`${props.title} copied`);
            } catch {
              toast.error('Copy failed');
            }
          }}
        >
          <Copy className="mr-2 h-4 w-4" />
          Copy
        </Button>
      </div>
      <pre className="mt-3 max-h-[26rem] overflow-auto rounded-xl bg-black/30 p-3 text-xs leading-6 text-muted-foreground">{preview}</pre>
      {truncated ? (
        <div className="mt-3">
          <Button variant="secondary" size="sm" onClick={() => setExpanded(true)}>
            Expand payload
          </Button>
        </div>
      ) : null}
      {expanded && text.length > 1800 ? (
        <div className="mt-3">
          <Button variant="ghost" size="sm" onClick={() => setExpanded(false)}>
            Collapse
          </Button>
        </div>
      ) : null}
    </Card>
  );
}
