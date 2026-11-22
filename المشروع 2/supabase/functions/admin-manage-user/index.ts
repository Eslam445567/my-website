import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, 'Content-Type': 'application/json' }
});

Deno.serve(async request => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const secretKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_SECRET_KEY');
    if (!secretKey) return json({ error: 'Missing server secret key.' }, 500);

    const authorization = request.headers.get('Authorization');
    if (!authorization?.startsWith('Bearer ')) return json({ error: 'Unauthorized.' }, 401);
    const accessToken = authorization.slice('Bearer '.length);
    const admin = createClient(supabaseUrl, secretKey);

    const { data: callerData, error: callerError } = await admin.auth.getUser(accessToken);
    if (callerError || !callerData.user) return json({ error: 'Unauthorized.' }, 401);

    const { data: callerProfile, error: profileError } = await admin
      .from('profiles')
      .select('role,is_active')
      .eq('id', callerData.user.id)
      .single();
    if (profileError || callerProfile?.role !== 'admin' || !callerProfile.is_active) {
      return json({ error: 'Admin access required.' }, 403);
    }

    const body = await request.json();
    const action = body.action;

    if (action === 'create') {
      const email = String(body.email || '').trim();
      const password = String(body.password || '');
      const name = String(body.name || '').trim();
      const username = String(body.username || '').trim();
      if (!email || !password || password.length < 6 || !name || !username) {
        return json({ error: 'Name, username, email, and a six-character password are required.' }, 400);
      }

      const { data: created, error: createError } = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true
      });
      if (createError || !created.user) return json({ error: createError?.message || 'Could not create Auth user.' }, 400);

      const { error: insertError } = await admin.from('profiles').insert({
        id: created.user.id,
        name,
        username,
        role: 'marketer',
        is_active: true
      });
      if (insertError) {
        await admin.auth.admin.deleteUser(created.user.id);
        return json({ error: insertError.message }, 400);
      }
      return json({ ok: true, userId: created.user.id });
    }

    const userId = String(body.userId || '').trim();
    if (!userId) return json({ error: 'userId is required.' }, 400);

    if (action === 'toggle') {
      const { data: profile, error } = await admin.from('profiles').select('is_active,role').eq('id', userId).single();
      if (error || profile?.role !== 'marketer') return json({ error: 'Marketer not found.' }, 404);
      const { error: updateError } = await admin.from('profiles').update({ is_active: !profile.is_active }).eq('id', userId);
      if (updateError) return json({ error: updateError.message }, 400);
      return json({ ok: true });
    }

    if (action === 'deactivate') {
      const { error } = await admin.from('profiles').update({ is_active: false }).eq('id', userId).eq('role', 'marketer');
      if (error) return json({ error: error.message }, 400);
      return json({ ok: true });
    }

    if (action === 'update') {
      const profileUpdates: Record<string, unknown> = {};
      if (body.name != null) profileUpdates.name = String(body.name).trim();
      if (body.username != null) profileUpdates.username = String(body.username).trim();
      if (body.isActive != null) profileUpdates.is_active = Boolean(body.isActive);
      if (Object.keys(profileUpdates).length) {
        const { error } = await admin.from('profiles').update(profileUpdates).eq('id', userId).eq('role', 'marketer');
        if (error) return json({ error: error.message }, 400);
      }
      if (body.password) {
        const password = String(body.password);
        if (password.length < 6) return json({ error: 'Password must contain at least six characters.' }, 400);
        const { error } = await admin.auth.admin.updateUserById(userId, { password });
        if (error) return json({ error: error.message }, 400);
      }
      return json({ ok: true });
    }

    return json({ error: 'Unknown action.' }, 400);
  } catch (error) {
    console.error(error);
    return json({ error: error instanceof Error ? error.message : 'Unexpected error.' }, 500);
  }
});
