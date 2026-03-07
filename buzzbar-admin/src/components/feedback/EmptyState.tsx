import { Button } from '../ui/button.js';
import { Card } from '../ui/card.js';

export function EmptyState(props: { title: string; description?: string; actionLabel?: string; onAction?: () => void }) {
  return (
    <Card className="flex flex-col gap-3 p-6">
      <div>
        <div className="text-sm font-semibold">{props.title}</div>
        {props.description ? <div className="mt-1 text-sm text-muted-foreground">{props.description}</div> : null}
      </div>
      {props.actionLabel && props.onAction ? (
        <div>
          <Button onClick={props.onAction}>{props.actionLabel}</Button>
        </div>
      ) : null}
    </Card>
  );
}

