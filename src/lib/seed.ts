import type { Movie } from '../types'
import { db, getMeta, setMeta } from './db'
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
    if (existing.length && !onlySamples) return // has real data: use Settings → Re-import seed
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

/** Same title on the shelf = same kind + TMDB id; collections match by their id string. */
export function entryKey(m: Pick<Movie, 'kind' | 'tmdbId' | 'id'>): string {
  return m.kind === 'collection' ? `collection:${m.id}` : `${m.kind ?? 'movie'}:${m.tmdbId}`
}

/** Fields that belong to me rather than to TMDB / the old catalog. */
const MINE = ['id', 'myRating', 'myReview', 'addedAt', 'updatedAt', 'posterBlob', 'posterCachedAt', 'palette'] as const

/**
 * Settings → "Re-import seed". Merges the bundled catalog into the shelf without
 * wiping anything newer:
 *  - entries not on the shelf are added
 *  - entries on the shelf get fresh metadata (poster, backdrop, tag, order, films…);
 *    my rating/review are kept if I edited them in this app, otherwise taken from the seed
 *  - movies I added myself are never touched
 */
export async function mergeSeed(): Promise<{ added: number; refreshed: number; keptEdits: number }> {
  const seed = await loadSeed()
  const existing = await db.movies.toArray()
  const byKey = new Map(existing.map((m) => [entryKey(m), m]))
  let added = 0
  let refreshed = 0
  let keptEdits = 0
  const writes: Movie[] = []
  for (const s of seed) {
    const ex = byKey.get(entryKey(s))
    if (!ex) {
      writes.push(s)
      added++
      continue
    }
    const editedHere = ex.updatedAt > ex.addedAt + 1000
    if (editedHere) keptEdits++
    const meta: Partial<Movie> = { ...s }
    for (const k of MINE) delete meta[k]
    const posterChanged = ex.posterPath !== s.posterPath
    // keep per-film reviews/ratings I added inside collections
    const children = s.children?.map((c) => {
      const old = ex.children?.find((o) => o.tmdbId === c.tmdbId)
      return old ? { ...c, myRating: old.myRating ?? c.myRating, myReview: old.myReview ?? c.myReview } : c
    })
    writes.push({
      ...ex,
      ...meta,
      children,
      myRating: editedHere ? ex.myRating : s.myRating,
      myReview: ex.myReview || s.myReview,
      palette: posterChanged ? s.palette : (ex.palette ?? s.palette),
      ...(posterChanged ? { posterBlob: undefined, posterCachedAt: undefined } : {}),
    })
    refreshed++
  }
  await db.transaction('rw', db.movies, db.meta, async () => {
    await db.movies.bulkPut(writes)
    await setMeta('seeded', true)
  })
  return { added, refreshed, keptEdits }
}
