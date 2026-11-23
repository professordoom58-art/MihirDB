// Optional: a tiny TMDB proxy for networks that block api.themoviedb.org (e.g. Jio).
// Deploy free on Cloudflare Workers (dash.cloudflare.com → Workers → Create → paste this),
// then set VITE_TMDB_BASE=https://<your-worker>.workers.dev/3 (or paste it in Settings).
// It only forwards GET requests under /3/ to TMDB; your API key still travels with each call.
export default {
  async fetch(req) {
    const url = new URL(req.url)
    const cors = {
      'access-control-allow-origin': '*',
      'access-control-allow-headers': 'authorization, accept',
      'access-control-allow-methods': 'GET, OPTIONS',
    }
    if (req.method === 'OPTIONS') return new Response(null, { headers: cors })
    if (req.method !== 'GET' || !url.pathname.startsWith('/3/')) return new Response('Not found', { status: 404, headers: cors })

    const upstream = new URL(url.pathname + url.search, 'https://api.themoviedb.org')
    const headers = { accept: 'application/json' }
    const auth = req.headers.get('authorization')
    if (auth) headers.authorization = auth
    const res = await fetch(upstream, { headers, cf: { cacheTtl: 3600 } })
    const out = new Response(res.body, res)
    for (const [k, v] of Object.entries(cors)) out.headers.set(k, v)
    return out
  },
}
