import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
const env=Object.fromEntries(readFileSync('.env.local','utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return [l.slice(0,i).trim(),l.slice(i+1).trim()];}));
const SB_URL=env.NEXT_PUBLIC_SUPABASE_URL, ANON=env.NEXT_PUBLIC_SUPABASE_ANON_KEY, SVC=env.SUPABASE_SERVICE_ROLE_KEY;
const BASE='http://localhost:3000', PW='TestPass!23456', ref=new URL(SB_URL).hostname.split('.')[0];
const svc=createClient(SB_URL,SVC,{auth:{persistSession:false}});
function log(ok,m){console.log(`${ok?'PASS':'FAIL'}  ${m}`);if(!ok)process.exitCode=1;}
async function sess(e){const c=createClient(SB_URL,ANON,{auth:{persistSession:false}});const{data,error}=await c.auth.signInWithPassword({email:e,password:PW});if(error)throw error;return data.session;}
function cookie(s){const v=`base64-${Buffer.from(JSON.stringify(s)).toString('base64')}`;const n=`sb-${ref}-auth-token`;const M=3180;if(v.length<=M)return[`${n}=${v}`];const ch=[];for(let i=0;i<v.length;i+=M)ch.push(v.slice(i,i+M));return ch.map((c,i)=>`${n}.${i}=${c}`);}
async function api(m,p,ck,b){const r=await fetch(`${BASE}${p}`,{method:m,headers:{Cookie:ck.join('; '),'Content-Type':'application/json'},body:b?JSON.stringify(b):undefined});const j=await r.json().catch(()=>({}));return{status:r.status,body:j};}

const {data:e1}=await svc.from('employees').select('id').eq('email','emp1@demandnexus.io').single();
const ck=cookie(await sess('emp1@demandnexus.io'));

// ---------- TEST 1: breaks are excluded from worked_hours ----------
// Build a record: punched in 4h ago, 1h work + 1h break + 1h work = 2h worked (NOT 4h span).
{
  const now=Date.now();
  const punchIn=new Date(now-4*3600_000).toISOString();
  const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata'}).format(new Date());
  await svc.from('attendance').delete().eq('employee_id',e1.id).eq('date',today);
  const {data:att}=await svc.from('attendance').insert({employee_id:e1.id,date:today,punch_in:punchIn,status:'present'}).select().single();
  // segment 1: t-4h .. t-3h (1h work)
  await svc.from('attendance_segments').insert({attendance_id:att.id,segment_start:new Date(now-4*3600_000).toISOString(),segment_end:new Date(now-3*3600_000).toISOString()});
  // [break t-3h .. t-2h]
  // segment 2: t-2h .. now-open (will be closed by punch_out ~= 2h)
  await svc.from('attendance_segments').insert({attendance_id:att.id,segment_start:new Date(now-2*3600_000).toISOString(),segment_end:null});

  const r=await api('POST','/api/attendance',ck,{action:'punch_out'});
  const wh=r.body?.data?.record?.worked_hours;
  // expect ~3h (1h + 2h), NOT 4h. (segment2 open closed at now => ~2h)
  log(r.status===200 && wh!=null && wh>=2.9 && wh<=3.1, `worked_hours excludes break -> ${wh}h (expect ~3, span is 4)`);
  await svc.from('attendance').delete().eq('id',att.id);
}

// ---------- TEST 2: server-side auto punch-out credits the SHIFT, not the overrun ----------
// emp1 with no shift -> DEFAULT_SHIFT_HOURS=9, grace 5.5 -> trigger at 14.5h.
// A session open 15h (> 14.5h trigger) is auto-closed and credited exactly 9h
// (punch_out = punch_in + 9h), NOT the 15h it stayed open.
{
  const { data: prev } = await svc.from('employees').select('shift_start, shift_end').eq('id', e1.id).single();
  await svc.from('employees').update({ shift_start: null, shift_end: null }).eq('id', e1.id);
  try {
    const now=Date.now();
    const punchIn=new Date(now-15*3600_000).toISOString(); // 15h ago, > 14.5h trigger
    const day=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata'}).format(new Date(now-15*3600_000));
    await svc.from('attendance').delete().eq('employee_id',e1.id).eq('date',day);
    const {data:att}=await svc.from('attendance').insert({employee_id:e1.id,date:day,punch_in:punchIn,status:'present'}).select().single();
    await svc.from('attendance_segments').insert({attendance_id:att.id,segment_start:punchIn,segment_end:null});

    // Trigger sweep via GET (best-effort) then verify; give it a moment.
    await api('GET','/api/attendance',ck,null);
    await new Promise(r=>setTimeout(r,1500));
    const {data:after}=await svc.from('attendance').select('punch_in,punch_out,worked_hours,status,notes').eq('id',att.id).single();
    const credited9 = after?.punch_out!=null && Math.abs((after?.worked_hours??0)-9)<0.05;
    const punchOutAt9h = after?.punch_out!=null && Math.abs(new Date(after.punch_out).getTime()-(new Date(after.punch_in).getTime()+9*3600_000))<60_000;
    log(credited9, `no-shift (default 9h) 15h-open session auto-closed & credited 9h -> worked_hours=${after?.worked_hours}`);
    log(punchOutAt9h, `auto punch_out set to punch_in + 9h (not the 15h overrun) -> ${after?.punch_out}`);
    log(after?.status==='auto_punched_out', `auto-closed status=auto_punched_out -> "${after?.status}"`);
    await svc.from('attendance').delete().eq('id',att.id);
  } finally {
    await svc.from('employees').update({ shift_start: prev?.shift_start ?? null, shift_end: prev?.shift_end ?? null }).eq('id', e1.id);
  }
}

// ---------- TEST 3: shift-derived trigger + shift-credit (auto punch-out respects shift) ----------
// emp1 gets a 9h day shift 09:00 -> 18:00. trigger = 9 + 5.5 = 14.5h; credit = 9h.
// A 14h-open session must NOT be force-closed (under 14.5h trigger); a 15h one MUST
// be, and is credited exactly 9h (the shift), NOT the 15h it stayed open.
{
  const { data: prev } = await svc.from('employees').select('shift_start, shift_end').eq('id', e1.id).single();
  await svc.from('employees').update({ shift_start: '09:00', shift_end: '18:00' }).eq('id', e1.id);
  try {
    // (a) 14h open session — under 14.5h trigger — should survive.
    {
      const now = Date.now();
      const punchIn = new Date(now - 14 * 3600_000).toISOString();
      const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date(now - 14 * 3600_000));
      await svc.from('attendance').delete().eq('employee_id', e1.id).eq('date', day);
      const { data: att } = await svc.from('attendance').insert({ employee_id: e1.id, date: day, punch_in: punchIn, status: 'present' }).select().single();
      await svc.from('attendance_segments').insert({ attendance_id: att.id, segment_start: punchIn, segment_end: null });
      await api('GET', '/api/attendance', ck, null);
      await new Promise(r => setTimeout(r, 1200));
      const { data: after } = await svc.from('attendance').select('punch_out').eq('id', att.id).single();
      log(after?.punch_out == null, `day 09-18 (trigger 14.5h): 14h session stays OPEN -> punch_out=${after?.punch_out}`);
      await svc.from('attendance').delete().eq('id', att.id);
    }
    // (b) 15h open session — over 14.5h trigger — should be closed & credited 9h
    //     (the shift, NOT the 15h overrun), and flagged status=auto_punched_out.
    {
      const now = Date.now();
      const punchIn = new Date(now - 15 * 3600_000).toISOString();
      const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date(now - 15 * 3600_000));
      await svc.from('attendance').delete().eq('employee_id', e1.id).eq('date', day);
      const { data: att } = await svc.from('attendance').insert({ employee_id: e1.id, date: day, punch_in: punchIn, status: 'present' }).select().single();
      await svc.from('attendance_segments').insert({ attendance_id: att.id, segment_start: punchIn, segment_end: null });
      await api('GET', '/api/attendance', ck, null);
      await new Promise(r => setTimeout(r, 1200));
      const { data: after } = await svc.from('attendance').select('punch_out, worked_hours, status').eq('id', att.id).single();
      const ok = after?.punch_out != null && Math.abs((after?.worked_hours ?? 0) - 9) < 0.05;
      log(ok, `day 09-18: 15h session auto-closed & credited exactly 9h (not 15h) -> worked_hours=${after?.worked_hours}`);
      log(after?.status === 'auto_punched_out', `auto-closed session has status=auto_punched_out -> "${after?.status}"`);
      await svc.from('attendance').delete().eq('id', att.id);
    }
  } finally {
    await svc.from('employees').update({ shift_start: prev?.shift_start ?? null, shift_end: prev?.shift_end ?? null }).eq('id', e1.id);
  }
}

console.log('\nDone.');
