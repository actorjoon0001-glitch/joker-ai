/* /api/media — 힉스필드(Higgsfield) 이미지 생성 프록시.
   POST {op:'create', prompt} → 생성 잡 시작 {id}
   GET ?id=...             → {status, url}  (completed 시 이미지 URL)
   HIGGSFIELD_CREDENTIALS("keyId:secret") 미설정 시 501을 반환하고
   프론트는 카드에 설정 안내를 띄운다. 키는 cloud.higgsfield.ai/api-keys에서 발급. */

function creds() {
  const combo = process.env.HIGGSFIELD_CREDENTIALS || process.env.HF_CREDENTIALS;
  if (combo && combo.includes(':')) return combo.trim();
  const k = process.env.HIGGSFIELD_API_KEY;
  const s = process.env.HIGGSFIELD_API_SECRET;
  return k && s ? k + ':' + s : null;
}

const base = () => (process.env.HIGGSFIELD_BASE_URL || 'https://platform.higgsfield.ai').replace(/\/+$/, '');

export default async function handler(req, res) {
  const c = creds();
  if (!c) {
    res.status(501).json({ error: 'media_not_configured' });
    return;
  }
  const headers = {
    Authorization: 'Key ' + c,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };

  try {
    if (req.method === 'POST') {
      const b = req.body || {};
      if (b.op !== 'create') { res.status(400).json({ error: 'invalid_op' }); return; }
      const prompt = typeof b.prompt === 'string' ? b.prompt.trim().slice(0, 1500) : '';
      if (!prompt) { res.status(400).json({ error: 'invalid_prompt' }); return; }
      const r = await fetch(base() + '/higgsfield-ai/soul/standard', {
        method: 'POST',
        headers,
        body: JSON.stringify({ prompt, aspect_ratio: '16:9', resolution: '720p' }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        console.error('[joker media] create', r.status, JSON.stringify(j).slice(0, 300));
        res.status(502).json({ error: 'media_upstream', status: r.status });
        return;
      }
      res.status(200).json({ id: j.request_id || j.id || null });
      return;
    }

    if (req.method === 'GET') {
      const id = (req.query && req.query.id) || '';
      if (!/^[\w-]{4,80}$/.test(id)) { res.status(400).json({ error: 'invalid_id' }); return; }
      const r = await fetch(base() + '/requests/' + id + '/status', { headers });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        console.error('[joker media] status', r.status, JSON.stringify(j).slice(0, 300));
        res.status(502).json({ error: 'media_upstream', status: r.status });
        return;
      }
      let url = null;
      if (j.status === 'completed') {
        if (Array.isArray(j.images) && j.images[0] && j.images[0].url) url = j.images[0].url;
        else if (j.video && j.video.url) url = j.video.url;
        else if (Array.isArray(j.results) && j.results[0] && j.results[0].url) url = j.results[0].url;
      }
      res.status(200).json({ status: j.status || 'unknown', url });
      return;
    }

    res.status(405).json({ error: 'method_not_allowed' });
  } catch (err) {
    console.error('[joker media]', err);
    res.status(500).json({ error: 'internal_error' });
  }
}
