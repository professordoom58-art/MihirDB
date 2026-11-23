import { Capacitor } from '@capacitor/core'
import type { Movie } from '../types'
import { db, getMeta, newId, setMeta } from './db'
import { syncPending } from './sync'

const FORMAT = 'shelf-backup'

type Portable = Omit<Movie, 'posterBlob' | 'posterCachedAt'>

export async function exportJson(): Promise<'shared' | 'downloaded' | 'cancelled'> {
  const movies = await db.movies.toArray()
  const portable: Portable[] = movies.map(({ posterBlob: _b, posterCachedAt: _c, ...rest }) => rest)
  const json = JSON.stringify({ format: FORMAT, version: 1, exportedAt: new Date().toISOString(), movies: portable }, null, 2)
  const name = `shelf-backup-${new Date().toISOString().slice(0, 10)}.json`

  let result: 'shared' | 'downloaded' | 'cancelled'
  if (Capacitor.isNativePlatform()) {
    // <a download> does nothing inside the iOS app: write a file and open the share sheet.
    const { Filesystem, Directory, Encoding } = await import('@capacitor/filesystem')
    const { Share } = await import('@capacitor/share')
    const f = await Filesystem.writeFile({ path: name, data: json, directory: Directory.Cache, encoding: Encoding.UTF8 })
    try {
      await Share.share({ title: 'Shelf backup', url: f.uri })
      result = 'shared'
    } catch {
      return 'cancelled'
    }
  } else {
    const file = new File([json], name, { type: 'application/json' })
    const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean }
    if (nav.canShare?.({ files: [file] }) && matchMedia('(pointer: coarse)').matches) {
      try {
        await navigator.share({ files: [file], title: 'Shelf backup' })
        result = 'shared'
      } catch (e) {
        if ((e as Error).name === 'AbortError') return 'cancelled'
        download(file)
        result = 'downloaded'
      }
    } else {
      download(file)
      result = 'downloaded'
    }
  }
  await setMeta('lastBackup', Date.now())
  return result
}

function download(file: File) {
  const url = URL.createObjectURL(file)
  const a = document.createElement('a')
  a.href = url
  a.download = file.name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 5000)
}

/** Merge a backup in. Same movie (id, TMDB id or IMDb id) → the newer edit wins. */
export async function importJson(text: string): Promise<{ added: number; updated: number; skipped: number }> {
  const data = JSON.parse(text)
  const list: Partial<Movie>[] = Array.isArray(data) ? data : data?.movies
  if (!Array.isArray(list)) throw new Error('Not a Shelf backup file')
  let added = 0
  let updated = 0
  let skipped = 0
  const existing = await db.movies.toArray()
  await db.transaction('rw', db.movies, async () => {
    for (const raw of list) {
      if (!raw || typeof raw.title !== 'string' || typeof raw.myRating !== 'number') {
        skipped++
        continue
      }
      const match = existing.find(
        (e) => e.id === raw.id || (raw.tmdbId && e.tmdbId === raw.tmdbId) || (raw.imdbId && e.imdbId === raw.imdbId),
      )
      const now = Date.now()
      const m: Movie = {
        tmdbId: 0,
        imdbId: '',
        year: 0,
        director: '',
        runtime: 0,
        genres: [],
        posterUrl: '',
        myReview: '',
        addedAt: now,
        updatedAt: now,
        ...raw,
        id: match?.id ?? raw.id ?? newId(),
      } as Movie
      delete m.posterBlob
      if (match) {
        if ((raw.updatedAt ?? 0) > match.updatedAt) {
          await db.movies.put({ ...m, posterBlob: match.posterBlob, posterCachedAt: match.posterCachedAt })
          updated++
        } else skipped++
      } else {
        await db.movies.put(m)
        added++
      }
    }
  })
  void syncPending()
  return { added, updated, skipped }
}

export const getLastBackup = () => getMeta<number>('lastBackup')
