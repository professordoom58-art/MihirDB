import type { Palette } from './lib/palette'

/** Persisted shelf entry (IndexedDB via Dexie). Holds everything the shelf needs, so browsing never touches the API. */
export interface Movie {
  id: string
  /** default 'movie'; the seeded catalog also has TV series and collections */
  kind?: 'movie' | 'tv' | 'collection'
  tmdbId: number // 0 when the movie came from the OMDb fallback
  imdbId: string
  title: string
  year: number
  director: string
  runtime: number // minutes
  genres: string[]
  /** TMDB poster path, e.g. "/q6y0Go1tsGEsmtFryDOJo3dEmqu.jpg" (absent for OMDb-only posters) */
  posterPath?: string
  posterUrl: string
  /** TMDB backdrop path (wide still) for the background */
  backdropPath?: string
  /** colours extracted from the poster, used to grade the background */
  palette?: Palette
  /** my custom label, e.g. "CRIME THRILLER" */
  tag?: string
  /** number of films (collections) */
  parts?: number
  /** films inside a collection, in the old catalog's order */
  children?: CollectionFilm[]
  /** TMDB synopsis */
  overview?: string
  /** TV: creator(s), seasons, episodes */
  creator?: string
  seasons?: number
  episodes?: number
  /** collections: the label exactly as written in the old repo (e.g. "OCEAN'S COLLECTION") */
  sourceTitle?: string
  /** position in the old ILOVEMOVIES list ("// 24. Inception"); rating ties sort by it */
  originalOrder?: number
  /** locally cached high-res poster for offline use */
  posterBlob?: Blob
  posterCachedAt?: number
  myRating: number // 1–10, 0.5 steps
  myReview: string
  imdbRating?: number
  rtScore?: number
  metacritic?: number
  /** 'pending' = OMDb failed / rate-limited, retried in the background */
  scoresStatus?: 'pending' | 'done'
  addedAt: number
  updatedAt: number
}

/** Everything needed to create a Movie except my own fields and bookkeeping. */
export type MovieInfo = Pick<
  Movie,
  'tmdbId' | 'imdbId' | 'title' | 'year' | 'director' | 'runtime' | 'genres' | 'posterPath' | 'posterUrl' | 'backdropPath'
>

export interface CollectionFilm {
  tmdbId: number
  title: string
  year: number
  posterPath?: string
  imdbId?: string
  /** only if I rated this film on its own */
  myRating?: number
  myReview?: string
  /** marked in favoriteMovieIds (e.g. Fast Five in Fast & Furious) */
  favorite?: boolean
}

export interface Scores {
  imdbRating?: number
  rtScore?: number
  metacritic?: number
}

/** A search hit, before details are fetched. */
export interface Candidate {
  source: 'tmdb' | 'omdb'
  tmdbId?: number
  imdbId?: string
  title: string
  originalTitle?: string
  year?: number
  thumb?: string
  overview?: string
}

