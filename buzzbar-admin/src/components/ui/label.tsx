import * as React from 'react';
import { cn } from '../../lib/utils/cn.js';

export function Label(props: React.LabelHTMLAttributes<HTMLLabelElement>) {
  const { className, ...rest } = props;
  return <label className={cn('text-sm font-medium leading-none', className)} {...rest} />;
}

