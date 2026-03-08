import { NavLink } from 'react-router-dom';
import { NAV_ITEMS } from './nav.js';
import { cn } from '../lib/utils/cn.js';
import { useCapabilities } from '../lib/permissions/useCapabilities.js';

export function Sidebar() {
  const { can } = useCapabilities();

  const items = NAV_ITEMS.filter((item) => {
    if (!can(item.capability)) return false;
    if (item.to === '/catalog/products' && can('catalog')) return false;
    return true;
  });

  return (
    <aside className="sticky top-0 flex h-screen flex-col gap-4 border-r bg-card/40 p-4">
      <div className="px-2 pt-2">
        <div className="text-sm font-semibold tracking-wide text-foreground">BuzzBar</div>
        <div className="text-xs text-muted-foreground">Admin Panel</div>
      </div>

      <nav className="grid gap-1">
        {items.map((it) => (
          <NavLink
            key={it.to}
            to={it.to}
            className={({ isActive }) =>
              cn(
                'flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground',
                isActive && 'bg-muted text-foreground'
              )
            }
          >
            <it.icon className="h-4 w-4" />
            {it.label}
          </NavLink>
        ))}
      </nav>

      <div className="mt-auto rounded-lg border bg-card p-3">
        <div className="text-xs text-muted-foreground">RBAC enforced by backend</div>
      </div>
    </aside>
  );
}
