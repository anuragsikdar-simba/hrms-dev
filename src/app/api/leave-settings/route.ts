import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth-helpers';
import { logAudit, getClientIp } from '@/lib/audit';
import { rateLimiters } from '@/lib/rate-limit';
import { errorResponse } from '@/lib/api-errors';

/* ================================================================== */
/*  /api/leave-settings                                                */
/*  Admin-only CRUD for leave types, allocations, and overrides        */
/* ================================================================== */

/* ------------------------------------------------------------------ */
/*  POST /api/leave-settings                                           */
/*  Body: { action, ...payload }                                       */
/*                                                                     */
/*  Actions:                                                           */
/*    create_leave_type   { name, key, annual_days }                   */
/*    update_leave_type   { id, name?, key? }                          */
/*    delete_leave_type   { id }                                       */
/*    update_allocation   { leave_type_id, annual_days }               */
/*    bulk_update_allocations { allocations: [{leave_type_id, annual_days}] } */
/*    create_override     { employee_id, leave_type_id, custom_days }  */
/*    delete_override     { id }                                       */
/* ------------------------------------------------------------------ */

export async function POST(request: NextRequest) {
  try {
    const admin = await requireAdmin();
    const db = admin.supabase;
    const rl = rateLimiters.mutation(admin.uid);
    if (!rl.allowed) {
      return NextResponse.json({ success: false, error: 'Rate limit exceeded' }, { status: 429 });
    }

    const body = await request.json();
    const { action, ...payload } = body as { action: string; [key: string]: unknown };
    const ip = getClientIp(request);

    switch (action) {
      /* ---- Leave Types ---- */

      case 'create_leave_type': {
        const { name, key, annual_days } = payload as { name: string; key: string; annual_days: number };
        if (!name || !key) {
          return NextResponse.json({ success: false, error: 'name and key are required' }, { status: 400 });
        }

        const { data: lt, error: ltErr } = await db
          .from('leave_types')
          .insert({ name, key: key.toLowerCase().replace(/\s+/g, '_') })
          .select()
          .single();
        if (ltErr) throw ltErr;

        // Also create a default allocation
        if (annual_days != null && annual_days >= 0) {
          await db
            .from('leave_allocations')
            .insert({ leave_type_id: lt.id, annual_days });
        }

        logAudit({
          performed_by: admin.uid,
          action: 'create',
          details: `Created leave type "${name}" (${key}) with ${annual_days ?? 0} days`,
          ip_address: ip,
          after_data: lt,
        });

        return NextResponse.json({ success: true, data: { leaveType: lt } }, { status: 201 });
      }

      case 'update_leave_type': {
        const { id, name, key } = payload as { id: string; name?: string; key?: string };
        if (!id) return NextResponse.json({ success: false, error: 'id is required' }, { status: 400 });

        const updates: Record<string, unknown> = {};
        if (name) updates.name = name;
        if (key) updates.key = key.toLowerCase().replace(/\s+/g, '_');

        const { data, error } = await db
          .from('leave_types')
          .update(updates)
          .eq('id', id)
          .select()
          .single();
        if (error) throw error;

        logAudit({
          performed_by: admin.uid,
          action: 'update',
          details: `Updated leave type "${data.name}"`,
          ip_address: ip,
          after_data: data,
        });

        return NextResponse.json({ success: true, data: { leaveType: data } });
      }

      case 'delete_leave_type': {
        const { id } = payload as { id: string };
        if (!id) return NextResponse.json({ success: false, error: 'id is required' }, { status: 400 });

        const { data: before } = await db.from('leave_types').select('name').eq('id', id).single();

        // Delete allocations and overrides first (cascade manually)
        await db.from('leave_overrides').delete().eq('leave_type_id', id);
        await db.from('leave_allocations').delete().eq('leave_type_id', id);
        const { error } = await db.from('leave_types').delete().eq('id', id);
        if (error) throw error;

        logAudit({
          performed_by: admin.uid,
          action: 'delete',
          details: `Deleted leave type "${before?.name}" and related allocations/overrides`,
          ip_address: ip,
        });

        return NextResponse.json({ success: true, data: { deleted: id } });
      }

      /* ---- Allocations ---- */

      case 'update_allocation': {
        const { leave_type_id, annual_days } = payload as { leave_type_id: string; annual_days: number };
        if (!leave_type_id || annual_days == null) {
          return NextResponse.json({ success: false, error: 'leave_type_id and annual_days are required' }, { status: 400 });
        }

        // Upsert: update if exists, insert if not
        const { data: existing } = await db
          .from('leave_allocations')
          .select('id')
          .eq('leave_type_id', leave_type_id)
          .maybeSingle();

        if (existing) {
          const { error } = await db
            .from('leave_allocations')
            .update({ annual_days })
            .eq('leave_type_id', leave_type_id);
          if (error) throw error;
        } else {
          const { error } = await db
            .from('leave_allocations')
            .insert({ leave_type_id, annual_days });
          if (error) throw error;
        }

        logAudit({
          performed_by: admin.uid,
          action: 'update',
          details: `Updated allocation for leave type ${leave_type_id} to ${annual_days} days`,
          ip_address: ip,
        });

        return NextResponse.json({ success: true, data: { leave_type_id, annual_days } });
      }

      case 'bulk_update_allocations': {
        const { allocations } = payload as { allocations: { leave_type_id: string; annual_days: number }[] };
        if (!allocations || !Array.isArray(allocations)) {
          return NextResponse.json({ success: false, error: 'allocations array is required' }, { status: 400 });
        }

        for (const alloc of allocations) {
          const { data: existing } = await db
            .from('leave_allocations')
            .select('id')
            .eq('leave_type_id', alloc.leave_type_id)
            .maybeSingle();

          if (existing) {
            await db
              .from('leave_allocations')
              .update({ annual_days: alloc.annual_days })
              .eq('leave_type_id', alloc.leave_type_id);
          } else {
            await db
              .from('leave_allocations')
              .insert({ leave_type_id: alloc.leave_type_id, annual_days: alloc.annual_days });
          }
        }

        logAudit({
          performed_by: admin.uid,
          action: 'update',
          details: `Bulk updated ${allocations.length} leave allocations`,
          ip_address: ip,
        });

        return NextResponse.json({ success: true, data: { updated: allocations.length } });
      }

      /* ---- Overrides ---- */

      case 'create_override': {
        const { employee_id, leave_type_id, custom_days } = payload as {
          employee_id: string;
          leave_type_id: string;
          custom_days: number;
        };
        if (!employee_id || !leave_type_id || custom_days == null) {
          return NextResponse.json({ success: false, error: 'employee_id, leave_type_id, and custom_days are required' }, { status: 400 });
        }

        const { data, error } = await db
          .from('leave_overrides')
          .upsert(
            { employee_id, leave_type_id, custom_days },
            { onConflict: 'employee_id,leave_type_id' },
          )
          .select()
          .single();
        if (error) throw error;

        logAudit({
          performed_by: admin.uid,
          action: 'create',
          target_employee: employee_id,
          details: `Created leave override: ${custom_days} days for leave type ${leave_type_id}`,
          ip_address: ip,
          after_data: data,
        });

        return NextResponse.json({ success: true, data: { override: data } }, { status: 201 });
      }

      case 'delete_override': {
        const { id, employee_id, leave_type_id } = payload as {
          id?: string;
          employee_id?: string;
          leave_type_id?: string;
        };
        if (!id && !(employee_id && leave_type_id)) {
          return NextResponse.json(
            { success: false, error: 'id, or employee_id and leave_type_id, are required' },
            { status: 400 },
          );
        }

        const matchBy = id ? { id } : { employee_id, leave_type_id };
        const { data: before } = await db
          .from('leave_overrides')
          .select('*')
          .match(matchBy)
          .maybeSingle();

        // Idempotent: nothing to remove means the employee is already on the
        // default allocation, which is the desired end state.
        if (!before) {
          return NextResponse.json({ success: true, data: { deleted: id ?? null } });
        }

        const { error } = await db.from('leave_overrides').delete().eq('id', before.id);
        if (error) throw error;

        logAudit({
          performed_by: admin.uid,
          action: 'delete',
          target_employee: before.employee_id,
          details: `Removed leave override (reverted to default allocation)`,
          ip_address: ip,
          before_data: before,
        });

        return NextResponse.json({ success: true, data: { deleted: before.id } });
      }

      default:
        return NextResponse.json({ success: false, error: `Unknown action: ${action}` }, { status: 400 });
    }
  } catch (error) {
    return errorResponse(error, 'Failed to process leave settings. Please try again.');
  }
}
