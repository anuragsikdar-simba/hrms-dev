#!/usr/bin/env node
/**
 * Run SQL against Supabase via Management API
 * Usage: node scripts/sb-sql.js "SQL HERE"
 *   or:  node scripts/sb-sql.js path/to/file.sql
 */
const https = require('https');
const fs = require('fs');

const TOKEN = process.env.SUPABASE_ACCESS_TOKEN || '';
const REF = process.env.SUPABASE_PROJECT_REF || '';

function runSQL(sql) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ query: sql });
    const opts = {
      hostname: 'api.supabase.com',
      port: 443,
      path: `/v1/projects/${REF}/database/query`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${TOKEN}`,
        'Content-Length': Buffer.byteLength(body),
      },
    };
    const req = https.request(opts, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => resolve({ status: res.statusCode, body: d }));
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function main() {
  let sql = process.argv[2];
  if (!sql) { console.error('Usage: node sb-sql.js "SQL" or node sb-sql.js file.sql'); process.exit(1); }
  
  // If it looks like a file path, read it
  if (sql.endsWith('.sql') && fs.existsSync(sql)) {
    sql = fs.readFileSync(sql, 'utf8');
  }

  const result = await runSQL(sql);
  console.log(`Status: ${result.status}`);
  console.log(result.body);
}

main().catch(e => { console.error(e); process.exit(1); });

module.exports = { runSQL };
