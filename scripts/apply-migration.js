/**
 * Apply database migration via Supabase REST API (pg client)
 * Usage: node scripts/apply-migration.js
 */
const { execSync } = require('child_process');
const https = require('https');

// Read .env.local
const fs = require('fs');
const envContent = fs.readFileSync('.env.local', 'utf8');
const getEnv = (k) => {
  const m = envContent.match(new RegExp('^' + k + '=(.*)$', 'm'));
  return m ? m[1].trim() : null;
};

const SUPABASE_URL = getEnv('NEXT_PUBLIC_SUPABASE_URL');
const SERVICE_ROLE_KEY = getEnv('SUPABASE_SERVICE_ROLE_KEY');

// We'll use Supabase's RPC to execute raw SQL via the REST API
// using the pg extension approach

async function supabaseRpc(sql) {
  return new Promise((resolve, reject) => {
    const url = new URL('/rest/v1/rpc/exec_sql', SUPABASE_URL);
    const body = JSON.stringify({ sql });
    
    const opts = {
      hostname: url.hostname,
      path: url.pathname + url.search,
      method: 'POST',
      headers: {
        'apikey': SERVICE_ROLE_KEY,
        'Authorization': `Bearer ${SERVICE_ROLE_KEY}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        'Prefer': 'return=representation'
      }
    };

    const req = https.request(opts, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, data }); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// Use Supabase JS client with raw SQL workaround
const { createClient } = require('@supabase/supabase-js');
const client = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false }
});

const migrations = [
  {
    name: 'Add updated_at to deposits',
    sql: `ALTER TABLE public.deposits ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()`
  },
  {
    name: 'Add updated_at to user_profiles',
    sql: `ALTER TABLE public.user_profiles ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()`
  },
  {
    name: 'Add is_enabled to withdrawal_settings',
    sql: `ALTER TABLE public.withdrawal_settings ADD COLUMN IF NOT EXISTS is_enabled BOOLEAN DEFAULT true`
  },
  {
    name: 'Add description to system_settings',
    sql: `ALTER TABLE public.system_settings ADD COLUMN IF NOT EXISTS description TEXT`
  },
  {
    name: 'Add category to system_settings',
    sql: `ALTER TABLE public.system_settings ADD COLUMN IF NOT EXISTS category TEXT`
  },
  {
    name: 'Add is_public to system_settings',
    sql: `ALTER TABLE public.system_settings ADD COLUMN IF NOT EXISTS is_public BOOLEAN DEFAULT false`
  },
];

async function applyMigrations() {
  console.log('🚀 Applying database migrations via Supabase...\n');
  
  for (const migration of migrations) {
    try {
      const { data, error } = await client.rpc('exec_ddl', { ddl_statement: migration.sql }).single();
      if (error) {
        // Try alternative approach
        console.log(`⚠️  RPC not available for: ${migration.name}`);
        console.log(`   Error: ${error.message}`);
      } else {
        console.log(`✅ Applied: ${migration.name}`);
      }
    } catch (err) {
      console.log(`⚠️  Error applying "${migration.name}": ${err.message}`);
    }
  }
  
  console.log('\n📋 Verifying current state...');
  
  const { data: depSample } = await client.from('deposits').select('*').limit(1);
  if (depSample && depSample.length > 0) {
    console.log('deposits columns:', Object.keys(depSample[0]));
    console.log('has updated_at:', 'updated_at' in depSample[0]);
  }
  
  const { data: upSample } = await client.from('user_profiles').select('*').limit(1);
  if (upSample && upSample.length > 0) {
    console.log('user_profiles has updated_at:', 'updated_at' in upSample[0]);
  }
}

applyMigrations();
