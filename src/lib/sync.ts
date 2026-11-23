import { tryScores } from './catalog'
import { db } from './db'
import { cachePoster } from './posters'

/**
 * Background housekeeping: retry critic scores that failed (offline / OMDb rate
 * limit) and cache any posters that aren't stored locally yet.
 * Safe to call often; only one run at a time.
 */
let running = false

export async function syncPending(): Promise<void> {
  if (running || !navigator.onLine) return
  running = true
  try {
    const pending = await db.movies.where('scoresStatus').equals('pending').toArray()
    for (const m of pending) {
      const r = await tryScores(m.imdbId)
      if (r.rateLimited) break
      if (r.ok) await db.movies.update(m.id, { ...r.scores, scoresStatus: 'done' })
      await sleep(250)
    }

    const all = await db.movies.toArray()
    const missing = all.filter((m) => !m.posterBlob && m.posterUrl)
    // two at a time is plenty
    for (let i = 0; i < missing.length; i += 2) {
      await Promise.all(missing.slice(i, i + 2).map(cachePoster))
    }
  } finally {
    running = false
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
