import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAdmin } from '@/lib/auth-helpers';
import { logAudit, getClientIp } from '@/lib/audit';
import { rateLimiters } from '@/lib/rate-limit';
import { errorResponse } from '@/lib/api-errors';
import type { SalaryComponentRow } from '@/types';

/* ================================================================== */
/*  /api/payroll/settings                                              */
/*                                                                     */
/*  GET    -> { components, settings }  (admin only)                   */
/*  PATCH  -> upsert one payroll_settings row (admin only)             */
/*                                                                     */
/*  Every statutory rule is configuration, never a magic number        */
/*  (BUSINESS_RULES §8.3). src/lib/payroll.ts trusts these numbers, so */
/*  the shape is validated here before it is ever written.             */
/* ================================================================== */

/** The only keys that may exist in payroll_settings. */
type PayrollSettingKey = 'pf' | 'esi' | 'pt';

/**
 * Per-key value schemas. Unknown keys are stripped by zod on parse, so the
 * stored JSON only ever contains the fields the engine reads.
 */
const SETTING_SCHEMAS: Record<PayrollSettingKey, z.ZodType> = {
  pf: z.object({
    enabled: z.boolean(),
    employee_percent: z.number().min(0).max(100),
    wage_ceiling: z.number().min(0),
    apply_ceiling: z.boolean(),
  }),
  esi: z.object({
    enabled: z.boolean(),
    employee_percent: z.number().min(0).max(100),
    gross_limit: z.number().min(0),
  }),
  pt: z.object({
    enabled: z.boolean(),
    slabs: z
      .array(
        z.object({
          // `upto: null` marks the final, open-ended band.
          upto: z.number().min(0).nullable(),
          amount: z.number().min(0),
        }),
      )
      .refine(
        (slabs) => slabs.filter((slab) => slab.upto === null).length <= 1,
        'only one slab may be open-ended (upto: null)',
      ),
  }),
};

/* ------------------------------------------------------------------ */
/*  GET /api/payroll/settings                                          */
/*  Component catalog + statutory settings.                            */
/* ------------------------------------------------------------------ */

export async function GET() {
  try {
    const admin = await requireAdmin();
    const db = admin.supabase;

    const [componentsRes, settingsRes] = await Promise.all([
      db.from('salary_components').select('*').order('kind').order('display_order'),
      db.from('payroll_settings').select('key, value'),
    ]);

    if (componentsRes.error) throw componentsRes.error;
    if (settingsRes.error) throw settingsRes.error;

    // kv rows -> keyed object the UI and the engine both read by name.
    const rows = (settingsRes.data ?? []) as { key: string; value: unknown }[];
    const settings: Record<string, unknown> = {};
    for (const row of rows) settings[row.key] = row.value;

    return NextResponse.json({
      success: true,
      data: {
        components: (componentsRes.data ?? []) as SalaryComponentRow[],
        settings,
      },
    });
  } catch (error) {
    return errorResponse(error, 'Failed to load payroll settings. Please try again.');
  }
}

/* ------------------------------------------------------------------ */
/*  PATCH /api/payroll/settings                                        */
/*  Body: { key: 'pf' | 'esi' | 'pt', value: <shape for that key> }    */
/* ------------------------------------------------------------------ */

export async function PATCH(request: NextRequest) {
  try {
    const admin = await requireAdmin();
    const db = admin.supabase;
    if (!rateLimiters.mutation(admin.uid).allowed) {
      return NextResponse.json(
        { success: false, error: 'Too many requests. Try again shortly.' },
        { status: 429 },
      );
    }

    const body: unknown = await request.json();
    const envelope = z
      .object({ key: z.string(), value: z.unknown() })
      .safeParse(body);
    if (!envelope.success) {
      return NextResponse.json(
        { success: false, error: 'key is required' },
        { status: 400 },
      );
    }

    const { key } = envelope.data;
    if (key !== 'pf' && key !== 'esi' && key !== 'pt') {
      return NextResponse.json(
        { success: false, error: `key must be one of pf, esi, pt (got "${key}")` },
        { status: 400 },
      );
    }

    const parsed = SETTING_SCHEMAS[key].safeParse(envelope.data.value);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      const field = issue.path.length ? `${key}.${issue.path.join('.')}` : key;
      return NextResponse.json(
        { success: false, error: `${field}: ${issue.message}` },
        { status: 400 },
      );
    }

    const { data, error } = await db
      .from('payroll_settings')
      .upsert(
        { key, value: parsed.data, updated_at: new Date().toISOString() },
        { onConflict: 'key' },
      )
      .select()
      .single();
    if (error) throw error;

    logAudit({
      performed_by: admin.uid,
      action: 'update',
      details: `Updated payroll settings: ${key}`,
      ip_address: getClientIp(request),
      after_data: parsed.data,
    });

    return NextResponse.json({ success: true, data: { setting: data } });
  } catch (error) {
    return errorResponse(error, 'Failed to save payroll settings. Please try again.');
  }
}
