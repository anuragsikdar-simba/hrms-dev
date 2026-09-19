import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/auth-helpers';
import { logAudit, getClientIp } from '@/lib/audit';
import { rateLimiters } from '@/lib/rate-limit';
import { errorResponse } from '@/lib/api-errors';

/* ------------------------------------------------------------------ */
/*  GET /api/notifications                                             */
/* ------------------------------------------------------------------ */

export async function GET(request: NextRequest) {
  try {
    const user = await verifyAuth();
    const db = user.supabase;

    const { data, error } = await db
      .from('notifications')
      .select('*')
      .eq('employee_id', user.uid)
      .order('created_at', { ascending: false });

    if (error) throw error;
    return NextResponse.json({ success: true, data: { notifications: data ?? [] } });
  } catch (error) {
    return errorResponse(error, 'Failed to fetch notifications. Please try again.');
  }
}

/* ------------------------------------------------------------------ */
/*  PATCH /api/notifications                                           */
/*  Body: { id?: string, markAll?: boolean }                           */
/* ------------------------------------------------------------------ */

export async function PATCH(request: NextRequest) {
  try {
    const user = await verifyAuth();
    const db = user.supabase;
    if (!rateLimiters.mutation(user.uid).allowed) {
      return NextResponse.json(
        { success: false, error: 'Too many requests. Try again shortly.' },
        { status: 429 },
      );
    }

    const { id, markAll } = await request.json();

    if (markAll) {
      const { error } = await db
        .from('notifications')
        .update({ read: true })
        .eq('employee_id', user.uid);

      if (error) throw error;
      return NextResponse.json({ success: true, data: { message: 'All marked as read' } });
    }

    if (id) {
      const { error } = await db
        .from('notifications')
        .update({ read: true })
        .eq('id', id)
        .eq('employee_id', user.uid);

      if (error) throw error;
      return NextResponse.json({ success: true, data: { message: 'Marked as read' } });
    }

    return NextResponse.json({ success: false, error: 'Missing id or markAll' }, { status: 400 });
  } catch (error) {
    return errorResponse(error, 'Failed to update notification. Please try again.');
  }
}

/* ------------------------------------------------------------------ */
/*  POST /api/notifications  — create notification                     */
/* ------------------------------------------------------------------ */

export async function POST(request: NextRequest) {
  try {
    const user = await verifyAuth();
    const db = user.supabase;

    if (!rateLimiters.mutation(user.uid).allowed) {
      return NextResponse.json(
        { success: false, error: 'Too many requests. Try again shortly.' },
        { status: 429 },
      );
    }

    const body = await request.json();

    const notifications = Array.isArray(body) ? body : [body];

    // Validate each notification
    for (const n of notifications) {
      if (!n.employee_id || typeof n.employee_id !== 'string') {
        return NextResponse.json({ success: false, error: 'Each notification requires employee_id' }, { status: 400 });
      }
      if (!n.title || typeof n.title !== 'string' || !n.title.trim()) {
        return NextResponse.json({ success: false, error: 'Each notification requires a title' }, { status: 400 });
      }
      // The notifications INSERT RLS policy is deliberately open (system flows
      // create notifications for other users), so enforce the sender rule at
      // the route: only admins may notify OTHER employees. Without this any
      // employee could spoof/spam arbitrary notifications to anyone.
      if (user.role !== 'admin' && n.employee_id !== user.uid) {
        return NextResponse.json(
          { success: false, error: 'You can only create notifications for yourself.' },
          { status: 403 },
        );
      }
    }

    const { data, error } = await db
      .from('notifications')
      .insert(notifications.map(n => ({
        employee_id: n.employee_id,
        title: n.title,
        message: n.message ?? null,
        type: n.type ?? 'info',
        actionable: n.actionable ?? false,
        action_url: n.action_url ?? null,
      })))
      .select();

    if (error) throw error;

    logAudit({
      performed_by: user.uid,
      action: 'create',
      details: `Created ${notifications.length} notification(s)`,
      ip_address: getClientIp(request),
    });

    return NextResponse.json({ success: true, data: { notifications: data } }, { status: 201 });
  } catch (error) {
    return errorResponse(error, 'Failed to create notification. Please try again.');
  }
}
