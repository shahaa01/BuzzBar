import type { ApiErrorShape } from '../../lib/api/normalizeError.js';
import { toast } from 'sonner';
import { Card } from '../ui/card.js';
import { Button } from '../ui/button.js';
import { Copy } from 'lucide-react';

export function ErrorState(props: { error: ApiErrorShape; onRetry?: () => void }) {
  const { error } = props;

  async function copy(label: string, value: string) {
    try {
      await navigator.clipboard.writeText(value);
      toast.success(`${label} copied`);
    } catch {
      toast.error('Copy failed');
    }
  }

  return (
    <Card className="p-6">
      <div className="text-sm font-semibold">Something went wrong</div>
      <div className="mt-1 text-sm text-muted-foreground">{error.message}</div>
      <div className="mt-3 grid gap-2 text-xs text-muted-foreground">
        {error.errorCode ? (
          <div className="flex items-center justify-between gap-3 rounded-md border bg-muted/20 px-3 py-2">
            <div className="min-w-0">
              <div className="text-[11px] uppercase tracking-wide opacity-80">Error code</div>
              <div className="mt-0.5 font-mono text-xs text-foreground">{error.errorCode}</div>
            </div>
            <Button type="button" size="sm" variant="ghost" onClick={() => copy('Error code', error.errorCode!)}>
              <Copy className="mr-2 h-4 w-4" />
              Copy
            </Button>
          </div>
        ) : null}
        {error.requestId ? (
          <div className="flex items-center justify-between gap-3 rounded-md border bg-muted/20 px-3 py-2">
            <div className="min-w-0">
              <div className="text-[11px] uppercase tracking-wide opacity-80">Request ID</div>
              <div className="mt-0.5 font-mono text-xs text-foreground">{error.requestId}</div>
            </div>
            <Button type="button" size="sm" variant="ghost" onClick={() => copy('Request ID', error.requestId!)}>
              <Copy className="mr-2 h-4 w-4" />
              Copy
            </Button>
          </div>
        ) : null}
      </div>
      {props.onRetry ? (
        <div className="mt-4">
          <Button onClick={props.onRetry} variant="secondary">
            Retry
          </Button>
        </div>
      ) : null}
    </Card>
  );
}
