import type { Movie } from '../types'
import { db, getMeta } from './db'
import { posterSrc } from './tmdb'

/** The bundled catalog (src/data/seed.json, built by `npm run import:old`). */
async function loadSeed(): Promise<Movie[]> {
  const raw = (await import('../data/seed.json')).default as unknown as Partial<Movie>[]
  return raw.map((s) => ({
    ...(s as Movie),
    posterUrl: s.posterPath ? posterSrc(s.posterPath, 'w780') : '',
    updatedAt: s.addedAt ?? 0,
    scoresStatus: s.imdbId && s.imdbRating == null ? 'pending' : 'done',
  }))
}

/**
 * First launch: fill an empty shelf from the bundled catalog, so browsing works
 * immediately with no key and no network. Runs once; deleting movies later never
 * brings them back. An old demo/sample-only shelf counts as empty.
 */
export async function ensureSeeded(): Promise<void> {
  try {
    if (await getMeta<boolean>('seeded')) return
    const existing = await db.movies.toArray()
    const onlySamples = existing.length > 0 && existing.every((m) => m.id.startsWith('sample-'))
    if (existing.length && !onlySamples) return // has real data
    const seed = await loadSeed()
    if (!seed.length) return
    await db.transaction('rw', db.movies, db.meta, async () => {
      if (onlySamples) await db.movies.clear()
      await db.movies.bulkPut(seed)
      await db.meta.put({ key: 'seeded', value: true })
    })
  } catch (e) {
    console.error('seed failed', e)
  }
}
