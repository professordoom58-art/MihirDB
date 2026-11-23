/**
 * API keys, compiled into the app.
 *
 * The TMDB key below is deliberately hard-coded: this is a personal, private build,
 * so there is no .env file, GitHub secret or in-app setup to do. A `.env` value
 * (`VITE_TMDB_API_KEY` / `VITE_TMDB_READ_TOKEN`) or a repo secret still wins, which
 * makes rotating the key possible without editing this file.
 *
 * If this repository ever becomes public, rotate the key at
 * https://www.themoviedb.org/settings/api — it is in the git history.
 */
const BUILT_IN_TMDB_KEY = '4e44d9029b1270a757cddc766a1bcb63'
/** Optional; empty until an OMDb key is added (critic scores stay hidden without it). */
const BUILT_IN_OMDB_KEY = ''

const env = import.meta.env

export interface ApiConfig {
  tmdbKey: string
  omdbKey: string
}

export function getConfig(): ApiConfig {
  return {
    tmdbKey: (env.VITE_TMDB_API_KEY || env.VITE_TMDB_READ_TOKEN || env.VITE_TMDB_KEY || BUILT_IN_TMDB_KEY).trim(),
    omdbKey: (env.VITE_OMDB_API_KEY || env.VITE_OMDB_KEY || BUILT_IN_OMDB_KEY).trim(),
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
