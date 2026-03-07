import { ChevronDown, LogOut } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../features/auth/auth.store.js';
import { getStoredAdminProfile } from '../lib/auth/storage.js';
import { Button } from '../components/ui/button.js';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '../components/ui/dropdown-menu.js';

export function Header(props: { title: string }) {
  const navigate = useNavigate();
  const role = useAuthStore((s) => s.claims?.role);
  const logout = useAuthStore((s) => s.logout);
  const profile = getStoredAdminProfile();

  return (
    <header className="sticky top-0 z-10 flex items-center justify-between border-b bg-background/70 px-6 py-4 backdrop-blur">
      <div className="min-w-0">
        <h1 className="truncate text-lg font-semibold">{props.title}</h1>
        <p className="text-xs text-muted-foreground">Calm under pressure. Move decisively.</p>
      </div>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="secondary" className="gap-2">
            <span className="max-w-[240px] truncate">
              {profile?.email ?? 'Admin'}{role ? ` · ${role}` : ''}
            </span>
            <ChevronDown className="h-4 w-4 opacity-70" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuItem
            onClick={async () => {
              await logout();
              navigate('/login', { replace: true });
            }}
          >
            <LogOut className="mr-2 h-4 w-4" />
            Logout
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </header>
  );
}

