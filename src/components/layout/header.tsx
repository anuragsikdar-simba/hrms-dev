'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Menu, Bell, Search, LogOut, User } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuth } from '@/contexts/AuthContext';
import { Avatar, AvatarImage, AvatarFallback, getInitials } from '@/components/ui/avatar';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from '@/components/ui/dropdown-menu';

// -------------------------------------------------------
// Route title / breadcrumb map
// -------------------------------------------------------

const routeMeta: Record<string, { title: string; breadcrumbs: { label: string; href?: string }[] }> = {
  '/dashboard': {
    title: 'Dashboard',
    breadcrumbs: [{ label: 'Dashboard' }],
  },
  '/employees': {
    title: 'Employees',
    breadcrumbs: [{ label: 'Administration', href: '/dashboard' }, { label: 'Employees' }],
  },
  '/attendance': {
    title: 'Attendance',
    breadcrumbs: [{ label: 'Administration', href: '/dashboard' }, { label: 'Attendance' }],
  },
  '/leaves': {
    title: 'Leaves',
    breadcrumbs: [{ label: 'My workspace', href: '/dashboard' }, { label: 'Leaves' }],
  },
  '/documents': {
    title: 'Documents',
    breadcrumbs: [{ label: 'My workspace', href: '/dashboard' }, { label: 'Documents' }],
  },
  '/profile': {
    title: 'My Profile',
    breadcrumbs: [{ label: 'My workspace', href: '/dashboard' }, { label: 'My Profile' }],
  },
  '/notifications': {
    title: 'Notifications',
    breadcrumbs: [{ label: 'My workspace', href: '/dashboard' }, { label: 'Notifications' }],
  },
  '/audit-log': {
    title: 'Audit Log',
    breadcrumbs: [{ label: 'Administration', href: '/dashboard' }, { label: 'Audit Log' }],
  },
  '/settings': {
    title: 'Settings',
    breadcrumbs: [{ label: 'Administration', href: '/dashboard' }, { label: 'Settings' }],
  },
};

function resolveRouteMeta(pathname: string) {
  // Exact match first
  if (routeMeta[pathname]) return routeMeta[pathname];

  // Prefix match for nested routes like /employees/[id]
  const segments = pathname.split('/').filter(Boolean);
  for (let i = segments.length; i >= 1; i--) {
    const candidate = '/' + segments.slice(0, i).join('/');
    if (routeMeta[candidate]) {
      return routeMeta[candidate];
    }
  }

  return { title: 'Dashboard', breadcrumbs: [{ label: 'Dashboard' }] };
}

// -------------------------------------------------------
// Header component
// -------------------------------------------------------

interface HeaderProps {
  onMenuClick: () => void;
  unreadCount?: number;
}

export function Header({ onMenuClick, unreadCount = 0 }: HeaderProps) {
  const pathname = usePathname();
  const { userProfile, isAdmin, logout } = useAuth();

  const { breadcrumbs } = useMemo(() => resolveRouteMeta(pathname), [pathname]);

  return (
    <header className="sticky top-0 z-30 flex h-[var(--topbar-h)] items-center border-b border-border bg-white px-4 sm:px-6">
      {/* Mobile hamburger */}
      <button
        type="button"
        onClick={onMenuClick}
        className="mr-3 rounded-md p-1.5 text-gray-500 hover:bg-gray-100 hover:text-gray-700 lg:hidden"
        aria-label="Open sidebar"
      >
        <Menu className="h-5 w-5" />
      </button>

      {/* Breadcrumbs */}
      <nav aria-label="Breadcrumb" className="hidden sm:block">
        <ol className="flex items-center gap-1.5 text-xs text-gray-500">
          {breadcrumbs.map((crumb, idx) => {
            const isLast = idx === breadcrumbs.length - 1;
            return (
              <li key={idx} className="flex items-center gap-1.5">
                {idx > 0 && (
                  <span className="text-gray-300 select-none">/</span>
                )}
                {crumb.href && !isLast ? (
                  <Link
                    href={crumb.href}
                    className="transition-colors hover:text-gray-700"
                  >
                    {crumb.label}
                  </Link>
                ) : (
                  <span
                    className={cn(
                      isLast && 'here font-medium text-gray-900',
                    )}
                  >
                    {crumb.label}
                  </span>
                )}
              </li>
            );
          })}
        </ol>
      </nav>

      {/* Search bar */}
      <div className="ml-2 hidden flex-1 sm:block" style={{ maxWidth: 360 }}>
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-[13px] w-[13px] -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            placeholder={
              isAdmin
                ? 'Search employees, requests, IDs...'
                : 'Search documents, dates...'
            }
            className="w-full rounded-md border border-gray-200 bg-gray-50 py-1.5 pl-[30px] pr-12 text-xs text-gray-700 placeholder:text-gray-400 focus:border-blue-500 focus:bg-white focus:outline-none"
          />
          <kbd className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 select-none rounded-sm border border-gray-200 bg-white px-1.5 font-mono text-[10px] text-gray-400">
            ⌘K
          </kbd>
        </div>
      </div>

      {/* Right actions */}
      <div className="ml-auto flex items-center gap-2.5">
        {/* Notification bell */}
        <Link
          href="/notifications"
          className="relative flex h-[30px] w-[30px] items-center justify-center rounded-md text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700"
          aria-label="Notifications"
        >
          <Bell className="h-[15px] w-[15px]" />
          {unreadCount > 0 && (
            <span className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-red-500" />
          )}
        </Link>

        {/* User avatar dropdown */}
        <DropdownMenu>
          <DropdownMenuTrigger className="flex items-center gap-1.5 rounded-md p-1 hover:bg-gray-100 transition-colors focus:outline-none">
            <Avatar className="h-7 w-7">
              {userProfile?.profilePictureUrl && (
                <AvatarImage
                  src={userProfile.profilePictureUrl}
                  alt={userProfile?.name ?? ''}
                />
              )}
              <AvatarFallback className="text-[10px]">
                {userProfile ? getInitials(userProfile.name) : '??'}
              </AvatarFallback>
            </Avatar>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            <DropdownMenuLabel className="py-1.5">
              <p className="text-sm font-medium text-gray-900">{userProfile?.name}</p>
              <p className="text-xs text-gray-500">{userProfile?.email}</p>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() => {
                window.location.href = '/profile';
              }}
            >
              <User className="h-3.5 w-3.5" />
              My Profile
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem destructive onClick={() => logout()}>
              <LogOut className="h-3.5 w-3.5" />
              Sign Out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
