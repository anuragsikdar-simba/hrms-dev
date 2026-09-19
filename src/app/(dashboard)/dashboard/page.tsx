'use client';

import { useAuth } from '@/contexts/AuthContext';
import { AdminDashboard } from '@/components/dashboard/admin-dashboard';
import { EmployeeDashboard } from '@/components/dashboard/employee-dashboard';

function getGreeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

export default function DashboardPage() {
  const { isAdmin, userProfile } = useAuth();
  const firstName = userProfile?.name?.split(' ')[0] ?? '';

  return (
    <div>
      {/* Page head */}
      <div className="flex items-end justify-between mb-[18px] gap-4 flex-wrap">
        <div>
          <h1 className="text-[22px] font-semibold tracking-tight text-gray-900 m-0 mb-1">
            {getGreeting()}, {firstName || 'there'}
          </h1>
          <p className="text-xs text-gray-500">
            {isAdmin
              ? 'Here\'s your team overview and items needing attention.'
              : 'Your attendance, leave balances, and pending actions at a glance.'}
          </p>
        </div>
        <div className="flex gap-2">
          {/* Action buttons if needed */}
        </div>
      </div>

      {isAdmin ? <AdminDashboard /> : <EmployeeDashboard />}
    </div>
  );
}
