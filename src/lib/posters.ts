import { useEffect, useState } from 'react'
import type { Movie } from '../types'
import { db } from './db'
import { corsUrl, posterSrc, type PosterSize } from './tmdb'

/**
 * Object URLs for cached poster blobs. Keyed by id + cache time so a re-read of the
 * same record (Dexie hands back a fresh Blob each query) reuses one URL.
 */
const urls = new Map<string, { key: string; url: string }>()
/** Keep only a window of object URLs alive: a full shelf would otherwise pin every
 *  cached poster in the WebView's memory for the whole session. Revoking a URL an
 *  <img> already painted is harmless; the blob itself lives on in IndexedDB. */
const MAX_URLS = 32

export function blobUrl(m: Movie): string | undefined {
  if (!m.posterBlob) return undefined
  const key = `${m.posterCachedAt ?? 0}:${m.posterBlob.size}`
  const hit = urls.get(m.id)
  if (hit && hit.key === key) {
    urls.delete(m.id) // refresh LRU position
    urls.set(m.id, hit)
    return hit.url
  }
  if (hit) URL.revokeObjectURL(hit.url)
  urls.delete(m.id)
  const url = URL.createObjectURL(m.posterBlob)
  urls.set(m.id, { key, url })
  while (urls.size > MAX_URLS) {
    const oldest = urls.keys().next()
    if (oldest.done) break
    const stale = urls.get(oldest.value)
    if (stale) URL.revokeObjectURL(stale.url)
    urls.delete(oldest.value)
  }
  return url
}

export function forgetPoster(id: string) {
  const hit = urls.get(id)
  if (hit) URL.revokeObjectURL(hit.url)
  urls.delete(id)
}

/** Best available hi-res poster: local blob first, then the network. */
export function posterFor(m: Movie): string {
  return blobUrl(m) ?? m.posterUrl
}

/** Small network image for blur-up / background, when we have a TMDB path. */
export function thumbFor(m: Movie, size: PosterSize = 'w92'): string | undefined {
  if (m.posterBlob) return undefined
  return m.posterPath ? posterSrc(m.posterPath, size) : undefined
}

/** Source for the blurred backdrop: the cached poster if we have it, else a tiny TMDB image. */
export function backdropFor(m: Movie): string | undefined {
  return blobUrl(m) ?? (m.posterPath ? posterSrc(m.posterPath, 'w92') : m.posterUrl || undefined)
}

/** Download the hi-res poster into IndexedDB so the shelf works offline. */
export async function cachePoster(m: Movie): Promise<boolean> {
  const blob = await downloadPoster(m)
  if (!blob) return false
  await db.movies.update(m.id, { posterBlob: blob, posterCachedAt: Date.now() })
  return true
}

/**
 * Fetch the poster bytes without touching the database. Bulk callers (the
 * background sync) batch the writes, so the live shelf query isn't re-read —
 * with every blob — once per movie.
 */
export async function downloadPoster(m: Movie): Promise<Blob | null> {
  if (!m.posterUrl) return null
  try {
    const res = await fetch(corsUrl(m.posterUrl), { mode: 'cors' })
    if (!res.ok) return null
    const blob = await res.blob()
    if (!blob.type.startsWith('image/')) return null
    return blob
  } catch {
    return null
  }
}

export function useOnline() {
  const [on, setOn] = useState(navigator.onLine)
  useEffect(() => {
    const a = () => setOn(true)
    const b = () => setOn(false)
    window.addEventListener('online', a)
    window.addEventListener('offline', b)
    return () => {
      window.removeEventListener('online', a)
      window.removeEventListener('offline', b)
    }
  }, [])
  return on
}
