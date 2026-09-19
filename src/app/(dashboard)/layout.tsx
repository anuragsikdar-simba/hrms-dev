'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { DashboardLayout } from '@/components/layout/dashboard-layout';
import { AppShellSkeleton } from '@/components/layout/app-shell-skeleton';

export default function DashboardRouteLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { isAuthenticated, loading, mustResetPassword } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;

    if (!isAuthenticated) {
      router.replace('/login');
      return;
    }

    if (mustResetPassword) {
      router.replace('/reset-password');
    }
  }, [isAuthenticated, loading, mustResetPassword, router]);

  // Paint the real chrome while the session resolves. A centred spinner here
  // blanked the entire app on every refresh; the shell skeleton keeps the
  // layout stable so only the content swaps in.
  if (loading) {
    return <AppShellSkeleton />;
  }

  // Don't render content until authenticated
  if (!isAuthenticated || mustResetPassword) {
    return null;
  }

  return <DashboardLayout>{children}</DashboardLayout>;
}
