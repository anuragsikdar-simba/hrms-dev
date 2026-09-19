import { Skeleton } from '@/components/ui/skeleton';

/**
 * Full-app placeholder shown while the auth session resolves.
 *
 * Previously this moment rendered a centred spinner on an empty screen, so a
 * refresh flashed the whole layout away and then rebuilt it — the sidebar
 * visibly appeared late. Painting the real chrome (same grid, same
 * `--sidebar-w` / `--topbar-h` tokens as DashboardLayout) means the frame is
 * already in its final position when the session lands; only the content
 * inside it changes.
 *
 * Geometry MUST stay in sync with `src/components/layout/dashboard-layout.tsx`.
 */
export function AppShellSkeleton() {
  return (
    <div
      className="grid h-screen bg-[var(--bg)] grid-cols-1 grid-rows-[var(--topbar-h)_1fr] lg:grid-cols-[var(--sidebar-w)_1fr]"
      aria-busy="true"
      aria-label="Loading August HRMS"
    >
      {/* Sidebar */}
      <aside
        className="hidden flex-col border-r border-[var(--border)] bg-white lg:flex"
        style={{ gridRow: '1 / 3' }}
      >
        {/* Brand */}
        <div className="flex items-center gap-2.5 border-b border-[var(--border)] px-4 py-3.5">
          <Skeleton className="h-[26px] w-[26px] shrink-0 rounded-md" />
          <div className="min-w-0 space-y-1.5">
            <Skeleton className="h-3 w-16" />
            <Skeleton className="h-2 w-20" />
          </div>
        </div>

        {/* Nav */}
        <div className="flex-1 px-3 py-4">
          <Skeleton className="mb-3 ml-1 h-2.5 w-24" />
          <div className="space-y-1.5">
            {Array.from({ length: 10 }, (_, i) => (
              <div key={i} className="flex items-center gap-2.5 rounded-md px-2 py-2">
                <Skeleton className="h-4 w-4 shrink-0 rounded" />
                <Skeleton className="h-3.5" style={{ width: `${52 + ((i * 13) % 40)}%` }} />
              </div>
            ))}
          </div>
        </div>

        {/* Account */}
        <div className="flex items-center gap-2.5 border-t border-[var(--border)] px-4 py-3">
          <Skeleton className="h-8 w-8 shrink-0 rounded-full" />
          <div className="min-w-0 flex-1 space-y-1.5">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-2 w-12" />
          </div>
        </div>
      </aside>

      {/* Topbar */}
      <header className="flex items-center gap-3 border-b border-[var(--border)] bg-white px-4 lg:px-6">
        <Skeleton className="h-5 w-5 rounded lg:hidden" />
        <Skeleton className="h-3.5 w-20" />
        <Skeleton className="ml-auto h-8 w-full max-w-[280px] rounded-md" />
        <Skeleton className="h-8 w-8 shrink-0 rounded-full" />
      </header>

      {/* Content */}
      <main className="overflow-hidden px-6 py-5">
        <div className="space-y-2">
          <Skeleton className="h-7 w-56" />
          <Skeleton className="h-4 w-80 max-w-full" />
        </div>
        <div className="mt-6 grid gap-4 lg:grid-cols-3">
          <div className="space-y-4 lg:col-span-2">
            <Skeleton className="h-[132px] w-full rounded-lg" />
            <Skeleton className="h-[188px] w-full rounded-lg" />
          </div>
          <div className="space-y-4">
            <Skeleton className="h-[132px] w-full rounded-lg" />
            <Skeleton className="h-[188px] w-full rounded-lg" />
          </div>
        </div>
      </main>
    </div>
  );
}
