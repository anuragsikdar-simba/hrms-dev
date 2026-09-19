import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth-helpers';
import { logAudit, getClientIp } from '@/lib/audit';
import { rateLimiters } from '@/lib/rate-limit';
import { errorResponse } from '@/lib/api-errors';

/* ================================================================== */
/*  /api/email-settings                                                */
/*  Admin-only CRUD for notification rules + SMTP config               */
/* ================================================================== */

/* ------------------------------------------------------------------ */
/*  GET — list all rules + SMTP config                                 */
/* ------------------------------------------------------------------ */

export async function GET(request: NextRequest) {
  try {
    const authUser = await requireAdmin();
    const db = authUser.supabase;

    const [rulesRes, configRes] = await Promise.all([
      db.from('notification_rules').select('*').order('created_at'),
      db.from('email_config').select('*'),
    ]);

    if (rulesRes.error) throw rulesRes.error;
    if (configRes.error) throw configRes.error;

    // Convert email_config rows into a single object
    const smtp: Record<string, string> = {};
    (configRes.data ?? []).forEach((row: any) => {
      smtp[row.key] = row.value;
    });

    return NextResponse.json({
      success: true,
      data: {
        rules: rulesRes.data ?? [],
        smtp,
      },
    });
  } catch (error) {
    return errorResponse(error, 'Failed to fetch email settings. Please try again.');
  }
}

/* ------------------------------------------------------------------ */
/*  POST — mutation actions                                            */
/*  Body: { action, ...payload }                                       */
/*                                                                     */
/*  Actions:                                                           */
/*    create_rule    { event, description, email_enabled, recipients }  */
/*    update_rule    { id, event?, description?, email_enabled?, recipients? } */
/*    delete_rule    { id }                                            */
/*    toggle_rule    { id, email_enabled }                             */
/*    save_smtp      { smtp: Record<string, string> }                  */
/*    test_email     { to_email }                                      */
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
      /* ---- Rules ---- */

      case 'create_rule': {
        const { event, description, email_enabled, recipients } = payload as {
          event: string; description?: string; email_enabled?: boolean; recipients?: string;
        };
        if (!event?.trim()) {
          return NextResponse.json({ success: false, error: 'event is required' }, { status: 400 });
        }

        const { data, error } = await db
          .from('notification_rules')
          .insert({
            event: event.trim(),
            description: description?.trim() ?? '',
            email_enabled: email_enabled ?? true,
            recipients: recipients?.trim() ?? 'employee',
          })
          .select()
          .single();
        if (error) throw error;

        logAudit({
          performed_by: admin.uid,
          action: 'create',
          details: `Created notification rule "${event.trim()}"`,
          ip_address: ip,
          after_data: data,
        });

        return NextResponse.json({ success: true, data: { rule: data } }, { status: 201 });
      }

      case 'update_rule': {
        const { id, ...updates } = payload as {
          id: string; event?: string; description?: string; email_enabled?: boolean; recipients?: string;
        };
        if (!id) return NextResponse.json({ success: false, error: 'id is required' }, { status: 400 });

        const updateObj: Record<string, unknown> = { updated_at: new Date().toISOString() };
        if (updates.event !== undefined) updateObj.event = updates.event.trim();
        if (updates.description !== undefined) updateObj.description = updates.description.trim();
        if (updates.email_enabled !== undefined) updateObj.email_enabled = updates.email_enabled;
        if (updates.recipients !== undefined) updateObj.recipients = updates.recipients.trim();

        const { data, error } = await db
          .from('notification_rules')
          .update(updateObj)
          .eq('id', id)
          .select()
          .single();
        if (error) throw error;

        logAudit({
          performed_by: admin.uid,
          action: 'update',
          details: `Updated notification rule "${data.event}"`,
          ip_address: ip,
          after_data: data,
        });

        return NextResponse.json({ success: true, data: { rule: data } });
      }

      case 'toggle_rule': {
        const { id, email_enabled } = payload as { id: string; email_enabled: boolean };
        if (!id) return NextResponse.json({ success: false, error: 'id is required' }, { status: 400 });

        const { data, error } = await db
          .from('notification_rules')
          .update({ email_enabled, updated_at: new Date().toISOString() })
          .eq('id', id)
          .select()
          .single();
        if (error) throw error;

        logAudit({
          performed_by: admin.uid,
          action: 'update',
          details: `${email_enabled ? 'Enabled' : 'Disabled'} notification rule "${data.event}"`,
          ip_address: ip,
        });

        return NextResponse.json({ success: true, data: { rule: data } });
      }

      case 'delete_rule': {
        const { id } = payload as { id: string };
        if (!id) return NextResponse.json({ success: false, error: 'id is required' }, { status: 400 });

        const { data: before } = await db.from('notification_rules').select('event').eq('id', id).single();
        const { error } = await db.from('notification_rules').delete().eq('id', id);
        if (error) throw error;

        logAudit({
          performed_by: admin.uid,
          action: 'delete',
          details: `Deleted notification rule "${before?.event}"`,
          ip_address: ip,
        });

        return NextResponse.json({ success: true, data: { deleted: id } });
      }

      /* ---- SMTP Config ---- */

      case 'save_smtp': {
        const { smtp } = payload as { smtp: Record<string, string> };
        if (!smtp || typeof smtp !== 'object') {
          return NextResponse.json({ success: false, error: 'smtp object is required' }, { status: 400 });
        }

        for (const [key, value] of Object.entries(smtp)) {
          await db
            .from('email_config')
            .upsert({ key, value: value ?? '', updated_at: new Date().toISOString() }, { onConflict: 'key' });
        }

        logAudit({
          performed_by: admin.uid,
          action: 'update',
          details: `Updated SMTP configuration (${Object.keys(smtp).join(', ')})`,
          ip_address: ip,
        });

        return NextResponse.json({ success: true, data: { updated: Object.keys(smtp).length } });
      }

      case 'test_email': {
        const { to_email } = payload as { to_email?: string };
        // For now: validate SMTP config exists, return appropriate message
        const { data: configData } = await db.from('email_config').select('*');
        const config: Record<string, string> = {};
        (configData ?? []).forEach((row: any) => { config[row.key] = row.value; });

        if (!config.smtp_host || !config.from_email) {
          return NextResponse.json({
            success: false,
            error: 'SMTP not configured. Please fill in SMTP host and from email first.',
          }, { status: 400 });
        }

        // TODO: Actual email sending via nodemailer/resend when SMTP is configured
        logAudit({
          performed_by: admin.uid,
          action: 'create',
          details: `Test email requested to ${to_email || config.from_email}`,
          ip_address: ip,
        });

        return NextResponse.json({
          success: true,
          data: { message: `Test email would be sent to ${to_email || config.from_email}. Email sending integration pending.` },
        });
      }

      default:
        return NextResponse.json({ success: false, error: `Unknown action: ${action}` }, { status: 400 });
    }
  } catch (error) {
    return errorResponse(error, 'Failed to process email settings. Please try again.');
  }
}
