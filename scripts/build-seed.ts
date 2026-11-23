/**
 * Builds src/data/seed.json — my existing catalog, bundled into the app so the shelf
 * works on first launch with no key and no network (only adding new movies uses the API).
 *
 *   npm run seed                      # clones the old repo from GitHub
 *   npm run seed -- C:\path\to\ILOVEMOVIES   # or use a local checkout
 *
 * Reads src/data/{favoriteMovies,mihirRatings,customGenres}.ts from the old repo,
 * calls TMDB once per entry (key from .env), extracts a palette from each poster,
 * and writes everything the shelf needs into each entry.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import sharp from 'sharp'
import { paletteFromPixels, type Palette } from '../src/lib/palette.ts'

const OLD_REPO = 'https://github.com/professordoom58-art/ILOVEMOVIES'
const ROOT = resolve(import.meta.dirname, '..')

// ---------------------------------------------------------------- setup
if (existsSync(join(ROOT, '.env'))) process.loadEnvFile(join(ROOT, '.env'))
const KEY = (process.env.VITE_TMDB_API_KEY || process.env.VITE_TMDB_READ_TOKEN || process.env.VITE_TMDB_KEY || '').trim()
if (!KEY) {
  console.error('No TMDB key. Put VITE_TMDB_API_KEY=... (or VITE_TMDB_READ_TOKEN=...) in .env first.')
  process.exit(1)
}
const BEARER = KEY.startsWith('eyJ')

let repo = process.argv[2]
if (!repo) {
  repo = mkdtempSync(join(tmpdir(), 'shelf-oldrepo-'))
  console.log(`Cloning ${OLD_REPO} …`)
  execFileSync('git', ['clone', '--depth', '1', '-q', OLD_REPO, repo], { stdio: 'inherit' })
}
const dataDir = join(resolve(repo), 'src', 'data')
const load = (f: string) => import(pathToFileURL(join(dataDir, f)).href)

const { FAVORITE_MEDIA } = await load('favoriteMovies.ts')
const { MIHIR_RATINGS_BY_TMDB_ID, MIHIR_RATINGS_BY_COLLECTION_ID } = await load('mihirRatings.ts')
const { CUSTOM_GENRE_BY_ID } = await load('customGenres.ts')

type Entry =
  | { kind: 'movie' | 'tv'; tmdbId: number }
  | { kind: 'collection'; id: string; title: string; tmdbCollectionId?: number; movieIds: number[]; customPosterPath?: string }

// ---------------------------------------------------------------- TMDB
const HOSTS = ['https://api.tmdb.org/3', 'https://api.themoviedb.org/3']
async function tmdb<T = any>(path: string, params: Record<string, string> = {}): Promise<T> {
  let last: unknown
  for (let attempt = 0; attempt < 3; attempt++) {
    for (const host of HOSTS) {
      const url = new URL(host + path)
      for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
      if (!BEARER) url.searchParams.set('api_key', KEY)
      try {
        const res = await fetch(url, {
          headers: BEARER ? { authorization: `Bearer ${KEY}`, accept: 'application/json' } : { accept: 'application/json' },
          signal: AbortSignal.timeout(12000),
        })
        if (res.status === 401) throw new Error('TMDB rejected the key (401)')
        if (res.status === 404) throw Object.assign(new Error(`not found: ${path}`), { notFound: true })
        if (res.status === 429) {
          await new Promise((r) => setTimeout(r, 1500))
          continue
        }
        if (!res.ok) throw new Error(`TMDB ${res.status} ${path}`)
        return (await res.json()) as T
      } catch (e) {
        if ((e as Error).message.includes('401') || (e as { notFound?: boolean }).notFound) throw e
        last = e
      }
    }
  }
  throw last
}

async function paletteFor(posterPath?: string | null): Promise<Palette | undefined> {
  if (!posterPath) return undefined
  try {
    const res = await fetch(`https://image.tmdb.org/t/p/w185${posterPath}`, { signal: AbortSignal.timeout(15000) })
    const buf = Buffer.from(await res.arrayBuffer())
    const { data, info } = await sharp(buf).resize(24, 36, { fit: 'fill' }).removeAlpha().raw().toBuffer({ resolveWithObject: true })
    return paletteFromPixels(data, info.channels)
  } catch {
    return undefined
  }
}

const year = (d?: string | null) => (d ? Number(d.slice(0, 4)) || 0 : 0)
const toRating = (v: unknown) => {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? ''))
  return Number.isFinite(n) ? Math.min(10, Math.max(1, Math.round(n * 2) / 2)) : undefined
}

// ---------------------------------------------------------------- build one entry
async function build(e: Entry, index: number) {
  const base = { addedAt: Date.UTC(2025, 0, 1) + index * 60_000 }
  if (e.kind === 'movie') {
    const d = await tmdb(`/movie/${e.tmdbId}`, { append_to_response: 'credits' })
    const directors = [...new Set((d.credits?.crew ?? []).filter((c: any) => c.job === 'Director').map((c: any) => c.name))]
    return {
      ...base,
      id: `movie-${d.id}`,
      kind: 'movie',
      tmdbId: d.id,
      imdbId: d.imdb_id ?? '',
      title: d.title,
      year: year(d.release_date),
      director: directors.join(' & '),
      runtime: d.runtime ?? 0,
      genres: (d.genres ?? []).map((g: any) => g.name),
      posterPath: d.poster_path ?? undefined,
      backdropPath: d.backdrop_path ?? undefined,
      palette: await paletteFor(d.poster_path),
      myRating: toRating(MIHIR_RATINGS_BY_TMDB_ID[e.tmdbId]),
      tag: CUSTOM_GENRE_BY_ID[e.tmdbId],
    }
  }
  if (e.kind === 'tv') {
    const d = await tmdb(`/tv/${e.tmdbId}`, { append_to_response: 'external_ids' })
    return {
      ...base,
      id: `tv-${d.id}`,
      kind: 'tv',
      tmdbId: d.id,
      imdbId: d.external_ids?.imdb_id ?? '',
      title: d.name,
      year: year(d.first_air_date),
      director: (d.created_by ?? []).map((c: any) => c.name).join(' & '),
      runtime: d.episode_run_time?.[0] ?? 0,
      genres: (d.genres ?? []).map((g: any) => g.name),
      posterPath: d.poster_path ?? undefined,
      backdropPath: d.backdrop_path ?? undefined,
      palette: await paletteFor(d.poster_path),
      myRating: toRating(MIHIR_RATINGS_BY_TMDB_ID[e.tmdbId]),
      tag: CUSTOM_GENRE_BY_ID[e.tmdbId],
    }
  }
  // collection
  let poster: string | undefined
  let backdrop: string | undefined
  let years: number[] = []
  let genres: string[] = []
  if (e.tmdbCollectionId) {
    try {
      const c = await tmdb(`/collection/${e.tmdbCollectionId}`)
      poster = c.poster_path ?? undefined
      backdrop = c.backdrop_path ?? undefined
      years = (c.parts ?? []).filter((p: any) => e.movieIds.includes(p.id)).map((p: any) => year(p.release_date)).filter(Boolean)
    } catch {
      /* fall through to the first film */
    }
  }
  const first = await tmdb(`/movie/${e.movieIds[0]}`).catch(() => null)
  if (first) {
    poster ??= first.poster_path ?? undefined
    backdrop ??= first.backdrop_path ?? undefined
    genres = (first.genres ?? []).map((g: any) => g.name)
    if (!years.length) years = [year(first.release_date)]
  }
  if (e.customPosterPath) poster = e.customPosterPath
  const title = e.title
    .toLowerCase()
    .replace(/(^|[\s:—–(&-])([a-z])/g, (_m, p, c) => p + c.toUpperCase())
    .replace(/\bIi\b/g, 'II')
    .replace(/\bIv\b/g, 'IV')
    .replace(/\bVi\b/g, 'VI')
    .replace(/\bX-men\b/g, 'X-Men')
    .replace(/\bDc\b/g, 'DC')
  return {
    ...base,
    id: e.id,
    kind: 'collection',
    tmdbId: e.tmdbCollectionId ?? 0,
    imdbId: '',
    title,
    year: years.length ? Math.min(...years) : 0,
    director: '',
    runtime: 0,
    genres,
    parts: e.movieIds.length,
    posterPath: poster,
    backdropPath: backdrop,
    palette: await paletteFor(poster),
    myRating: toRating(MIHIR_RATINGS_BY_COLLECTION_ID[e.id]),
    tag: CUSTOM_GENRE_BY_ID[e.id] ?? (e.tmdbCollectionId ? CUSTOM_GENRE_BY_ID[e.tmdbCollectionId] : undefined),
  }
}

// ---------------------------------------------------------------- run (4 at a time)
const entries = FAVORITE_MEDIA as Entry[]
const out: unknown[] = new Array(entries.length)
const failed: string[] = []
let next = 0
let done = 0
async function worker() {
  while (next < entries.length) {
    const i = next++
    const e = entries[i]
    const label = e.kind === 'collection' ? e.id : `${e.kind} ${e.tmdbId}`
    try {
      out[i] = await build(e, i)
    } catch (err) {
      failed.push(`${label}: ${(err as Error).message}`)
      if ((err as Error).message.includes('401')) {
        console.error('\nTMDB rejected the key. Check .env.')
        process.exit(1)
      }
    }
    done++
    process.stdout.write(`\r${done}/${entries.length}`)
  }
}
await Promise.all([worker(), worker(), worker(), worker()])
process.stdout.write('\n')

const seed = out
  .filter(Boolean)
  .map((m: any) => {
    const clean: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(m)) if (v !== undefined && v !== '' && !(Array.isArray(v) && !v.length)) clean[k] = v
    // required fields
    clean.imdbId ??= ''
    clean.director ??= ''
    clean.runtime ??= 0
    clean.genres ??= []
    clean.myReview = ''
    if (clean.myRating === undefined) {
      failed.push(`${m.id}: no rating in mihirRatings.ts (set to 5)`)
      clean.myRating = 5
    }
    return clean
  })

const file = join(ROOT, 'src', 'data', 'seed.json')
writeFileSync(file, JSON.stringify(seed, null, 1) + '\n')
console.log(`Wrote ${seed.length} entries to src/data/seed.json`)
if (failed.length) console.log('Problems:\n  ' + failed.join('\n  '))
