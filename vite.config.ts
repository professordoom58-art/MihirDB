import dns from 'node:dns'
import https from 'node:https'
import net from 'node:net'
import type { LookupFunction } from 'node:net'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

/**
 * Some ISPs (e.g. Jio) DNS-block api.themoviedb.org. The dev proxy resolves it
 * through public DNS instead, so search works on the laptop, on the phone over
 * Wi-Fi, and in the live-reload iOS build (all of which go through this server).
 */
const resolver = new dns.Resolver()
resolver.setServers(['1.1.1.1', '8.8.8.8'])
const publicLookup: LookupFunction = (hostname, options, callback) => {
  resolver.resolve4(hostname, (err, addrs) => {
    if (err || !addrs.length) return dns.lookup(hostname, options, callback)
    if (options?.all) callback(null, addrs.map((address) => ({ address, family: 4 })))
    else callback(null, addrs[0], 4)
  })
}
const tmdbAgent = new https.Agent({ keepAlive: true, lookup: publicLookup })
// Same path as the Vercel rewrite in vercel.json: /api/tmdb/* → api.tmdb.org/3/*
const tmdbProxy = {
  '/api/tmdb': {
    target: 'https://api.tmdb.org',
    changeOrigin: true,
    agent: tmdbAgent,
    rewrite: (p: string) => p.replace(/^\/api\/tmdb/, '/3'),
  },
}

/** Dev-only: lets the old-catalog importer fetch a public web page without CORS. */
function pageFetcher(): Plugin {
  const isPrivate = (host: string) =>
    host === 'localhost' ||
    host.endsWith('.local') ||
    (net.isIP(host) !== 0 && /^(10\.|127\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|::1|f[cd])/i.test(host))
  return {
    name: 'shelf-page-fetcher',
    configureServer(server) {
      server.middlewares.use('/__fetch', async (req, res) => {
        try {
          const target = new URL(new URL(req.url ?? '', 'http://x').searchParams.get('url') ?? '')
          if (!/^https?:$/.test(target.protocol) || isPrivate(target.hostname)) throw new Error('bad url')
          const r = await fetch(target, { headers: { 'user-agent': 'Mozilla/5.0 ShelfImporter' }, redirect: 'follow' })
          const body = await r.text()
          res.statusCode = r.status
          res.setHeader('content-type', 'text/plain; charset=utf-8')
          res.end(body.slice(0, 5_000_000))
        } catch (e) {
          res.statusCode = 400
          res.end(String((e as Error).message))
        }
      })
    },
  }
}

export default defineConfig({
  plugins: [
    react(),
    pageFetcher(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: false, // registered manually (skipped inside the native app)
      // serve the manifest from the dev server too, so 'Add to Home Screen' works over Wi-Fi
      devOptions: { enabled: true, type: 'module' },
      includeAssets: ['icons/apple-touch-icon.png', 'icons/favicon.png'],
      manifest: {
        name: 'Shelf',
        short_name: 'Shelf',
        description: 'My movie shelf',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#050506',
        theme_color: '#050506',
        start_url: '.',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,png,svg,woff2}'],
        navigateFallback: 'index.html',
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.hostname === 'image.tmdb.org' || url.hostname === 'm.media-amazon.com',
            handler: 'CacheFirst',
            options: {
              cacheName: 'posters',
              expiration: { maxEntries: 1500, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
    }),
  ],
  server: { port: 5173, proxy: tmdbProxy },
  preview: { port: 4173, proxy: tmdbProxy },
})
