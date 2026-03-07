import * as React from 'react';
import { cn } from '../../lib/utils/cn.js';

export function Separator(props: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('h-px w-full bg-border', props.className)} {...props} />;
}

