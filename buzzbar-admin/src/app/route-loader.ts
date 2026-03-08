import { lazy, type ComponentType } from 'react';

export function loadNamedPage<TName extends string>(
  loader: () => Promise<Record<TName, ComponentType<object>>>,
  key: TName
) {
  return lazy(async () => {
    const mod = await loader();
    return { default: mod[key] };
  });
}
