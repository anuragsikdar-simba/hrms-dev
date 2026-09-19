#!/usr/bin/env node
import { createClient } from '@supabase/supabase-js';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';

// 1. Read environment variables from .env.local
const envPath = resolve(process.cwd(), '.env.local');
if (!existsSync(envPath)) {
  console.error('Error: .env.local file not found.');
  process.exit(1);
}

const env = Object.fromEntries(
  readFileSync(envPath, 'utf8')
    .split('\n')
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    })
);

const SB_URL = env.NEXT_PUBLIC_SUPABASE_URL;
const SVC_KEY = env.SUPABASE_SERVICE_ROLE_KEY;

if (!SB_URL || !SVC_KEY || SB_URL.includes('dummy.supabase.co')) {
  console.error('\n[!] Cannot connect to Supabase backend:');
  console.error('    NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local');
  console.error('    are currently set to placeholder dummy values.');
  console.error('\n    Please set your actual Supabase project URL and service_role key in .env.local first.\n');
  process.exit(1);
}

const admin = createClient(SB_URL, SVC_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// 2. Parse arguments or use defaults
const email = process.argv[2] || 'admin@demandnexus.io';
const password = process.argv[3] || 'DemandNexus@2026';
const name = process.argv[4] || 'Admin User';
const employeeId = process.argv[5] || 'ADM001';

async function main() {
  console.log(`\n--- August HRMS: Provisioning Admin Account ---`);
  console.log(`Target Supabase URL: ${SB_URL}`);
  console.log(`Email:               ${email}`);
  console.log(`Name:                ${name}`);
  console.log(`Employee ID:         ${employeeId}\n`);

  // Step A: Create or update Auth User
  let authUserId;
  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });

  if (created?.user) {
    authUserId = created.user.id;
    console.log(`[✓] Supabase Auth user created (Auth UID: ${authUserId})`);
  } else if (createErr && /already.*registered|already been registered/i.test(createErr.message)) {
    console.log(`[*] User already exists in Supabase Auth. Updating password...`);
    const { data: listData, error: listErr } = await admin.auth.admin.listUsers();
    if (listErr) throw listErr;
    const existing = listData.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
    if (!existing) throw new Error(`Could not find existing user with email ${email}`);
    authUserId = existing.id;
    await admin.auth.admin.updateUserById(authUserId, { password, email_confirm: true });
    console.log(`[✓] Password successfully reset for existing user (Auth UID: ${authUserId})`);
  } else {
    throw createErr;
  }

  // Step B: Ensure employee profile exists with role: 'admin'
  const { data: existingEmp, error: empFindErr } = await admin
    .from('employees')
    .select('id, email, role, employee_id')
    .eq('email', email)
    .maybeSingle();

  if (empFindErr) {
    console.warn(`[!] Note: Could not query employees table: ${empFindErr.message}`);
    console.warn(`    If the database schema has not been migrated yet, run supabase/schema.sql first.`);
    return;
  }

  if (existingEmp) {
    console.log(`[*] Updating existing employee profile in database...`);
    const { error: updErr } = await admin
      .from('employees')
      .update({
        auth_user_id: authUserId,
        role: 'admin',
        status: 'active',
        must_reset_password: false,
      })
      .eq('id', existingEmp.id);
    if (updErr) throw updErr;
    console.log(`[✓] Employee profile updated to admin.`);
  } else {
    console.log(`[*] Creating new employee profile in database...`);
    const { error: insErr } = await admin.from('employees').insert({
      employee_id: employeeId,
      name,
      email,
      role: 'admin',
      auth_user_id: authUserId,
      status: 'active',
      tracks_attendance: false,
      must_reset_password: false,
    });
    if (insErr) throw insErr;
    console.log(`[✓] Employee record created successfully.`);
  }

  console.log(`\n======================================================`);
  console.log(`  ADMIN ACCOUNT READY FOR LOGIN`);
  console.log(`======================================================`);
  console.log(`  Login URL: http://localhost:3000/login`);
  console.log(`  Email:     ${email}`);
  console.log(`  Password:  ${password}`);
  console.log(`======================================================\n`);
}

main().catch((err) => {
  console.error(`\n[X] Error provisioning admin:`, err.message || err);
  process.exit(1);
});
