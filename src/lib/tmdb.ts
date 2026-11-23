import type { Candidate, MovieInfo } from '../types'
import { getConfig, tmdbBases } from './config'

export type PosterSize = 'w92' | 'w154' | 'w185' | 'w342' | 'w500' | 'w780' | 'original'
export type BackdropSize = 'w300' | 'w780' | 'w1280' | 'original'

/** Images come straight from the TMDB CDN: no key needed. */
export function posterSrc(path: string, size: PosterSize): string {
  return `https://image.tmdb.org/t/p/${size}${path}`
}

export function backdropSrc(path: string, size: BackdropSize = 'w1280'): string {
  return `https://image.tmdb.org/t/p/${size}${path}`
}

/**
 * CORS-enabled variant of an image URL. The query string gives it a separate
 * browser-cache entry: the CDN only sends CORS headers when asked, so a copy
 * cached by a plain <img> can't be reused for canvas/blob reads.
 */
export function corsUrl(url: string): string {
  return url + (url.includes('?') ? '&' : '?') + 'cors=1'
}

export class NetworkError extends Error {}
export class AuthError extends Error {}

const LS_BASE = 'shelf.tmdbBase'

/** Caller's signal + a timeout (AbortSignal.any only exists on iOS 17.4+). */
function withTimeout(signal: AbortSignal | undefined, ms: number): AbortSignal {
  const ac = new AbortController()
  const t = setTimeout(() => ac.abort(), ms)
  signal?.addEventListener('abort', () => ac.abort(), { once: true })
  ac.signal.addEventListener('abort', () => clearTimeout(t), { once: true })
  return ac.signal
}

/** Try each TMDB host in turn (6s each), remembering the one that works. */
async function tmdb<T>(path: string, params: Record<string, string> = {}, signal?: AbortSignal): Promise<T> {
  const { tmdbKey } = getConfig()
  if (!tmdbKey) throw new AuthError('key missing')
  const headers: Record<string, string> = { accept: 'application/json' }
  // v4 "Read Access Token" (a JWT) goes in a header; a v3 key goes in the query.
  const bearer = tmdbKey.startsWith('eyJ')
  if (bearer) headers.authorization = `Bearer ${tmdbKey}`

  let bases = tmdbBases()
  let remembered: string | null = null
  try {
    remembered = localStorage.getItem(LS_BASE)
  } catch {
    /* ignore */
  }
  if (remembered && bases.includes(remembered)) bases = [remembered, ...bases.filter((b) => b !== remembered)]

  let lastErr: Error = new NetworkError('TMDB unreachable')
  for (const base of bases) {
    const url = new URL(base.replace(/\/$/, '') + path, location.href)
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
    if (!bearer) url.searchParams.set('api_key', tmdbKey)

    const combined = withTimeout(signal, 6000)
    let res: Response
    try {
      res = await fetch(url, { headers, signal: combined })
    } catch (e) {
      if (signal?.aborted) throw e
      lastErr = new NetworkError('TMDB unreachable')
      continue
    }
    if (res.status === 401) throw new AuthError('key invalid')
    // proxy errors (blocked DNS, dev server gone) look like 5xx / HTML
    const json = res.ok && (res.headers.get('content-type') ?? '').includes('json')
    if (!json) {
      lastErr = res.ok || res.status >= 500 || res.status === 404 ? new NetworkError(`TMDB ${res.status}`) : new Error(`TMDB ${res.status}`)
      if (res.ok || res.status >= 500 || res.status === 404) continue
      throw lastErr
    }
    try {
      localStorage.setItem(LS_BASE, base)
    } catch {
      /* ignore */
    }
    return res.json() as Promise<T>
  }
  throw lastErr
}

interface SearchHit {
  id: number
  title: string
  original_title: string
  release_date?: string
  poster_path: string | null
  overview?: string
}

export async function tmdbSearch(query: string, signal?: AbortSignal, year?: number): Promise<Candidate[]> {
  const params: Record<string, string> = { query, include_adult: 'false' }
  if (year) params.year = String(year)
  const r = await tmdb<{ results: SearchHit[] }>('/search/movie', params, signal)
  return r.results.slice(0, 20).map((h) => ({
    source: 'tmdb' as const,
    tmdbId: h.id,
    title: h.title,
    originalTitle: h.original_title,
    year: h.release_date ? Number(h.release_date.slice(0, 4)) || undefined : undefined,
    thumb: h.poster_path ? posterSrc(h.poster_path, 'w154') : undefined,
    overview: h.overview,
  }))
}

interface Details {
  id: number
  imdb_id: string | null
  title: string
  release_date?: string
  runtime: number | null
  genres: { name: string }[]
  poster_path: string | null
  backdrop_path: string | null
  credits?: { crew: { job: string; name: string }[] }
}

export async function tmdbDetails(id: number): Promise<MovieInfo> {
  const d = await tmdb<Details>(`/movie/${id}`, { append_to_response: 'credits' })
  const directors = (d.credits?.crew ?? []).filter((c) => c.job === 'Director').map((c) => c.name)
  return {
    tmdbId: d.id,
    imdbId: d.imdb_id ?? '',
    title: d.title,
    year: d.release_date ? Number(d.release_date.slice(0, 4)) || 0 : 0,
    director: [...new Set(directors)].join(' & '),
    runtime: d.runtime ?? 0,
    genres: d.genres.map((g) => g.name),
    posterPath: d.poster_path ?? undefined,
    posterUrl: d.poster_path ? posterSrc(d.poster_path, 'w780') : '',
    backdropPath: d.backdrop_path ?? undefined,
  }
}
