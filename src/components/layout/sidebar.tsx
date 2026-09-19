'use client';

import { useCallback, useMemo, useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Home,
  Clock,
  CalendarDays,
  Inbox,
  Users,
  UserPlus,
  FileText,
  MessageSquare,
  Settings,
  LogOut,
  X,
  User,
  BarChart3,
  Wallet,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuth } from '@/contexts/AuthContext';
import { getInitials } from '@/components/ui/avatar';
import api from '@/lib/api-client';

// -------------------------------------------------------
// Navigation config
// -------------------------------------------------------

interface NavItem {
  label: string;
  href: string;
  icon: React.ElementType;
  badge?: string;
}

interface NavSection {
  title: string;
  items: NavItem[];
}

const adminSections = (badges: { approvals?: number; onboarding?: number }): NavSection[] => [
  {
    title: 'Administration',
    items: [
      { label: 'Dashboard', href: '/dashboard', icon: Home },
      { label: 'Attendance', href: '/attendance', icon: Clock },
      { label: 'Leave', href: '/leaves', icon: CalendarDays },
      { label: 'Payroll', href: '/payroll', icon: Wallet },
      { label: 'Approvals', href: '/approvals', icon: Inbox, badge: badges.approvals ? String(badges.approvals) : undefined },
      { label: 'Employees', href: '/employees', icon: Users },
      { label: 'Team Insights', href: '/team-insights', icon: BarChart3 },
      { label: 'Onboarding', href: '/onboarding', icon: UserPlus, badge: badges.onboarding ? String(badges.onboarding) : undefined },
      { label: 'Documents', href: '/documents', icon: FileText },
      { label: 'Audit log', href: '/audit-log', icon: MessageSquare },
      { label: 'Settings', href: '/settings', icon: Settings },
    ],
  },
];

const employeeSections = (onboardingVisible: boolean, submitted?: boolean): NavSection[] => [
  {
    title: 'My space',
    items: [
      { label: 'Dashboard', href: '/dashboard', icon: Home },
      { label: 'Attendance', href: '/attendance', icon: Clock },
      { label: 'Leave', href: '/leaves', icon: CalendarDays },
      { label: 'My payslips', href: '/payslips', icon: Wallet },
      ...(onboardingVisible
        ? [{ label: 'Onboarding', href: '/onboarding', icon: UserPlus, badge: submitted ? '✓' : '!' }]
        : []),
      { label: 'My documents', href: '/documents', icon: FileText },
      { label: 'Profile', href: '/profile', icon: User },
    ],
  },
];

// -------------------------------------------------------
// Avatar gradient helper
// -------------------------------------------------------

const AVATAR_GRADIENTS = [
  'from-violet-500 to-purple-600',
  'from-sky-500 to-blue-600',
  'from-emerald-500 to-teal-600',
  'from-orange-400 to-rose-500',
  'from-pink-500 to-fuchsia-600',
];

function avatarGradient(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return AVATAR_GRADIENTS[Math.abs(hash) % AVATAR_GRADIENTS.length];
}

// -------------------------------------------------------
// Sidebar component
// -------------------------------------------------------

interface SidebarProps {
  open: boolean;
  onClose: () => void;
}

export function Sidebar({ open, onClose }: SidebarProps) {
  const pathname = usePathname();
  const { userProfile, isAdmin, logout } = useAuth();
  const [badgeCounts, setBadgeCounts] = useState<{ approvals: number; onboarding: number }>({ approvals: 0, onboarding: 0 });

  // Fetch live badge counts for admin
  useEffect(() => {
    if (!isAdmin) return;
    let cancelled = false;
    (async () => {
      try {
        const stats = await api.dashboardStats.get();
        if (cancelled) return;
        const approvals = (stats.pendingLeaves ?? 0) + (stats.pendingIpViolations ?? 0) + (stats.pendingRegularisations ?? 0);
        setBadgeCounts({
          approvals,
          onboarding: stats.pendingOnboarding ?? 0,
        });
      } catch (err) {
        console.error('[Sidebar] badge count fetch error:', err);
      }
    })();
    return () => { cancelled = true; };
  }, [isAdmin, pathname]); // re-fetch on route change

  const handleLogout = useCallback(async () => {
    await logout();
  }, [logout]);

  const onboardingPending = !isAdmin && userProfile?.onboardingStatus === 'pending';
  const onboardingInProgress = !isAdmin && userProfile?.onboardingStatus === 'in_progress';
  const showOnboardingNav = onboardingPending || onboardingInProgress;
  const sections = isAdmin
    ? adminSections(badgeCounts)
    : employeeSections(!!showOnboardingNav, !!onboardingInProgress);

  /** Match active route -- strip query strings for comparison */
  const isActive = (href: string) => {
    const hrefPath = href.split('?')[0];
    if (hrefPath === '/dashboard') return pathname === '/dashboard';
    // For settings sub-routes, exact match
    if (hrefPath.startsWith('/settings/')) return pathname === hrefPath;
    return pathname.startsWith(hrefPath);
  };

  const userName = userProfile?.name ?? 'Loading...';
  const userRole = isAdmin ? 'Admin' : (userProfile?.designation ?? 'Employee');
  const initials = userProfile ? getInitials(userProfile.name) : '??';
  const gradient = avatarGradient(userName);

  return (
    <>
      {/* Mobile backdrop */}
      {open && (
        <div
          className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm lg:hidden"
          onClick={onClose}
          aria-hidden="true"
        />
      )}

      {/* Sidebar panel */}
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-50 flex w-[280px] flex-col border-r border-[var(--border)] bg-white transition-transform duration-300 ease-in-out',
          'lg:static lg:z-auto lg:w-[var(--sidebar-w)] lg:translate-x-0',
          open ? 'translate-x-0' : '-translate-x-full',
        )}
        style={{ gridRow: '1 / 3' }}
      >
        {/* Brand */}
        <div className="flex items-center gap-2.5 border-b border-[var(--border)] px-4 py-3.5">
          <Link
            href="/dashboard"
            className="flex items-center gap-2.5 min-w-0"
            onClick={onClose}
          >
            <div
              className="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-md bg-gray-900"
              aria-hidden="true"
            >
              <span className="font-mono text-[12px] font-bold leading-none text-white">
                AU
              </span>
            </div>
            <div className="min-w-0">
              <span className="block text-[14px] font-semibold leading-tight text-gray-900">
                HRMS
              </span>
              <span className="block text-[10px] font-medium uppercase leading-tight tracking-[0.06em] text-[var(--text-tertiary)]">
                by August
              </span>
            </div>
          </Link>

          {/* Mobile close */}
          <button
            type="button"
            onClick={onClose}
            className="ml-auto rounded-md p-1 text-gray-400 hover:text-gray-600 lg:hidden"
            aria-label="Close sidebar"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto px-3 py-3">
          {sections.map((section) => (
            <div key={section.title} className="mb-4">
              {/* Section label */}
              <p className="mb-1.5 px-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--text-tertiary)]">
                {section.title}
              </p>

              {/* Nav items */}
              <ul className="space-y-0.5">
                {section.items.map((item) => {
                  const active = isActive(item.href);
                  const Icon = item.icon;

                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        onClick={onClose}
                        className={cn(
                          'group flex items-center gap-2.5 whitespace-nowrap rounded-sm px-2 py-1.5 text-[13px] font-medium transition-colors',
                          active
                            ? 'bg-gray-100 text-gray-900'
                            : 'text-[var(--text-secondary)] hover:bg-gray-50 hover:text-gray-900',
                        )}
                      >
                        <Icon
                          className={cn(
                            'h-4 w-4 shrink-0 transition-colors',
                            active
                              ? 'text-gray-900'
                              : 'text-[var(--text-tertiary)] group-hover:text-gray-900',
                          )}
                        />
                        <span className="min-w-0 truncate">{item.label}</span>
                        {item.badge && (
                          <span
                            className={cn(
                              'ml-auto shrink-0 rounded-full px-1.5 py-0.5 font-mono text-[10px] leading-none',
                              active
                                ? 'bg-gray-900 text-white'
                                : 'bg-gray-100 text-gray-500',
                            )}
                          >
                            {item.badge}
                          </span>
                        )}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>

        {/* Footer / user section */}
        <div className="border-t border-[var(--border)] px-3 py-3">
          <div className="flex items-center gap-2.5">
            {/* Gradient avatar */}
            <div
              className={cn(
                'flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-full bg-gradient-to-br text-[10px] font-semibold text-white',
                gradient,
              )}
            >
              {initials}
            </div>

            {/* Name + role */}
            <div className="min-w-0 flex-1">
              <p className="truncate text-[12px] font-semibold leading-tight text-gray-900">
                {userName}
              </p>
              <p className="truncate text-[10px] uppercase leading-tight tracking-[0.04em] text-[var(--text-tertiary)]">
                {userRole}
              </p>
            </div>

            {/* Logout */}
            <button
              type="button"
              onClick={handleLogout}
              className="shrink-0 rounded-md p-1 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
              aria-label="Sign out"
              title="Sign out"
            >
              <LogOut className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </aside>
    </>
  );
}
