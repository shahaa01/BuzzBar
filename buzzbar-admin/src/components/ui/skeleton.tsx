import { cn } from '../../lib/utils/cn.js';

export function Skeleton(props: { className?: string }) {
  return <div className={cn('animate-pulse rounded-md bg-muted/70', props.className)} />;
}

