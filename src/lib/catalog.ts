import type { Candidate, MovieInfo, Scores } from '../types'
import { getConfig } from './config'
import { omdbDetails, omdbScores, omdbSearch, RateLimitError } from './omdb'
import { AuthError, NetworkError, tmdbDetails, tmdbSearch } from './tmdb'

/**
 * TMDB first; if TMDB can't be reached (offline proxy, ISP DNS block) fall back to
 * OMDb for search/details so adding a movie still works.
 */
export type Provider = 'tmdb' | 'omdb'

export async function searchMovies(q: string, signal?: AbortSignal, year?: number): Promise<{ provider: Provider; results: Candidate[] }> {
  const { tmdbKey, omdbKey } = getConfig()
  if (tmdbKey) {
    try {
      return { provider: 'tmdb', results: await tmdbSearch(q, signal, year) }
    } catch (e) {
      if (!(e instanceof NetworkError) || !omdbKey) throw e
    }
  } else if (!omdbKey) {
    throw new AuthError('key missing')
  }
  if (signal?.aborted) throw new DOMException('aborted', 'AbortError')
  return { provider: 'omdb', results: await omdbSearch(q) }
}

export interface FullInfo {
  info: MovieInfo
  scores: Scores
  scoresOk: boolean
}

export async function fetchFull(c: Candidate): Promise<FullInfo> {
  if (c.source === 'omdb' && c.imdbId) {
    const d = await omdbDetails(c.imdbId)
    const { imdbRating, rtScore, metacritic, ...info } = d
    return { info, scores: { imdbRating, rtScore, metacritic }, scoresOk: true }
  }
  const info = await tmdbDetails(c.tmdbId!)
  const { scores, ok } = await tryScores(info.imdbId)
  return { info, scores, scoresOk: ok }
}

/** Never throws: a failed/rate-limited OMDb call just means "retry later". */
export async function tryScores(imdbId: string): Promise<{ scores: Scores; ok: boolean; rateLimited?: boolean }> {
  if (!imdbId || !getConfig().omdbKey) return { scores: {}, ok: !imdbId }
  try {
    return { scores: await omdbScores(imdbId), ok: true }
  } catch (e) {
    return { scores: {}, ok: false, rateLimited: e instanceof RateLimitError }
  }
}

export function describeError(e: unknown): string {
  if (e instanceof AuthError) return 'Search is offline — key missing'
  if (e instanceof NetworkError) return "Can't reach the movie database. Check your connection."
  if (e instanceof RateLimitError) return 'OMDb daily limit reached. Try again tomorrow.'
  return (e as Error)?.message || 'Something went wrong.'
}
