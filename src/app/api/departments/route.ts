import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth, requireAdmin } from '@/lib/auth-helpers';
import { logAudit, getClientIp } from '@/lib/audit';
import { rateLimiters } from '@/lib/rate-limit';
import { errorResponse } from '@/lib/api-errors';

/* ------------------------------------------------------------------ */
/*  GET /api/departments  (authenticated)                              */
/* ------------------------------------------------------------------ */

export async function GET(request: NextRequest) {
  try {
    const authUser = await verifyAuth();
    const db = authUser.supabase;

    const { data, error } = await db
      .from('departments')
      .select('id, name, employees:employees!employees_department_id_fkey(count)')
      .order('name');

    if (error) throw error;

    const departments = (data ?? []).map((d: any) => ({
      id: d.id,
      name: d.name,
      employeeCount: d.employees?.[0]?.count ?? 0,
    }));

    return NextResponse.json({ success: true, data: { departments } });
  } catch (error) {
    return errorResponse(error, 'Failed to fetch departments. Please try again.');
  }
}

/* ------------------------------------------------------------------ */
/*  POST /api/departments  (admin only)                                */
/* ------------------------------------------------------------------ */

export async function POST(request: NextRequest) {
  try {
    const admin = await requireAdmin();
    const db = admin.supabase;
    const rl = rateLimiters.mutation(admin.uid);
    if (!rl.allowed) return NextResponse.json({ success: false, error: 'Rate limit exceeded' }, { status: 429 });

    const { name } = await request.json();
    if (!name?.trim()) return NextResponse.json({ success: false, error: 'name is required' }, { status: 400 });

    const { data, error } = await db
      .from('departments')
      .insert({ name: name.trim() })
      .select()
      .single();
    if (error) throw error;

    logAudit({ performed_by: admin.uid, action: 'create', details: `Created department "${name.trim()}"`, ip_address: getClientIp(request), after_data: data });

    return NextResponse.json({ success: true, data: { department: data } }, { status: 201 });
  } catch (error) {
    return errorResponse(error, 'Failed to create department. Please try again.');
  }
}

/* ------------------------------------------------------------------ */
/*  PATCH /api/departments  (admin only)                               */
/* ------------------------------------------------------------------ */

export async function PATCH(request: NextRequest) {
  try {
    const admin = await requireAdmin();
    const db = admin.supabase;
    const rl = rateLimiters.mutation(admin.uid);
    if (!rl.allowed) return NextResponse.json({ success: false, error: 'Rate limit exceeded' }, { status: 429 });

    const { id, name } = await request.json();
    if (!id) return NextResponse.json({ success: false, error: 'id is required' }, { status: 400 });
    if (!name?.trim()) return NextResponse.json({ success: false, error: 'name is required' }, { status: 400 });

    const { data, error } = await db
      .from('departments')
      .update({ name: name.trim() })
      .eq('id', id)
      .select()
      .single();
    if (error) throw error;

    logAudit({ performed_by: admin.uid, action: 'update', details: `Renamed department to "${name.trim()}"`, ip_address: getClientIp(request), after_data: data });

    return NextResponse.json({ success: true, data: { department: data } });
  } catch (error) {
    return errorResponse(error, 'Failed to update department. Please try again.');
  }
}

/* ------------------------------------------------------------------ */
/*  DELETE /api/departments  (admin only)                              */
/* ------------------------------------------------------------------ */

export async function DELETE(request: NextRequest) {
  try {
    const admin = await requireAdmin();
    const db = admin.supabase;
    const rl = rateLimiters.mutation(admin.uid);
    if (!rl.allowed) return NextResponse.json({ success: false, error: 'Rate limit exceeded' }, { status: 429 });

    const { id } = await request.json();
    if (!id) return NextResponse.json({ success: false, error: 'id is required' }, { status: 400 });

    const { data: before } = await db.from('departments').select('name').eq('id', id).single();
    const { error } = await db.from('departments').delete().eq('id', id);
    if (error) throw error;

    logAudit({ performed_by: admin.uid, action: 'delete', details: `Deleted department "${before?.name}"`, ip_address: getClientIp(request) });

    return NextResponse.json({ success: true, data: { deleted: id } });
  } catch (error) {
    return errorResponse(error, 'Failed to delete department. Please try again.');
  }
}
