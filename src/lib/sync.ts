import { tryScores } from './catalog'
import { db } from './db'
import { downloadPoster } from './posters'

/**
 * Background housekeeping: retry critic scores that failed (offline / OMDb rate
 * limit) and cache any posters that aren't stored locally yet.
 * Safe to call often; only one run at a time.
 */
let running = false

/** Posters written per transaction. The live shelf query re-reads every record —
 *  blobs included — so one write per movie meant ~180 full re-reads during the
 *  first sync. Batching turns that into a handful. */
const WRITE_BATCH = 12

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
    let queue: { id: string; blob: Blob }[] = []

    const flush = async () => {
      if (!queue.length) return
      const batch = queue
      queue = []
      const at = Date.now()
      await db.transaction('rw', db.movies, async () => {
        for (const u of batch) await db.movies.update(u.id, { posterBlob: u.blob, posterCachedAt: at })
      })
    }

    // two downloads at a time is plenty
    for (let i = 0; i < missing.length; i += 2) {
      const got = await Promise.all(
        missing.slice(i, i + 2).map(async (m) => {
          const blob = await downloadPoster(m)
          return blob ? { id: m.id, blob } : null
        }),
      )
      for (const g of got) if (g) queue.push(g)
      if (queue.length >= WRITE_BATCH) await flush()
    }
    await flush()
  } finally {
    running = false
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
