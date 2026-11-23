/**
 * API keys are baked in at build time from .env (or the GitHub Actions secret for
 * the IPA). The app never asks for a key.
 *
 *   VITE_TMDB_API_KEY     v3 key            (either one works)
 *   VITE_TMDB_READ_TOKEN  v4 Bearer token
 *   VITE_OMDB_KEY         optional, critic scores
 *   VITE_TMDB_BASE        optional extra TMDB proxy, tried first
 *
 * NOTE: personal app, so the keys end up in the client bundle.
 */
const env = import.meta.env

export interface ApiConfig {
  tmdbKey: string
  omdbKey: string
}

export function getConfig(): ApiConfig {
  return {
    tmdbKey: (env.VITE_TMDB_API_KEY || env.VITE_TMDB_READ_TOKEN || env.VITE_TMDB_KEY || '').trim(),
    omdbKey: (env.VITE_OMDB_KEY || '').trim(),
  }
}

/**
 * TMDB hosts, in the order to try. If one fails (blocked DNS, offline proxy) the
 * next is used, and whichever works is remembered.
 *  - `/api/tmdb`: same-origin proxy (Vite dev server; Vercel rewrite in vercel.json)
 *  - api.themoviedb.org, then api.tmdb.org (the latter isn't blocked by Jio)
 */
export function tmdbBases(): string[] {
  const native = typeof window !== 'undefined' && 'Capacitor' in window && (window as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor?.isNativePlatform?.()
  const list = [
    env.VITE_TMDB_BASE || '',
    native && !env.DEV ? '' : '/api/tmdb', // no same-origin proxy inside the bundled iOS app
    'https://api.themoviedb.org/3',
    'https://api.tmdb.org/3',
  ].filter(Boolean)
  return [...new Set(list)]
}
