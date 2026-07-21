/* Thin Supabase REST (PostgREST) client used by the api/ functions.
   The publishable key is designed to be public; access is scoped by RLS
   policies (see supabase/setup.sql). Override via env for other projects. */

const SUPABASE_URL = (process.env.SUPABASE_URL || 'https://fussflufpfkvkijoxnjg.supabase.co').replace(/\/+$/, '');
const SUPABASE_KEY = process.env.SUPABASE_KEY || 'sb_publishable_Is1WTqh8ojmi9fz9N__mzA_wY8AxWIJ';

export async function sb(path, init = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  });
}

/* PostgREST returns PGRST205 / 404 when the table doesn't exist yet
   (setup.sql not run). Callers translate this into a graceful 503. */
export function isDbNotReady(status) {
  return status === 404;
}
