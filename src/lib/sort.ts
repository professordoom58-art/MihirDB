import type { Movie } from '../types'

/**
 * My rating, highest first. Ties: the old catalog's order (originalOrder, lowest first);
 * movies added in this app (no originalOrder) come before those, most recent first.
 */
export function sortShelf(movies: Movie[]): Movie[] {
  const order = (m: Movie) => m.originalOrder ?? -1
  return [...movies].sort(
    (a, b) => b.myRating - a.myRating || order(a) - order(b) || b.addedAt - a.addedAt,
  )
}

/** "9.5", "8.0"; whole numbers from 10 up stay whole ("10", and my "11"s) */
export function formatRating(r: number): string {
  return r >= 10 && Number.isInteger(r) ? String(r) : r.toFixed(1)
}

/** The filter's top end (10) means "10 and up", so ratings above 10 (my 11s) are never filtered out. */
export function inRange(r: number, min: number, max: number): boolean {
  return r >= min && (max >= 10 || r <= max)
}

/** "8.5" / "10" / "3" — compact, for ranges */
export const shortRating = (r: number) => (Number.isInteger(r) ? String(r) : r.toFixed(1))

/** "3–4.5", or a single value when both ends match */
export function formatRange(min: number, max: number, sep = '–'): string {
  return min === max ? shortRating(min) : `${shortRating(min)}${sep}${shortRating(max)}`
}
