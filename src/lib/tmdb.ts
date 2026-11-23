import type { Candidate, MovieInfo } from '../types'
import { getConfig } from './config'

export type PosterSize = 'w92' | 'w154' | 'w185' | 'w342' | 'w500' | 'w780' | 'original'

export function posterSrc(path: string, size: PosterSize): string {
  return `https://image.tmdb.org/t/p/${size}${path}`
}

/**
 * CORS-enabled variant of a poster URL. The query string gives it a separate
 * browser-cache entry: the CDN only sends CORS headers when asked, so a copy
 * cached by a plain <img> can't be reused for canvas/blob reads.
 */
export function corsUrl(url: string): string {
  return url + (url.includes('?') ? '&' : '?') + 'cors=1'
}

export class NetworkError extends Error {}
export class AuthError extends Error {}

async function tmdb<T>(path: string, params: Record<string, string> = {}, signal?: AbortSignal): Promise<T> {
  const { tmdbKey, tmdbBase } = getConfig()
  if (!tmdbKey) throw new AuthError('No TMDB key')
  const base = tmdbBase.replace(/\/$/, '')
  const url = new URL(base + path, location.href)
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  const headers: Record<string, string> = { accept: 'application/json' }
  // v4 "API Read Access Token" (a JWT) goes in a header; a v3 key goes in the query.
  if (tmdbKey.startsWith('eyJ')) headers.authorization = `Bearer ${tmdbKey}`
  else url.searchParams.set('api_key', tmdbKey)

  let res: Response
  try {
    res = await fetch(url, { headers, signal })
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e
    throw new NetworkError('TMDB unreachable')
  }
  if (res.status === 401) throw new AuthError('TMDB key rejected')
  // proxy errors (blocked DNS, offline laptop) look like 5xx
  if (res.status >= 500) throw new NetworkError(`TMDB ${res.status}`)
  if (!res.ok) throw new Error(`TMDB ${res.status}`)
  return res.json() as Promise<T>
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
  }
}
