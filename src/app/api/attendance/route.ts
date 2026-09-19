import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth, supabaseAdmin } from '@/lib/auth-helpers';
import { logAudit, getClientIp } from '@/lib/audit';
import { rateLimiters } from '@/lib/rate-limit';
import { errorResponse } from '@/lib/api-errors';
import { businessDate } from '@/lib/dates';
import { autoCloseStaleSessions, workedMsFromSegments } from '@/lib/attendance';
import { evaluateIp } from '@/lib/ip-check-server';
import { evaluateGeo } from '@/lib/geo-check-server';

/* ------------------------------------------------------------------ */
/*  GET /api/attendance                                                */
/*  Query: employeeId, month, year, date                               */
/* ------------------------------------------------------------------ */

export async function GET(request: NextRequest) {
  try {
    const user = await verifyAuth();
    const db = user.supabase;

    // Safety net: close the caller's own stale (>cap) open sessions so the
    // data returned here is accurate even if they never punched out / closed
    // the tab. Best-effort -- never block the read on it.
    autoCloseStaleSessions(db, user.uid).catch(() => {});

    const url = new URL(request.url);
    const employeeId = url.searchParams.get('employeeId');
    const month = url.searchParams.get('month');
    const year = url.searchParams.get('year');
    const date = url.searchParams.get('date');
    // `open=1` returns only the caller's currently-open session (punched in,
    // not yet out), regardless of which calendar day it started on. This is how
    // the dashboard restores an in-progress punch: an overnight / late-night
    // shift that started "yesterday" (in IST) must still surface after the
    // business date rolls over so the user sees Punch Out, not Punch In.
    // `open=all` (admin only) returns EVERY currently-open session across all
    // employees - the admin dashboard uses it so night-shift workers who
    // punched in before midnight still show as present/working.
    const openParam = url.searchParams.get('open');
    const openOnly = openParam === '1';
    const openAll = openParam === 'all' && user.role === 'admin';

    let query = db
      .from('attendance')
      .select(
        '*, attendance_segments(id, segment_start, segment_end), employees!attendance_employee_id_fkey(id, name, employee_id, department:departments!employees_department_id_fkey(name))',
      );

    // Role-based access
    if (user.role !== 'admin') {
      query = query.eq('employee_id', user.uid);
    } else if (employeeId) {
      query = query.eq('employee_id', employeeId);
    }

    // Open-session lookup: the single most recent record with no punch_out.
    // Not date-constrained so overnight shifts crossing the IST/UTC day
    // boundary are returned. Mirrors the punch-out finder below.
    if (openOnly) {
      query = query
        .is('punch_out', null)
        .not('punch_in', 'is', null)
        .order('date', { ascending: false })
        .limit(1);
      const { data, error } = await query;
      if (error) throw error;
      return NextResponse.json({ success: true, data: { records: data ?? [] } });
    }

    // All open sessions across employees (admin): no date constraint, so a
    // night-shift punch-in dated "yesterday" is still returned as working.
    if (openAll) {
      query = query
        .is('punch_out', null)
        .not('punch_in', 'is', null)
        .order('punch_in', { ascending: true });
      const { data, error } = await query;
      if (error) throw error;
      return NextResponse.json({ success: true, data: { records: data ?? [] } });
    }

    // Date filters
    if (date) {
      query = query.eq('date', date);
    } else if (month && year) {
      const m = parseInt(month, 10);
      const y = parseInt(year, 10);
      const start = `${y}-${String(m).padStart(2, '0')}-01`;
      const lastDay = new Date(y, m, 0).getDate();
      const end = `${y}-${String(m).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
      query = query.gte('date', start).lte('date', end);
    } else if (year) {
      query = query.gte('date', `${year}-01-01`).lte('date', `${year}-12-31`);
    }

    query = query.order('date', { ascending: false });

    const { data, error } = await query;
    if (error) throw error;

    return NextResponse.json({ success: true, data: { records: data ?? [] } });
  } catch (error) {
    return errorResponse(error, 'Failed to fetch attendance. Please try again.');
  }
}

/* ------------------------------------------------------------------ */
/*  POST /api/attendance                                               */
/*  Body: { action }  -- 'punch_in' | 'punch_out'                      */
/*                                                                     */
/*  IP detection & flagging are done entirely server-side; the client */
/*  cannot supply or influence the IP, flag, or bypass.                */
/* ------------------------------------------------------------------ */

/**
 * Record an IP-violation approval request for a flagged punch. Deduped to one
 * open (pending) request per employee per IST business day so repeated punches
 * don't spam admins.
 */
async function createIpViolation(
  db: Awaited<ReturnType<typeof verifyAuth>>['supabase'],
  employeeId: string,
  detectedIp: string | null,
  actionType: 'punch-in' | 'punch-out',
): Promise<void> {
  try {
    // Start of the current IST business day (users are in IST; a UTC-midnight
    // window let duplicates slip through between 00:00-05:30 IST).
    const since = new Date(`${businessDate()}T00:00:00+05:30`);
    const { data: existing } = await db
      .from('approval_requests')
      .select('id')
      .eq('employee_id', employeeId)
      .eq('type', 'ip_violation')
      .eq('status', 'pending')
      .gte('created_at', since.toISOString())
      .limit(1)
      .maybeSingle();
    if (existing) return; // already an open request today

    await db.from('approval_requests').insert({
      employee_id: employeeId,
      type: 'ip_violation',
      detected_ip: detectedIp,
      action_type: actionType,
      reason: `Punch from unrecognized IP ${detectedIp ?? 'unknown'} during ${actionType}`,
      status: 'pending',
    });
  } catch {
    /* never block the punch on violation-logging failure */
  }
}
/* ------------------------------------------------------------------ */

/**
 * Record a location-violation approval request for a punch outside every
 * approved geofence zone (or with no coordinates while geofencing is on).
 * Deduped like IP violations: one open request per employee per IST day.
 */
async function createLocationViolation(
  db: Awaited<ReturnType<typeof verifyAuth>>['supabase'],
  employeeId: string,
  detail: string,
  actionType: 'punch-in' | 'punch-out',
): Promise<void> {
  try {
    const since = new Date(`${businessDate()}T00:00:00+05:30`);
    const { data: existing } = await db
      .from('approval_requests')
      .select('id')
      .eq('employee_id', employeeId)
      .eq('type', 'location_violation')
      .eq('status', 'pending')
      .gte('created_at', since.toISOString())
      .limit(1)
      .maybeSingle();
    if (existing) return;

    await db.from('approval_requests').insert({
      employee_id: employeeId,
      type: 'location_violation',
      action_type: actionType,
      reason: `Punch ${detail} during ${actionType}`,
      status: 'pending',
    });
  } catch {
    /* never block the punch on violation-logging failure */
  }
}
/* ------------------------------------------------------------------ */

export async function POST(request: NextRequest) {
  try {
    const user = await verifyAuth();
    const db = user.supabase;

    // Rate limit: 6 punch actions per minute per user
    const rl = rateLimiters.attendance(user.uid);
    if (!rl.allowed) {
      return NextResponse.json(
        { success: false, error: 'Too many punch actions. Try again shortly.' },
        { status: 429 },
      );
    }

    const body = await request.json();
    const { action } = body as { action: 'punch_in' | 'punch_out' };

    if (!action || !['punch_in', 'punch_out'].includes(action)) {
      return NextResponse.json({ success: false, error: 'Invalid action' }, { status: 400 });
    }

    // Optional client-reported coordinates for geofencing. Unlike the IP these
    // CAN be spoofed; they are a deterrent/audit layer, not proof. Numbers are
    // sanitised here and evaluated against admin-defined zones server-side.
    const num = (v: unknown): number | null =>
      typeof v === 'number' && Number.isFinite(v) ? v : null;
    const geoLat = num((body as Record<string, unknown>).lat);
    const geoLng = num((body as Record<string, unknown>).lng);
    const geoAccuracy = num((body as Record<string, unknown>).accuracy);
    const rawWorkMode = (body as Record<string, unknown>).work_mode;
    const validModes = ['office', 'home', 'client', 'onsite'];
    const workMode = typeof rawWorkMode === 'string' && validModes.includes(rawWorkMode)
      ? rawWorkMode
      : 'office';

    const now = new Date().toISOString();
    const today = businessDate();
    // Process optional compressed selfie image
    let selfiePath: string | null = null;
    const rawSelfie = (body as Record<string, unknown>).selfie;
    if (typeof rawSelfie === 'string' && rawSelfie.startsWith('data:image/')) {
      try {
        const commaIdx = rawSelfie.indexOf(',');
        if (commaIdx !== -1) {
          const b64 = rawSelfie.slice(commaIdx + 1);
          const buf = Buffer.from(b64, 'base64');
          const ext = rawSelfie.includes('image/webp') ? 'webp' : 'jpg';
          const stamp = Date.now();
          const p = `${user.uid}/selfie_${today}_${action}_${stamp}.${ext}`;
          const { error: upErr } = await supabaseAdmin.storage
            .from('documents')
            .upload(p, buf, { contentType: `image/${ext}`, upsert: true });
          if (!upErr) {
            selfiePath = p;
          }
        }
      } catch (err) {
        console.error('[attendance] selfie upload error:', err);
      }
    }

    // SECURITY: never trust a client-supplied IP or flag. The server reads the
    // real client IP from the request and evaluates it against the allowlist /
    // blocklist / bypass setting itself. Any `ip_address` / `ip_flagged` in the
    // request body is ignored.
    const clientIp = getClientIp(request);
    const ipDecision = await evaluateIp(clientIp);

    // A blocklisted IP can never punch, regardless of action.
    if (ipDecision.blocked) {
      logAudit({
        performed_by: user.uid,
        action,
        target_employee: user.uid,
        details: `Blocked ${action} from blocklisted IP ${clientIp ?? 'unknown'}`,
        ip_address: clientIp,
      });
      return NextResponse.json(
        { success: false, error: 'Your network is blocked. Contact an administrator.' },
        { status: 403 },
      );
    }

    // Observers (tracks_attendance = false) do not participate in attendance.
    if (action === 'punch_in') {
      const { data: me } = await db
        .from('employees')
        .select('tracks_attendance')
        .eq('id', user.uid)
        .single();
      if (me && me.tracks_attendance === false) {
        return NextResponse.json(
          {
            success: false,
            error: 'Attendance tracking is disabled for this account (observer).',
          },
          { status: 403 },
        );
      }
    }


    if (action === 'punch_in') {
      // Geofence check (allow-and-flag; blocking would strand employees with
      // inaccurate GPS). Only evaluated when the admin enabled zones.
      const geoDecision = await evaluateGeo(geoLat, geoLng, geoAccuracy);
      const modeLabels: Record<string, string> = {
        office: 'Office',
        home: 'Work From Home',
        client: 'Client Site',
        onsite: 'On-site / Field',
      };
      const modeStr = modeLabels[workMode] ?? 'Office';
      const geoNoteParts = [`Mode: ${modeStr}`];
      if (geoDecision.enforced) {
        geoNoteParts.push(geoDecision.flagged ? geoDecision.detail : `Zone: ${geoDecision.matchedZone}`);
      }
      const geoNote = geoNoteParts.join(' | ');

      // Close any stale (>trigger) open session first so a forgotten punch-in
      // from a previous day cannot block today's punch or skew worked_hours.
      await autoCloseStaleSessions(db, user.uid, new Date(now));

      // Block re-punch if the user already has an OPEN session from ANY day.
      // The UNIQUE(employee_id, date) constraint only stops two records on the
      // SAME date; an overnight / forgotten session dated "yesterday" (in IST)
      // would otherwise let a second punch-in slip through on a new date and
      // create two simultaneous open sessions. We therefore check open
      // sessions independently of `today`.
      const { data: openSession } = await db
        .from('attendance')
        .select('id, date, punch_in')
        .eq('employee_id', user.uid)
        .is('punch_out', null)
        .not('punch_in', 'is', null)
        .order('date', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (openSession) {
        return NextResponse.json(
          {
            success: false,
            error: 'You are already punched in. Please punch out before punching in again.',
          },
          { status: 409 },
        );
      }

      const { data: existing } = await db
        .from('attendance')
        .select('id, punch_in, punch_out')
        .eq('employee_id', user.uid)
        .eq('date', today)
        .maybeSingle();

      if (existing) {
        // A complete record (already punched out) blocks re-punching for the
        // day. An orphan row with no punch_in is repaired by setting punch_in
        // now (defensive; should not normally happen). (An *open* in-progress
        // record was already handled by the open-session check above.)
        if (existing.punch_in) {
          return NextResponse.json(
            { success: false, error: 'You have already completed your shift for today.' },
            { status: 409 },
          );
        }

        const { data: repaired, error: repErr } = await db
          .from('attendance')
          .update({
            punch_in: now,
            status: 'present',
            ip_address: ipDecision.ip,
            ip_flagged: ipDecision.flagged,
            ...(geoNote ? { notes: geoNote } : {}),
            ...(selfiePath ? { punch_in_selfie_url: selfiePath } : {}),
            work_mode: workMode,
          })
          .eq('id', existing.id)
          .select()
          .single();
        if (repErr) throw repErr;
        await db.from('attendance_segments').insert({ attendance_id: repaired.id, segment_start: now });
        if (ipDecision.flagged) {
          await createIpViolation(db, user.uid, ipDecision.ip, 'punch-in');
        }
        if (geoDecision.flagged) {
          await createLocationViolation(db, user.uid, geoDecision.detail, 'punch-in');
        }
        return NextResponse.json({ success: true, data: { record: repaired } }, { status: 201 });
      }

      const { data, error } = await db
        .from('attendance')
        .insert({
          employee_id: user.uid,
          date: today,
          punch_in: now,
          status: 'present',
          ip_address: ipDecision.ip,
          ip_flagged: ipDecision.flagged,
          ...(geoNote ? { notes: geoNote } : {}),
          ...(selfiePath ? { punch_in_selfie_url: selfiePath } : {}),
          work_mode: workMode,
        })
        .select()
        .single();

      if (error) throw error;

      if (ipDecision.flagged) {
        await createIpViolation(db, user.uid, ipDecision.ip, 'punch-in');
      }
      if (geoDecision.flagged) {
        await createLocationViolation(db, user.uid, geoDecision.detail, 'punch-in');
      }

      logAudit({
        performed_by: user.uid,
        action: 'punch_in',
        target_employee: user.uid,
        details: `Punch in at ${now}${ipDecision.flagged ? ` (IP flagged: ${ipDecision.ip ?? 'unknown'})` : ''}${geoDecision.flagged ? ` (location flagged: ${geoDecision.detail})` : ''}`,
        ip_address: ipDecision.ip,
        after_data: data,
      });

      return NextResponse.json({ success: true, data: { record: data } }, { status: 201 });
    }

    // punch_out -- find the most recent OPEN punch (no punch_out yet).
    // We do not constrain to `today` so a shift that crosses the IST/UTC
    // day boundary still closes the correct record.
    const { data: openRecord, error: findErr } = await db
      .from('attendance')
      .select('*')
      .eq('employee_id', user.uid)
      .is('punch_out', null)
      .order('date', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (findErr) throw findErr;
    if (!openRecord) {
      return NextResponse.json({ success: false, error: 'No open punch-in found for today' }, { status: 400 });
    }

    // Worked hours = sum of WORK segments (segments are work intervals; the
    // gaps between them are breaks). This excludes break/pause time. Falls
    // back to the raw punch span only if no segments exist (legacy records).
    const { data: segs } = await db
      .from('attendance_segments')
      .select('segment_start, segment_end')
      .eq('attendance_id', openRecord.id);

    const workedMs = workedMsFromSegments(segs ?? [], openRecord.punch_in, new Date(now));
    const workedHours = Math.round((workedMs / (1000 * 60 * 60)) * 100) / 100;

    // Close any still-open segment so stored data matches worked_hours.
    await db
      .from('attendance_segments')
      .update({ segment_end: now })
      .eq('attendance_id', openRecord.id)
      .is('segment_end', null);

    const { data, error } = await db
      .from('attendance')
      .update({
        punch_out: now,
        worked_hours: workedHours,
        ...(selfiePath ? { punch_out_selfie_url: selfiePath } : {}),
        work_mode: workMode,
      })
      .eq('id', openRecord.id)
      .select()
      .single();

    if (error) throw error;

    if (ipDecision.flagged) {
      await createIpViolation(db, user.uid, ipDecision.ip, 'punch-out');
    }

    logAudit({
      performed_by: user.uid,
      action: 'punch_out',
      target_employee: user.uid,
      details: `Punch out at ${now}, worked ${workedHours}h${ipDecision.flagged ? ` (IP flagged: ${ipDecision.ip ?? 'unknown'})` : ''}`,
      ip_address: ipDecision.ip,
      before_data: openRecord,
      after_data: data,
    });

    return NextResponse.json({ success: true, data: { record: data } });
  } catch (error) {
    return errorResponse(error, 'Failed to record attendance. Please try again.');
  }
}

/* ------------------------------------------------------------------ */
/*  DELETE /api/attendance                                             */
/*  Body: { id }  -- admin only                                        */
/* ------------------------------------------------------------------ */

export async function DELETE(request: NextRequest) {
  try {
    const user = await verifyAuth();
    const db = user.supabase;
    if (user.role !== 'admin') {
      return NextResponse.json({ success: false, error: 'Admin access required' }, { status: 403 });
    }

    const { id } = (await request.json()) as { id: string };
    if (!id) {
      return NextResponse.json({ success: false, error: 'Missing id' }, { status: 400 });
    }

    // Fetch before delete for audit
    const { data: before } = await db.from('attendance').select('*').eq('id', id).single();

    const { error } = await db.from('attendance').delete().eq('id', id);
    if (error) throw error;

    logAudit({
      performed_by: user.uid,
      action: 'delete',
      target_employee: before?.employee_id,
      details: `Deleted attendance record ${id} for date ${before?.date}`,
      ip_address: getClientIp(request),
      before_data: before,
    });

    return NextResponse.json({ success: true, data: { deleted: id } });
  } catch (error) {
    return errorResponse(error, 'Failed to delete attendance. Please try again.');
  }
}

/* ------------------------------------------------------------------ */
/*  PATCH /api/attendance                                              */
/*  Admin: edit attendance record. Body: { id, date?, punch_in?, etc } */
/*  Admin: add attendance record. Body: { employee_id, date, ... }     */
/* ------------------------------------------------------------------ */

export async function PATCH(request: NextRequest) {
  try {
    const user = await verifyAuth();
    const db = user.supabase;
    if (user.role !== 'admin') {
      return NextResponse.json({ success: false, error: 'Admin access required' }, { status: 403 });
    }

    const body = await request.json();
    const { id, employee_id, ...fields } = body;

    if (id) {
      // Fetch before for audit
      const { data: before } = await db.from('attendance').select('*').eq('id', id).single();

      const { data, error } = await db
        .from('attendance')
        .update(fields)
        .eq('id', id)
        .select()
        .single();
      if (error) throw error;

      logAudit({
        performed_by: user.uid,
        action: 'update',
        target_employee: data.employee_id,
        details: `Admin edited attendance record ${id}`,
        ip_address: getClientIp(request),
        before_data: before,
        after_data: data,
      });

      return NextResponse.json({ success: true, data: { record: data } });
    } else if (employee_id) {
      const { data, error } = await db
        .from('attendance')
        .insert({ employee_id, ...fields })
        .select()
        .single();
      if (error) throw error;

      logAudit({
        performed_by: user.uid,
        action: 'create',
        target_employee: employee_id,
        details: `Admin added attendance record for ${employee_id} on ${fields.date}`,
        ip_address: getClientIp(request),
        after_data: data,
      });

      return NextResponse.json({ success: true, data: { record: data } }, { status: 201 });
    } else {
      return NextResponse.json({ success: false, error: 'Missing id or employee_id' }, { status: 400 });
    }
  } catch (error) {
    return errorResponse(error, 'Failed to update attendance. Please try again.');
  }
}
