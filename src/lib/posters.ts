import { useEffect, useState } from 'react'
import type { Movie } from '../types'
import { db } from './db'
import { corsUrl, posterSrc, type PosterSize } from './tmdb'

/**
 * Object URLs for cached poster blobs. Keyed by id + cache time so a re-read of the
 * same record (Dexie hands back a fresh Blob each query) reuses one URL.
 */
const urls = new Map<string, { key: string; url: string }>()

export function blobUrl(m: Movie): string | undefined {
  if (!m.posterBlob) return undefined
  const key = `${m.posterCachedAt ?? 0}:${m.posterBlob.size}`
  const hit = urls.get(m.id)
  if (hit && hit.key === key) return hit.url
  if (hit) URL.revokeObjectURL(hit.url)
  const url = URL.createObjectURL(m.posterBlob)
  urls.set(m.id, { key, url })
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
  if (!m.posterUrl) return false
  try {
    const res = await fetch(corsUrl(m.posterUrl), { mode: 'cors' })
    if (!res.ok) return false
    const blob = await res.blob()
    if (!blob.type.startsWith('image/')) return false
    await db.movies.update(m.id, { posterBlob: blob, posterCachedAt: Date.now() })
    return true
  } catch {
    return false
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
