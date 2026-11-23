import type { Movie } from '../types'
import { db, getMeta, setMeta } from './db'
import { posterSrc } from './tmdb'

/**
 * First launch: fill the shelf from the bundled catalog (src/data/seed.json), so
 * browsing works immediately with no key and no network. Runs once; deleting
 * movies later never brings them back. An old demo/sample-only shelf counts as empty.
 */
export async function ensureSeeded(): Promise<void> {
  try {
    if (await getMeta<boolean>('seeded')) return
    const existing = await db.movies.toArray()
    const onlySamples = existing.length > 0 && existing.every((m) => m.id.startsWith('sample-'))
    if (existing.length && !onlySamples) {
      await setMeta('seeded', true) // already has real data
      return
    }
    const seed = (await import('../data/seed.json')).default as Partial<Movie>[]
    if (!seed.length) return // not generated yet (npm run seed)
    const movies: Movie[] = seed.map((s) => ({
      ...(s as Movie),
      posterUrl: s.posterPath ? posterSrc(s.posterPath, 'w780') : '',
      updatedAt: s.addedAt ?? Date.now(),
      scoresStatus: s.imdbId ? 'pending' : 'done',
    }))
    await db.transaction('rw', db.movies, db.meta, async () => {
      if (onlySamples) await db.movies.clear()
      await db.movies.bulkPut(movies)
      await db.meta.put({ key: 'seeded', value: true })
    })
  } catch (e) {
    console.error('seed failed', e)
  }
}
