import { Outlet, NavLink } from 'react-router-dom';
import { Card } from '../../components/ui/card.js';
import { cn } from '../../lib/utils/cn.js';
import { useCapabilities } from '../../lib/permissions/useCapabilities.js';

const ITEMS: Array<{ to: string; label: string; desc: string }> = [
  { to: '/catalog/products', label: 'Products', desc: 'Manage products, variants, images' },
  { to: '/catalog/categories', label: 'Categories', desc: 'Structure and sorting' },
  { to: '/catalog/brands', label: 'Brands', desc: 'Brand list and logos' }
];

export function CatalogLayout() {
  const { can } = useCapabilities();
  const isCatalogAdmin = can('catalog');

  const items = isCatalogAdmin ? ITEMS : ITEMS.filter((i) => i.to === '/catalog/products');

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <div className="text-sm font-semibold">Catalog</div>
            <div className="mt-1 text-xs text-muted-foreground">
              {isCatalogAdmin ? 'Product structure and merchandising controls.' : 'Products are read-only for Employee accounts.'}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {items.map((i) => (
              <NavLink
                key={i.to}
                to={i.to}
                className={({ isActive }) =>
                  cn(
                    'rounded-md border px-3 py-2 text-xs transition-colors',
                    'bg-card hover:bg-muted/40',
                    isActive ? 'border-primary/40 bg-muted/40 text-foreground' : 'border-border text-muted-foreground'
                  )
                }
              >
                <div className="font-medium">{i.label}</div>
                <div className="mt-0.5 hidden text-[11px] opacity-80 md:block">{i.desc}</div>
              </NavLink>
            ))}
          </div>
        </div>
      </Card>

      <Outlet />
    </div>
  );
}
