(function () {
  'use strict';

  const SUPABASE_URL = 'https://lrvuuncsmkxkrdqinruh.supabase.co';
  const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_0JKXyU9GxKmg_MGR8YApLw_dXehi5Pm';

  if (!window.supabase?.createClient) {
    throw new Error('Supabase client library was not loaded.');
  }

  window.supabaseClient = window.supabase.createClient(
    SUPABASE_URL,
    SUPABASE_PUBLISHABLE_KEY,
    {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true
      }
    }
  );
})();
