'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { Spinner } from '@/components/ui/spinner';

export default function AuthRouteLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { isAuthenticated, loading, mustResetPassword } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;

    // Already authenticated - redirect away from auth pages
    if (isAuthenticated && !mustResetPassword) {
      router.replace('/dashboard');
    }
  }, [isAuthenticated, loading, mustResetPassword, router]);

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-surface">
        <Spinner size="xl" className="text-primary-600" />
      </div>
    );
  }

  // If authenticated (and no password reset needed), don't flash auth UI
  if (isAuthenticated && !mustResetPassword) {
    return null;
  }

  return (
    <div className="flex min-h-screen">
      {/* ---- Left panel: brand / illustration (hidden on mobile) ---- */}
      <div className="hidden lg:flex lg:w-[480px] xl:w-[520px] flex-col justify-between bg-gray-900 p-10 text-white">
        <div>
          {/* Brand mark */}
          <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-white/10 text-[15px] font-bold tracking-tight backdrop-blur-sm">
            AU
          </div>
        </div>

        <div className="space-y-4">
          <h1 className="text-[28px] font-semibold leading-tight tracking-tight text-white">
            August
            <br />
            <span className="text-white/60">HRMS</span>
          </h1>
          <p className="max-w-[280px] text-[13px] leading-relaxed text-white/40">
            Human Resource Management System. Streamline your workforce
            operations, payroll, and employee management in one place.
          </p>
        </div>

        <p className="text-[11px] text-white/25">
          &copy; {new Date().getFullYear()} August. All rights reserved.
        </p>
      </div>

      {/* ---- Right panel: auth form ---- */}
      <div className="flex flex-1 flex-col items-center justify-center bg-white px-6 py-12">
        {/* Mobile-only brand mark */}
        <div className="mb-8 flex flex-col items-center lg:hidden">
          <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-gray-900 text-sm font-bold text-white">
            AU
          </div>
          <p className="text-xs text-gray-400">August HRMS</p>
        </div>

        <div className="w-full max-w-[380px]">{children}</div>
      </div>
    </div>
  );
}
