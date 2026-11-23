/**
 * API configuration. Keys come from .env (VITE_TMDB_KEY / VITE_OMDB_KEY) and can be
 * overridden at runtime in Settings (stored in localStorage on this device), which
 * is handy for an installed IPA built without keys.
 *
 * NOTE: personal app, so the keys end up in the client bundle / on the device.
 */
const LS = 'shelf.config'

export interface ApiConfig {
  tmdbKey: string
  omdbKey: string
  /** optional proxy base for TMDB in production builds, e.g. a Cloudflare Worker */
  tmdbBase: string
}

function readOverrides(): Partial<ApiConfig> {
  try {
    return JSON.parse(localStorage.getItem(LS) || '{}')
  } catch {
    return {}
  }
}

export function getOverrides(): Partial<ApiConfig> {
  return readOverrides()
}

export function setOverrides(o: Partial<ApiConfig>) {
  const clean: Partial<ApiConfig> = {}
  for (const [k, v] of Object.entries(o)) if (typeof v === 'string' && v.trim()) clean[k as keyof ApiConfig] = v.trim()
  try {
    localStorage.setItem(LS, JSON.stringify(clean))
  } catch {
    /* ignore */
  }
}

export function getConfig(): ApiConfig {
  const o = readOverrides()
  const env = import.meta.env
  return {
    tmdbKey: o.tmdbKey || env.VITE_TMDB_KEY || '',
    omdbKey: o.omdbKey || env.VITE_OMDB_KEY || '',
    // In dev (incl. phone-over-Wi-Fi and the live-reload IPA) we go through the Vite proxy.
    tmdbBase: o.tmdbBase || (env.DEV ? '/tmdb' : env.VITE_TMDB_BASE || 'https://api.themoviedb.org/3'),
  }
}

export const envHas = {
  tmdb: Boolean(import.meta.env.VITE_TMDB_KEY),
  omdb: Boolean(import.meta.env.VITE_OMDB_KEY),
}
