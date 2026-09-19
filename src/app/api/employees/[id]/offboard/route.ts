import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth-helpers';
import { logAudit, getClientIp } from '@/lib/audit';
import { rateLimiters } from '@/lib/rate-limit';
import { errorResponse } from '@/lib/api-errors';

// -------------------------------------------------------
// Route params type
// -------------------------------------------------------

type RouteParams = { params: Promise<{ id: string }> };

type OffboardRequestBody = {
  lastWorkingDay: string;
  reason: string;
  notes?: string;
};

export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const admin = await requireAdmin();
    const db = admin.supabase;

    if (!rateLimiters.mutation(admin.uid).allowed) {
      return NextResponse.json(
        { success: false, error: 'Too many requests. Try again shortly.' },
        { status: 429 },
      );
    }

    const { id } = await params;
    const body = (await request.json()) as OffboardRequestBody;

    // Validate required fields
    if (!body.lastWorkingDay) {
      return NextResponse.json(
        { success: false, error: 'lastWorkingDay is required' },
        { status: 400 }
      );
    }

    if (!body.reason) {
      return NextResponse.json(
        { success: false, error: 'reason is required' },
        { status: 400 }
      );
    }

    // Fetch before data
    const { data: before } = await db.from('employees').select('*').eq('id', id).single();

    // Update employee status to offboarded
    const { data, error } = await db
      .from('employees')
      .update({
        status: 'offboarded',
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;

    logAudit({
      performed_by: admin.uid,
      action: 'update',
      target_employee: id,
      details: `Offboarded employee. Reason: ${body.reason}. Last working day: ${body.lastWorkingDay}`,
      ip_address: getClientIp(request),
      before_data: before,
      after_data: { ...data, offboard_reason: body.reason, last_working_day: body.lastWorkingDay, notes: body.notes },
    });

    return NextResponse.json({
      success: true,
      data: {
        employee: data,
        message: `Employee ${id} has been offboarded successfully.`,
      },
    });
  } catch (error) {
    return errorResponse(error, 'Failed to offboard employee. Please try again.');
  }
}
