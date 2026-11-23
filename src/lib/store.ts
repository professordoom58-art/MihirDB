import type { Movie, MovieInfo, Scores } from '../types'
import { db, newId, requestPersistence } from './db'
import { cachePoster, forgetPoster } from './posters'
import { syncPending } from './sync'

export interface SaveInput {
  info: MovieInfo
  scores: Scores
  scoresOk: boolean
  myRating: number
  myReview: string
}

export async function addMovie(x: SaveInput): Promise<Movie> {
  const now = Date.now()
  const m: Movie = {
    ...x.info,
    ...x.scores,
    id: newId(),
    myRating: x.myRating,
    myReview: x.myReview.trim(),
    scoresStatus: x.scoresOk ? 'done' : 'pending',
    addedAt: now,
    updatedAt: now,
  }
  await db.movies.put(m)
  requestPersistence()
  void cachePoster(m)
  if (!x.scoresOk) void syncPending()
  return m
}

export async function updateMine(id: string, myRating: number, myReview: string) {
  await db.movies.update(id, { myRating, myReview: myReview.trim(), updatedAt: Date.now() })
}

export async function deleteMovie(id: string) {
  await db.movies.delete(id)
  forgetPoster(id)
}
