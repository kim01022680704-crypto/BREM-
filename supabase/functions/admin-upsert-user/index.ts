import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceRoleKey) {
    return json({ error: 'Missing Supabase Edge Function environment' }, 500);
  }

  const authHeader = req.headers.get('Authorization') || '';
  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  });

  const token = authHeader.replace(/^Bearer\s+/i, '');
  const { data: callerData, error: callerError } = await adminClient.auth.getUser(token);
  if (callerError || !callerData.user) {
    return json({ error: 'Unauthorized' }, 401);
  }

  const { data: callerProfile, error: profileError } = await adminClient
    .from('profiles')
    .select('role, active')
    .eq('user_id', callerData.user.id)
    .maybeSingle();

  if (profileError || callerProfile?.role !== 'admin' || callerProfile.active !== true) {
    return json({ error: 'Admin permission required' }, 403);
  }

  const body = await req.json().catch(() => ({}));
  const email = String(body.email || '').trim().toLowerCase();
  const password = String(body.password || '');
  const role = body.role === 'rider' ? 'rider' : 'admin';
  const riderId = role === 'rider' ? String(body.riderId || '').trim() : null;
  const displayName = String(body.displayName || '').trim();

  if (!email || !password || password.length < 8) {
    return json({ error: 'Email and password(8+ chars) are required' }, 400);
  }
  if (role === 'rider' && !riderId) {
    return json({ error: 'riderId is required for rider account' }, 400);
  }

  const { data: created, error: createError } = await adminClient.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { role, rider_id: riderId, display_name: displayName }
  });

  if (createError) {
    return json({ error: createError.message }, 400);
  }

  const userId = created.user.id;
  const { error: upsertProfileError } = await adminClient.from('profiles').upsert({
    user_id: userId,
    role,
    rider_id: riderId,
    display_name: displayName || email,
    active: true
  }, { onConflict: 'user_id' });

  if (upsertProfileError) {
    return json({ error: upsertProfileError.message }, 400);
  }

  if (role === 'rider' && riderId) {
    const { error: riderError } = await adminClient
      .from('riders')
      .update({ auth_user_id: userId })
      .eq('id', riderId);
    if (riderError) return json({ error: riderError.message }, 400);
  }

  return json({ ok: true, userId, role, riderId });
});

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  });
}
