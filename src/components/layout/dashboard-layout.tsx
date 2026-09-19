'use client';

import { useState, useCallback } from 'react';
import { Sidebar } from './sidebar';
import { Header } from './header';

interface DashboardLayoutProps {
  children: React.ReactNode;
}

export function DashboardLayout({ children }: DashboardLayoutProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // TODO: Replace with real unread notification count from API
  const unreadCount = 0;

  const openSidebar = useCallback(() => setSidebarOpen(true), []);
  const closeSidebar = useCallback(() => setSidebarOpen(false), []);

  return (
    <div
      className="grid h-screen bg-[var(--bg)] grid-cols-1 grid-rows-[var(--topbar-h)_1fr] lg:grid-cols-[var(--sidebar-w)_1fr]"
    >
      {/* Sidebar -- spans both rows on desktop, slide-over on mobile */}
      <Sidebar open={sidebarOpen} onClose={closeSidebar} />

      {/* Topbar -- col 2 row 1 on desktop */}
      <Header onMenuClick={openSidebar} unreadCount={unreadCount} />

      {/* Main content -- col 2 row 2 on desktop */}
      <main className="overflow-auto px-6 py-5 pb-[60px]">
        {children}
      </main>
    </div>
  );
}
