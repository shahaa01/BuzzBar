import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../../lib/utils/cn.js';
import type React from 'react';

const badgeVariants = cva(
  'inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium transition-colors',
  {
    variants: {
      variant: {
        default: 'border-transparent bg-muted text-foreground',
        success: 'border-transparent bg-success text-success-foreground',
        warning: 'border-transparent bg-primary/20 text-foreground',
        destructive: 'border-transparent bg-destructive text-destructive-foreground'
      }
    },
    defaultVariants: { variant: 'default' }
  }
);

export function Badge(props: React.HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>) {
  const { className, variant, ...rest } = props;
  return <span className={cn(badgeVariants({ variant }), className)} {...rest} />;
}
