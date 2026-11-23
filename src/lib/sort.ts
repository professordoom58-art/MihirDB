import type { Movie } from '../types'

/** My rating, highest first. Ties: most recently added first. */
export function sortShelf(movies: Movie[]): Movie[] {
  return [...movies].sort((a, b) => b.myRating - a.myRating || b.addedAt - a.addedAt)
}

export function formatRating(r: number): string {
  return r >= 10 ? '10' : r.toFixed(1)
}
