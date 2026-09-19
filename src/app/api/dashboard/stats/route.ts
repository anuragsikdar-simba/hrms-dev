import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/auth-helpers';
import { errorResponse } from '@/lib/api-errors';

/* ------------------------------------------------------------------ */
/*  GET /api/dashboard/stats                                           */
/*  Pending action counts for dashboard cards                          */
/* ------------------------------------------------------------------ */

export async function GET(request: NextRequest) {
  try {
    const user = await verifyAuth();
    const db = user.supabase;

    if (user.role === 'admin') {
      const [leaves, ipViolations, regularisations, onboarding] = await Promise.all([
        db.from('leave_requests').select('*', { count: 'exact', head: true }).eq('status', 'pending'),
        db.from('approval_requests').select('*', { count: 'exact', head: true }).eq('status', 'pending').eq('type', 'ip_violation'),
        db.from('approval_requests').select('*', { count: 'exact', head: true }).eq('status', 'pending').eq('type', 'regularisation'),
        db.from('employees').select('*', { count: 'exact', head: true }).eq('onboarding_status', 'in_progress'),
      ]);

      return NextResponse.json({
        success: true,
        data: {
          pendingLeaves: leaves.count ?? 0,
          pendingIpViolations: ipViolations.count ?? 0,
          pendingRegularisations: regularisations.count ?? 0,
          pendingOnboarding: onboarding.count ?? 0,
        },
      });
    }

    // Employee stats
    const [pendingLeaves, employee] = await Promise.all([
      db.from('leave_requests').select('*', { count: 'exact', head: true }).eq('employee_id', user.uid).eq('status', 'pending'),
      db.from('employees').select('onboarding_status').eq('id', user.uid).single(),
    ]);

    return NextResponse.json({
      success: true,
      data: {
        pendingLeaves: pendingLeaves.count ?? 0,
        onboardingStatus: employee.data?.onboarding_status ?? 'pending',
      },
    });
  } catch (error) {
    return errorResponse(error, 'Failed to fetch stats. Please try again.');
  }
}
