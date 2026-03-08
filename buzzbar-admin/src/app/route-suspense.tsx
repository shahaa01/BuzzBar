import { Suspense, type ReactNode } from 'react';
import { Card } from '../components/ui/card.js';
import { Skeleton } from '../components/ui/skeleton.js';

function RouteLoading() {
  return (
    <Card className="p-6">
      <div className="space-y-4">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-4 w-80" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    </Card>
  );
}

export function RouteSuspense(props: { children: ReactNode }) {
  return <Suspense fallback={<RouteLoading />}>{props.children}</Suspense>;
}
