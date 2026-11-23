import type { Movie } from '../types'
import { db } from './db'

/**
 * Reviews from the old site lived only in its browser localStorage:
 *   "mfm_review_<tmdbId>" → { tmdbId, reviewText, mihirScore, updatedAt }
 * Run this in that site's DevTools console to copy them all as JSON:
 */
export const OLD_REVIEWS_SNIPPET =
  "copy(JSON.stringify(Object.fromEntries(Object.keys(localStorage).filter(k=>k.startsWith('mfm_review_')).map(k=>[k,JSON.parse(localStorage.getItem(k))]))))"

interface OldReview {
  tmdbId: number
  reviewText?: string
  mihirScore?: number | string | null
  updatedAt?: string
}

/** Accepts the snippet's output ({ key: review }), an array of reviews, or values stored as JSON strings. */
export function parseOldReviews(text: string): OldReview[] {
  const data = JSON.parse(text)
  const values: unknown[] = Array.isArray(data) ? data : Object.entries(data ?? {}).map(([k, v]) => {
    const obj = typeof v === 'string' ? JSON.parse(v) : v
    // fall back to the id in the key if the object lacks one
    const fromKey = Number(k.replace(/^mfm_review_/, ''))
    return obj && typeof obj === 'object' && !('tmdbId' in obj) && fromKey ? { ...obj, tmdbId: fromKey } : obj
  })
  return values
    .map((v) => (typeof v === 'string' ? JSON.parse(v) : v) as OldReview)
    .filter((r) => r && Number.isFinite(Number(r.tmdbId)))
    .map((r) => ({ ...r, tmdbId: Number(r.tmdbId) }))
}

const score = (s: unknown): number | undefined => {
  if (s === null || s === undefined || s === '') return undefined
  const n = typeof s === 'number' ? s : parseFloat(String(s))
  return Number.isFinite(n) && n > 0 ? Math.min(11, Math.max(1, Math.round(n * 2) / 2)) : undefined
}

/**
 * Merge by tmdbId. A review's own mihirScore wins over the ratings file.
 * Matches top-level movies/TV first; otherwise a film inside a collection.
 */
export async function importOldReviews(text: string): Promise<{ matched: number; inCollections: number; unmatched: number[] }> {
  const reviews = parseOldReviews(text)
  const all = await db.movies.toArray()
  const now = Date.now()
  const updates = new Map<string, Movie>()
  let matched = 0
  let inCollections = 0
  const unmatched: number[] = []

  for (const r of reviews) {
    const text = (r.reviewText ?? '').trim()
    const rating = score(r.mihirScore)
    // prefer a movie over a TV series if both share the number
    const top =
      all.find((m) => m.tmdbId === r.tmdbId && (m.kind ?? 'movie') === 'movie') ??
      all.find((m) => m.tmdbId === r.tmdbId && m.kind === 'tv')
    if (top) {
      const m = updates.get(top.id) ?? { ...top }
      if (text) m.myReview = text
      if (rating !== undefined) m.myRating = rating
      m.updatedAt = now
      updates.set(m.id, m)
      matched++
      continue
    }
    const col = all.find((m) => m.children?.some((c) => c.tmdbId === r.tmdbId))
    if (col) {
      const m = updates.get(col.id) ?? { ...col, children: col.children?.map((c) => ({ ...c })) }
      const child = m.children!.find((c) => c.tmdbId === r.tmdbId)!
      if (text) child.myReview = text
      if (rating !== undefined) child.myRating = rating
      m.updatedAt = now
      updates.set(m.id, m)
      inCollections++
      continue
    }
    unmatched.push(r.tmdbId)
  }
  await db.movies.bulkPut([...updates.values()])
  return { matched, inCollections, unmatched }
}
