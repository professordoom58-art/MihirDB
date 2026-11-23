import Dexie, { liveQuery, type Table } from 'dexie'
import { useEffect, useState } from 'react'
import type { Movie } from '../types'

interface Meta {
  key: string
  value: unknown
}

class ShelfDB extends Dexie {
  movies!: Table<Movie, string>
  meta!: Table<Meta, string>
  constructor() {
    super('shelf')
    this.version(1).stores({
      movies: 'id, tmdbId, imdbId, myRating, addedAt, scoresStatus',
      meta: 'key',
    })
  }
}

export const db = new ShelfDB()

export async function getMeta<T>(key: string): Promise<T | undefined> {
  return (await db.meta.get(key))?.value as T | undefined
}

export function setMeta(key: string, value: unknown) {
  return db.meta.put({ key, value })
}

/** Subscribe a component to a Dexie query; re-renders when the data changes. */
export function useLive<T>(query: () => Promise<T>, deps: unknown[], initial: T): T {
  const [v, setV] = useState<T>(initial)
  useEffect(() => {
    const sub = liveQuery(query).subscribe({ next: setV, error: (e) => console.error(e) })
    return () => sub.unsubscribe()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
  return v
}

/** crypto.randomUUID isn't available over plain http on the phone (insecure context). */
export function newId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto && isSecureContext) return crypto.randomUUID()
  const b = new Uint8Array(16)
  crypto.getRandomValues(b)
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')
}

export async function findExisting(tmdbId?: number, imdbId?: string): Promise<Movie | undefined> {
  if (tmdbId) {
    const m = await db.movies
      .where('tmdbId')
      .equals(tmdbId)
      .filter((x) => !x.kind || x.kind === 'movie')
      .first()
    if (m) return m
  }
  if (imdbId) return db.movies.where('imdbId').equals(imdbId).first()
  return undefined
}

/** Ask the browser not to evict our data (matters most for the home-screen PWA). */
export function requestPersistence() {
  navigator.storage?.persist?.().catch(() => {})
}
