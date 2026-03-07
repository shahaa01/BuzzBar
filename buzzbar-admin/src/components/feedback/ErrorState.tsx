import type { ApiErrorShape } from '../../lib/api/normalizeError.js';
import { Card } from '../ui/card.js';
import { Button } from '../ui/button.js';

export function ErrorState(props: { error: ApiErrorShape; onRetry?: () => void }) {
  const { error } = props;
  return (
    <Card className="p-6">
      <div className="text-sm font-semibold">Something went wrong</div>
      <div className="mt-1 text-sm text-muted-foreground">{error.message}</div>
      <div className="mt-3 grid gap-1 text-xs text-muted-foreground">
        {error.errorCode ? <div>Error code: {error.errorCode}</div> : null}
        {error.requestId ? <div>Request ID: {error.requestId}</div> : null}
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

