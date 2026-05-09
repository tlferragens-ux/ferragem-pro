// lib/supabaseAdmin.js
// Cliente Supabase com service_role key (uso APENAS em serverless)

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://sqsrkeizkjscaktdweon.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error('SUPABASE_SERVICE_ROLE_KEY não configurada nas variáveis de ambiente');
}

export const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});
