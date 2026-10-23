import { useQuery } from '@tanstack/react-query';
import { clsx } from 'clsx';
import { LayoutDashboard, LogOut, Megaphone, Menu, Palette, QrCode, X } from 'lucide-react';
import { Suspense, useState, type ReactNode } from 'react';
import { Navigate, NavLink, Outlet, useLocation } from 'react-router';
import { api, ApiError } from '../lib/api';
import { Spinner } from './ui';

export function useMe() {
  return useQuery({ queryKey: ['me'], queryFn: api.me, staleTime: 5 * 60_000, retry: false });
}

export function RequireAuth({ children }: { children: ReactNode }) {
  const me = useMe();
  const location = useLocation();
  if (me.isPending) return <Spinner label="Signing you in" />;
  if (me.error) {
    if (me.error instanceof ApiError && me.error.status === 401) {
      return <Navigate to={`/login?returnTo=${encodeURIComponent(`/app${location.pathname}${location.search}`)}`} replace />;
    }
    return <div className="p-8 text-sm text-danger">Could not reach QR Director: {me.error.message}</div>;
  }
  return <>{children}</>;
}

const nav = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/campaigns', label: 'Campaigns', icon: Megaphone },
  { to: '/templates', label: 'Templates', icon: Palette },
];

export function Logo() {
  return (
    <div className="flex items-center gap-2.5">
      <div className="flex size-8 items-center justify-center rounded-lg bg-accent text-accent-fg shadow-sm">
        <QrCode className="size-4.5" />
      </div>
      <span className="text-[15px] font-semibold tracking-tight text-fg">QR Director</span>
    </div>
  );
}

export function AppLayout() {
  const me = useMe();
  const [open, setOpen] = useState(false);
  const initials = (me.data?.name ?? me.data?.email ?? '?')
    .split(/[\s@.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0]!.toUpperCase())
    .join('');

  const sidebar = (
    <nav className="flex h-full flex-col gap-1 p-4" aria-label="Main">
      <div className="mb-6 px-2 pt-1">
        <Logo />
      </div>
      {nav.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.end}
          onClick={() => setOpen(false)}
          className={({ isActive }) =>
            clsx(
              'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
              isActive ? 'bg-accent-soft text-accent' : 'text-muted hover:bg-surface-2 hover:text-fg',
            )
          }
        >
          <item.icon className="size-4" />
          {item.label}
        </NavLink>
      ))}
      <div className="mt-auto border-t border-border pt-4">
        <div className="flex items-center gap-3 px-2">
          <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-surface-2 text-xs font-semibold text-fg">{initials}</div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium text-fg">{me.data?.name ?? 'Signed in'}</div>
            <div className="truncate text-xs text-muted">{me.data?.email}</div>
          </div>
          <a href="/auth/logout" className="rounded-lg p-2 text-muted hover:bg-surface-2 hover:text-fg" aria-label="Sign out" title="Sign out">
            <LogOut className="size-4" />
          </a>
        </div>
      </div>
    </nav>
  );

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[248px_1fr]">
      <aside className="sticky top-0 hidden h-screen border-r border-border bg-surface lg:block">{sidebar}</aside>
      <header className="sticky top-0 z-30 flex items-center justify-between border-b border-border bg-surface/90 px-4 py-3 backdrop-blur lg:hidden">
        <Logo />
        <button className="rounded-lg p-2 text-muted hover:bg-surface-2" onClick={() => setOpen(true)} aria-label="Open menu">
          <Menu className="size-5" />
        </button>
      </header>
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-72 bg-surface shadow-xl">
            <button className="absolute top-4 right-3 rounded-lg p-2 text-muted" onClick={() => setOpen(false)} aria-label="Close menu">
              <X className="size-5" />
            </button>
            {sidebar}
          </aside>
        </div>
      )}
      <main className="min-w-0 px-4 py-6 sm:px-6 lg:px-10 lg:py-8">
        <div className="mx-auto max-w-7xl">
          <Suspense fallback={<Spinner />}>
            <Outlet />
          </Suspense>
        </div>
      </main>
    </div>
  );
}
