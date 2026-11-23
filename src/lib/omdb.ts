import type { Candidate, MovieInfo, Scores } from '../types'
import { getConfig } from './config'
import { AuthError, NetworkError } from './tmdb'

export class RateLimitError extends Error {}

interface OmdbMovie {
  Response: 'True' | 'False'
  Error?: string
  Title: string
  Year: string
  Runtime: string
  Genre: string
  Director: string
  Poster: string
  imdbID: string
  imdbRating: string
  Metascore: string
  Ratings?: { Source: string; Value: string }[]
}

async function omdb<T extends { Response: string; Error?: string }>(params: Record<string, string>): Promise<T> {
  const { omdbKey } = getConfig()
  if (!omdbKey) throw new AuthError('No OMDb key')
  const url = new URL('https://www.omdbapi.com/')
  url.searchParams.set('apikey', omdbKey)
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  let res: Response
  try {
    res = await fetch(url)
  } catch {
    throw new NetworkError('OMDb unreachable')
  }
  if (res.status === 401) {
    const body = (await res.json().catch(() => ({}))) as { Error?: string }
    if (/limit/i.test(body.Error ?? '')) throw new RateLimitError(body.Error)
    throw new AuthError(body.Error || 'OMDb key rejected')
  }
  if (!res.ok) throw new NetworkError(`OMDb ${res.status}`)
  const j = (await res.json()) as T
  if (j.Response === 'False' && /limit/i.test(j.Error ?? '')) throw new RateLimitError(j.Error)
  return j
}

const num = (s?: string) => {
  if (!s || s === 'N/A') return undefined
  const n = parseFloat(s.replace(/[^0-9.]/g, ''))
  return Number.isFinite(n) ? n : undefined
}

/** IMDb ★, Rotten Tomatoes %, Metacritic. Missing values stay undefined. */
export async function omdbScores(imdbId: string): Promise<Scores> {
  const m = await omdb<OmdbMovie>({ i: imdbId })
  if (m.Response === 'False') return {}
  const rt = m.Ratings?.find((r) => r.Source === 'Rotten Tomatoes')?.Value
  return { imdbRating: num(m.imdbRating), rtScore: num(rt), metacritic: num(m.Metascore) }
}

/** Amazon poster URLs carry a size suffix; ask for a bigger one. */
function upscale(poster: string, px: number) {
  if (!poster || poster === 'N/A') return ''
  return poster.replace(/\._V1_.*?\.jpg$/i, `._V1_SX${px}.jpg`)
}

/** Fallback search when TMDB is unreachable (e.g. ISP DNS block). */
export async function omdbSearch(query: string): Promise<Candidate[]> {
  const r = await omdb<{ Response: string; Error?: string; Search?: { Title: string; Year: string; imdbID: string; Poster: string }[] }>({
    s: query,
    type: 'movie',
  })
  return (r.Search ?? []).map((h) => ({
    source: 'omdb' as const,
    imdbId: h.imdbID,
    title: h.Title,
    year: parseInt(h.Year) || undefined,
    thumb: upscale(h.Poster, 154) || undefined,
  }))
}

export async function omdbDetails(imdbId: string): Promise<MovieInfo & Scores> {
  const m = await omdb<OmdbMovie>({ i: imdbId })
  if (m.Response === 'False') throw new Error(m.Error || 'Not found')
  const rt = m.Ratings?.find((r) => r.Source === 'Rotten Tomatoes')?.Value
  return {
    tmdbId: 0,
    imdbId: m.imdbID,
    title: m.Title,
    year: parseInt(m.Year) || 0,
    director: m.Director === 'N/A' ? '' : m.Director.replace(/, /g, ' & '),
    runtime: num(m.Runtime) ?? 0,
    genres: m.Genre === 'N/A' ? [] : m.Genre.split(', '),
    posterUrl: upscale(m.Poster, 780),
    imdbRating: num(m.imdbRating),
    rtScore: num(rt),
    metacritic: num(m.Metascore),
  }
}
