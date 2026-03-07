import { Outlet, useMatches } from 'react-router-dom';
import { Sidebar } from '../routes/Sidebar.js';
import { Header } from '../routes/Header.js';

export function AppShellLayout() {
  const matches = useMatches();
  const last = matches[matches.length - 1];
  const handle = (last as { handle?: unknown } | undefined)?.handle as { title?: unknown } | undefined;
  const title = typeof handle?.title === 'string' ? handle.title : 'BuzzBar Admin';

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto grid min-h-screen max-w-[1600px] grid-cols-[260px_1fr]">
        <Sidebar />
        <div className="flex min-w-0 flex-col">
          <Header title={title} />
          <main className="min-w-0 flex-1 p-6">
            <Outlet />
          </main>
        </div>
      </div>
    </div>
  );
}
