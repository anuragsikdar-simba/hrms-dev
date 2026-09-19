import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { verifyAuth, requireAdmin } from '@/lib/auth-helpers';
import { logAudit, getClientIp } from '@/lib/audit';
import { rateLimiters } from '@/lib/rate-limit';
import { errorResponse } from '@/lib/api-errors';
import { daysInMonth } from '@/lib/payroll';
import type { SalaryStructureRow, SalaryStructureItemRow } from '@/types';

/* ================================================================== */
/*  /api/payroll/structures                                            */
/*                                                                     */
/*  GET  -> { structures }  (employees see only their own)             */
/*  POST -> { structure }   (admin; INSERT a new effective-dated row)  */
/*                                                                     */
/*  Salary structures are effective-dated and immutable                */
/*  (BUSINESS_RULES §8.1): a revision is a NEW row, never an edit, so  */
/*  reprinting an old payslip can never pick up a later hike.          */
/* ================================================================== */

const SELECT_WITH_ITEMS =
  '*, items:salary_structure_items(*), employees!salary_structures_employee_id_fkey(name, employee_id)';

const itemSchema = z
  .object({
    component_key: z.string().min(1),
    calc: z.enum(['fixed', 'pct_of_basic', 'pct_of_gross', 'balance']),
    amount: z.number().nullable().optional(),
    percent: z.number().nullable().optional(),
  })
  .superRefine((item, ctx) => {
    if (item.calc === 'fixed') {
      if (item.amount == null || item.amount < 0) {
        ctx.addIssue({
          code: 'custom',
          path: ['amount'],
          message: `amount is required and must be >= 0 for the fixed component "${item.component_key}"`,
        });
      }
      return;
    }
    if (item.calc === 'pct_of_basic' || item.calc === 'pct_of_gross') {
      if (item.percent == null || item.percent < 0 || item.percent > 100) {
        ctx.addIssue({
          code: 'custom',
          path: ['percent'],
          message: `percent is required and must be between 0 and 100 for the ${item.calc} component "${item.component_key}"`,
        });
      }
    }
  });

const createStructureSchema = z.object({
  employee_id: z.string().min(1),
  effective_from: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'effective_from must be a YYYY-MM-DD date')
    .refine((value) => {
      const [year, month, day] = value.split('-').map(Number);
      return month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth(year, month);
    }, 'effective_from is not a real calendar date'),
  monthly_gross: z.number().positive('monthly_gross must be greater than 0'),
  ctc_annual: z.number().min(0).nullable().optional(),
  note: z.string().nullable().optional(),
  items: z.array(itemSchema).min(1, 'at least one salary component is required'),
});

/* ------------------------------------------------------------------ */
/*  GET /api/payroll/structures?employee_id=                           */
/*  Admins may read anyone's; an employee is forced onto their own id. */
/* ------------------------------------------------------------------ */

export async function GET(request: NextRequest) {
  try {
    const user = await verifyAuth();
    const db = user.supabase;
    const requestedId = new URL(request.url).searchParams.get('employee_id');

    // Salary is the most sensitive data in the app: a non-admin NEVER reads
    // another person's structure, whatever id they put on the query string.
    // RLS enforces this too, but the route does not rely on that alone.
    const employeeId = user.role === 'admin' ? requestedId : user.uid;

    let query = db.from('salary_structures').select(SELECT_WITH_ITEMS);
    if (employeeId) query = query.eq('employee_id', employeeId);
    const { data, error } = await query.order('effective_from', { ascending: false });
    if (error) throw error;

    return NextResponse.json({
      success: true,
      data: { structures: (data ?? []) as SalaryStructureRow[] },
    });
  } catch (error) {
    return errorResponse(error, 'Failed to load salary structures. Please try again.');
  }
}

/* ------------------------------------------------------------------ */
/*  POST /api/payroll/structures                                       */
/*  Body: { employee_id, effective_from, monthly_gross, ctc_annual?,   */
/*          note?, items[] }                                           */
/* ------------------------------------------------------------------ */

export async function POST(request: NextRequest) {
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
    const parsed = createStructureSchema.safeParse(body);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      const field = issue.path.length ? issue.path.join('.') : 'body';
      return NextResponse.json(
        { success: false, error: `${field}: ${issue.message}` },
        { status: 400 },
      );
    }
    const input = parsed.data;

    /* ---- Semantic validation the engine depends on ---- */

    const seen = new Set<string>();
    for (const item of input.items) {
      if (seen.has(item.component_key)) {
        return NextResponse.json(
          { success: false, error: `items: "${item.component_key}" appears more than once` },
          { status: 400 },
        );
      }
      seen.add(item.component_key);
    }

    const { data: catalog, error: catalogError } = await db
      .from('salary_components')
      .select('key')
      .in('key', [...seen]);
    if (catalogError) throw catalogError;

    const known = new Set((catalog ?? []).map((row: { key: string }) => row.key));
    const unknownKeys = [...seen].filter((key) => !known.has(key));
    if (unknownKeys.length) {
      return NextResponse.json(
        {
          success: false,
          error: `items: unknown salary component(s): ${unknownKeys.join(', ')}`,
        },
        { status: 400 },
      );
    }

    // computeFullEarnings only honours a single balance line — a second one
    // would silently compute to zero.
    if (input.items.filter((item) => item.calc === 'balance').length > 1) {
      return NextResponse.json(
        { success: false, error: 'items: only one component may use the "balance" calculation' },
        { status: 400 },
      );
    }

    // A pct_of_basic line with no basic in the same structure evaluates to zero.
    if (
      input.items.some((item) => item.calc === 'pct_of_basic') &&
      !seen.has('basic')
    ) {
      return NextResponse.json(
        {
          success: false,
          error: 'items: a percent-of-basic component requires a "basic" component in the same structure',
        },
        { status: 400 },
      );
    }

    /* ---- Insert: a new effective-dated row, never an update (§8.1) ---- */

    const { data: inserted, error: structureError } = await db
      .from('salary_structures')
      .insert({
        employee_id: input.employee_id,
        effective_from: input.effective_from,
        monthly_gross: input.monthly_gross,
        ctc_annual: input.ctc_annual ?? null,
        note: input.note ?? null,
        created_by: admin.uid,
      })
      .select()
      .single();

    if (structureError) {
      if (structureError.code === '23505') {
        return NextResponse.json(
          {
            success: false,
            error: `A salary structure already starts on ${input.effective_from} for this employee. Pick a different effective date.`,
          },
          { status: 409 },
        );
      }
      throw structureError;
    }
    const structure = inserted as SalaryStructureRow;

    const { data: itemRows, error: itemsError } = await db
      .from('salary_structure_items')
      .insert(
        input.items.map((item) => ({
          structure_id: structure.id,
          component_key: item.component_key,
          calc: item.calc,
          amount: item.amount ?? null,
          percent: item.percent ?? null,
        })),
      )
      .select();

    if (itemsError) {
      // Never leave a structure with no lines behind — it would resolve to an
      // empty payslip for every later run.
      await db.from('salary_structures').delete().eq('id', structure.id);
      throw itemsError;
    }

    logAudit({
      performed_by: admin.uid,
      action: 'create',
      target_employee: input.employee_id,
      details: `Created salary structure effective ${input.effective_from} (monthly gross ${input.monthly_gross})`,
      ip_address: getClientIp(request),
      after_data: { ...structure, items: itemRows },
    });

    return NextResponse.json(
      {
        success: true,
        data: {
          structure: { ...structure, items: (itemRows ?? []) as SalaryStructureItemRow[] },
        },
      },
      { status: 201 },
    );
  } catch (error) {
    return errorResponse(error, 'Failed to save the salary structure. Please try again.');
  }
}
