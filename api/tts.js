/* POST /api/tts — turns Joker's reply text into speech via ElevenLabs and
   returns MP3 audio. Returns 501 (tts_not_configured) when ELEVENLABS_API_KEY
   is not set, so the client silently falls back to the browser's built-in
   voice. On Netlify this path is served by the edge function instead
   (netlify/edge-functions/tts.js — keep the two in sync). */

const VOICE_DEFAULT = 'pNInz6obpgDQGcFmaJgB'; /* "Adam" — deep, playful male */
const MODEL_DEFAULT = 'eleven_multilingual_v2';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'method_not_allowed' });
    return;
  }
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) {
    res.status(501).json({ error: 'tts_not_configured' });
    return;
  }
  const text =
    req.body && typeof req.body.text === 'string' ? req.body.text.trim().slice(0, 3000) : '';
  if (!text) {
    res.status(400).json({ error: 'invalid_text' });
    return;
  }

  const voice = process.env.ELEVENLABS_VOICE_ID || VOICE_DEFAULT;
  const model = process.env.ELEVENLABS_MODEL || MODEL_DEFAULT;
  const base = process.env.ELEVENLABS_BASE_URL || 'https://api.elevenlabs.io';

  try {
    const up = await fetch(`${base}/v1/text-to-speech/${voice}?output_format=mp3_44100_128`, {
      method: 'POST',
      headers: { 'xi-api-key': key, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text,
        model_id: model,
        voice_settings: { stability: 0.45, similarity_boost: 0.7, style: 0.35 },
      }),
    });
    if (!up.ok) {
      console.error('[joker tts] upstream', up.status, await up.text().catch(() => ''));
      res.status(502).json({ error: 'tts_upstream_error' });
      return;
    }
    const buf = Buffer.from(await up.arrayBuffer());
    res.statusCode = 200;
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Cache-Control', 'no-cache');
    res.end(buf);
  } catch (err) {
    console.error('[joker tts]', err);
    res.status(502).json({ error: 'tts_upstream_error' });
  }
}
