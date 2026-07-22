/* Netlify Edge Function: POST /api/tts — ElevenLabs text-to-speech proxy.
   Self-contained (no imports — the edge bundler rejects paths outside this
   dir); mirrors api/tts.js, keep the two in sync. Returns 501 when
   ELEVENLABS_API_KEY is not set so the client falls back to the browser
   voice. */

const VOICE_DEFAULT = 'pNInz6obpgDQGcFmaJgB'; /* "Adam" — deep, playful male */
const MODEL_DEFAULT = 'eleven_multilingual_v2';

/* env values saved via the Netlify UI can carry invisible unicode — strip it */
function cleanEnv(v) {
  return typeof v === 'string' ? v.replace(/[^\x20-\x7e]/g, '').trim() : '';
}
function getEnv(name) {
  try {
    if (typeof Netlify !== 'undefined' && Netlify.env && Netlify.env.get) {
      const v = cleanEnv(Netlify.env.get(name));
      if (v) return v;
    }
  } catch {}
  try {
    if (typeof Deno !== 'undefined' && Deno.env) {
      const v = cleanEnv(Deno.env.get(name));
      if (v) return v;
    }
  } catch {}
  try {
    if (typeof process !== 'undefined' && process.env) {
      const v = cleanEnv(process.env[name]);
      if (v) return v;
    }
  } catch {}
  return '';
}

export default async function handler(request) {
  const json = (code, obj) =>
    new Response(JSON.stringify(obj), {
      status: code,
      headers: { 'Content-Type': 'application/json' },
    });
  try {
    if (request.method !== 'POST') return json(405, { error: 'method_not_allowed' });
    const key = getEnv('ELEVENLABS_API_KEY');
    if (!key) return json(501, { error: 'tts_not_configured' });

    let body = {};
    try { body = await request.json(); } catch {}
    const text = typeof body.text === 'string' ? body.text.trim().slice(0, 3000) : '';
    if (!text) return json(400, { error: 'invalid_text' });

    const voice = getEnv('ELEVENLABS_VOICE_ID') || VOICE_DEFAULT;
    const model = getEnv('ELEVENLABS_MODEL') || MODEL_DEFAULT;
    const base = getEnv('ELEVENLABS_BASE_URL') || 'https://api.elevenlabs.io';

    const up = await fetch(base + '/v1/text-to-speech/' + voice + '?output_format=mp3_44100_128', {
      method: 'POST',
      headers: { 'xi-api-key': key, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text,
        model_id: model,
        voice_settings: { stability: 0.45, similarity_boost: 0.7, style: 0.35 },
      }),
    });
    if (!up.ok) return json(502, { error: 'tts_upstream_error', status: up.status });

    return new Response(up.body, {
      status: 200,
      headers: { 'Content-Type': 'audio/mpeg', 'Cache-Control': 'no-cache' },
    });
  } catch (err) {
    return json(500, { error: 'tts_internal', message: String((err && err.message) || err) });
  }
}

export const config = { path: '/api/tts' };
