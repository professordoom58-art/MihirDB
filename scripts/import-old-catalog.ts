/**
 * Imports my full catalog from the old ILOVEMOVIES repo into src/data/seed.json.
 *
 *   npm run import:old                          # uses ../ilovemovies-old (clones it if missing)
 *   npm run import:old -- --repo D:\some\path   # or another checkout
 *   npm run import:old -- --fresh               # ignore scripts/.cache
 *
 * Values are loaded by *executing* the old data files (Node's built-in TypeScript
 * support), not by regex, so ids, ratings, tags and collection fields are exact.
 * Only the "// 24. Inception (10)" comments (which aren't values) are read from the
 * source text, and each one is cross-checked against the entry it belongs to.
 *
 * Needs VITE_TMDB_API_KEY in .env. VITE_OMDB_API_KEY (optional) adds IMDb / RT / Metacritic.
 * Raw responses are cached in scripts/.cache, so re-runs are instant.
 */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import sharp from 'sharp'
import { paletteFromPixels, type Palette } from '../src/lib/palette.ts'

const OLD_REPO_URL = 'https://github.com/professordoom58-art/ILOVEMOVIES'
const ROOT = resolve(import.meta.dirname, '..')
const CACHE = join(ROOT, 'scripts', '.cache')
const args = process.argv.slice(2)
const argVal = (flag: string) => (args.includes(flag) ? args[args.indexOf(flag) + 1] : undefined)

// ------------------------------------------------------------------ env + repo
if (existsSync(join(ROOT, '.env'))) process.loadEnvFile(join(ROOT, '.env'))
const TMDB_KEY = (process.env.VITE_TMDB_API_KEY || process.env.VITE_TMDB_READ_TOKEN || '').trim()
const OMDB_KEY = (process.env.VITE_OMDB_API_KEY || process.env.VITE_OMDB_KEY || '').trim()
if (!TMDB_KEY) {
  console.error('VITE_TMDB_API_KEY is missing from .env')
  process.exit(1)
}
const BEARER = TMDB_KEY.startsWith('eyJ')

if (args.includes('--fresh')) rmSync(CACHE, { recursive: true, force: true })
mkdirSync(CACHE, { recursive: true })

const repo = resolve(argVal('--repo') ?? join(ROOT, '..', 'ilovemovies-old'))
if (!existsSync(join(repo, 'src', 'data', 'favoriteMovies.ts'))) {
  console.log(`Cloning ${OLD_REPO_URL} → ${repo}`)
  execFileSync('git', ['clone', '--depth', '1', '-q', OLD_REPO_URL, repo], { stdio: 'inherit' })
}
const dataDir = join(repo, 'src', 'data')
const load = (f: string) => import(pathToFileURL(join(dataDir, f)).href)

const { FAVORITE_MEDIA } = await load('favoriteMovies.ts')
const { MIHIR_RATINGS_BY_TMDB_ID, MIHIR_RATINGS_BY_COLLECTION_ID } = await load('mihirRatings.ts')
const { CUSTOM_GENRE_BY_ID } = await load('customGenres.ts')

type MovieRef = { kind: 'movie' | 'tv'; tmdbId: number }
type CollectionRef = {
  kind: 'collection'
  id: string
  title: string
  tag?: string
  tmdbCollectionId?: number
  movieIds: number[]
  favoriteMovieIds?: number[]
  customPosterPath?: string
}
type Ref = MovieRef | CollectionRef
const entries = FAVORITE_MEDIA as Ref[]

// ------------------------------------------------------------------ "// N. Title (rating)" comments
/**
 * Each entry ends with a trailing comment like `}, // 124. Transformers Collection — Films 1–3 (9)`.
 * Walk the source, pairing the k-th entry with the k-th numbered comment, and verify each pair:
 * a movie/tv comment must sit on the same line as its tmdbId; a collection comment must
 * follow its `id: '…'`.
 */
function readComments(src: string, list: Ref[]) {
  const lines = src.split(/\r?\n/)
  const comments: { line: number; n: number; label: string }[] = []
  lines.forEach((l, i) => {
    const m = l.match(/\/\/\s*(\d+)\.\s*(.+?)\s*$/)
    if (m) comments.push({ line: i, n: Number(m[1]), label: m[2] })
  })
  if (comments.length !== list.length) throw new Error(`Found ${comments.length} numbered comments for ${list.length} entries`)
  let prevLine = -1
  return list.map((e, k) => {
    const c = comments[k]
    const text = lines.slice(prevLine + 1, c.line + 1).join('\n')
    prevLine = c.line
    const ok =
      e.kind === 'collection'
        ? text.includes(`'${e.id}'`) || text.includes(`"${e.id}"`)
        : new RegExp(`tmdbId:\\s*${e.tmdbId}\\b`).test(lines[c.line])
    if (!ok) throw new Error(`Comment "${c.n}. ${c.label}" doesn't match entry #${k + 1} (${JSON.stringify(e)})`)
    // "Inception (10)" → "Inception"; keep inner parentheses like "Fixed (2025)"
    const title = c.label.replace(/\s*\((?:\d+(?:\.\d+)?|[^)]*\/[^)]*)\)\s*$/, '')
    return { n: c.n, title }
  })
}
const commentInfo = readComments(readFileSync(join(dataDir, 'favoriteMovies.ts'), 'utf8'), entries)

// ------------------------------------------------------------------ throttled, cached fetching
const MAX_CONCURRENT = 20
let active = 0
const queue: (() => void)[] = []
async function slot<T>(fn: () => Promise<T>): Promise<T> {
  if (active >= MAX_CONCURRENT) await new Promise<void>((r) => queue.push(r))
  active++
  try {
    return await fn()
  } finally {
    active--
    queue.shift()?.()
  }
}

const cacheFile = (kind: string, key: string) =>
  join(CACHE, `${kind}-${createHash('sha1').update(key).digest('hex').slice(0, 16)}.json`)

async function cached<T>(kind: string, key: string, fetcher: () => Promise<T>): Promise<T> {
  const f = cacheFile(kind, key)
  if (existsSync(f)) return JSON.parse(readFileSync(f, 'utf8'))
  const v = await fetcher()
  writeFileSync(f, JSON.stringify(v))
  return v
}

class NotFound extends Error {}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** GET with retries: 429 honours Retry-After, network errors back off. */
async function getJson(url: URL, headers: Record<string, string> = {}): Promise<any> {
  let lastErr: unknown
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      const res = await slot(() => fetch(url, { headers: { accept: 'application/json', ...headers }, signal: AbortSignal.timeout(15000) }))
      if (res.status === 429) {
        await sleep((Number(res.headers.get('retry-after')) || 1 + attempt) * 1000)
        continue
      }
      if (res.status === 404) throw new NotFound(url.pathname)
      if (res.status === 401) throw new Error(`401 Unauthorized for ${url.host}: check the API key`)
      if (!res.ok) throw new Error(`HTTP ${res.status} ${url.pathname}`)
      return await res.json()
    } catch (e) {
      if (e instanceof NotFound || String(e).includes('401')) throw e
      lastErr = e
      await sleep(400 * (attempt + 1))
    }
  }
  throw lastErr
}

// api.themoviedb.org is DNS-blocked on some ISPs; api.tmdb.org is the same API
const TMDB_HOSTS = ['https://api.tmdb.org/3', 'https://api.themoviedb.org/3']
let hostIdx = 0
function tmdb(path: string, params: Record<string, string> = {}): Promise<any> {
  const key = path + '?' + new URLSearchParams(params).toString()
  return cached('tmdb', key, async () => {
    for (let h = 0; h < TMDB_HOSTS.length; h++) {
      const url = new URL(TMDB_HOSTS[(hostIdx + h) % TMDB_HOSTS.length] + path)
      for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
      if (!BEARER) url.searchParams.set('api_key', TMDB_KEY)
      try {
        const r = await getJson(url, BEARER ? { authorization: `Bearer ${TMDB_KEY}` } : {})
        hostIdx = (hostIdx + h) % TMDB_HOSTS.length
        return r
      } catch (e) {
        if (e instanceof NotFound || String(e).includes('401') || h === TMDB_HOSTS.length - 1) throw e
      }
    }
  })
}

interface Scores {
  imdbRating?: number
  rtScore?: number
  metacritic?: number
}
async function omdb(imdbId: string): Promise<Scores> {
  if (!OMDB_KEY || !imdbId) return {}
  const r = await cached('omdb', imdbId, () => getJson(new URL(`https://www.omdbapi.com/?i=${imdbId}&apikey=${OMDB_KEY}`)))
  if (r.Response === 'False') return {}
  const num = (s?: string) => (s && s !== 'N/A' && Number.isFinite(parseFloat(s)) ? parseFloat(s.replace(/[^0-9.]/g, '')) : undefined)
  return {
    imdbRating: num(r.imdbRating),
    rtScore: num(r.Ratings?.find((x: any) => x.Source === 'Rotten Tomatoes')?.Value),
    metacritic: num(r.Metascore),
  }
}

async function palette(posterPath?: string): Promise<Palette | undefined> {
  if (!posterPath) return undefined
  return cached('palette', posterPath, async () => {
    const res = await slot(() => fetch(`https://image.tmdb.org/t/p/w185${posterPath}`, { signal: AbortSignal.timeout(20000) }))
    if (!res.ok) throw new Error(`poster ${res.status}`)
    const { data, info } = await sharp(Buffer.from(await res.arrayBuffer()))
      .resize(24, 36, { fit: 'fill' })
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true })
    return paletteFromPixels(data, info.channels)
  }).catch(() => undefined)
}

// ------------------------------------------------------------------ ratings + tags (exact values)
const ratingOf = (v: unknown): number | undefined => {
  if (v === undefined || v === null || v === '') return undefined
  const n = typeof v === 'number' ? v : parseFloat(String(v))
  return Number.isFinite(n) ? n : undefined
}
const collectionTmdbIds = new Set(entries.filter((e): e is CollectionRef => e.kind === 'collection').map((e) => e.tmdbCollectionId).filter(Boolean))
const tagFor = (e: Ref): string | undefined => {
  if (e.kind === 'collection') return CUSTOM_GENRE_BY_ID[e.id] ?? (e.tmdbCollectionId ? CUSTOM_GENRE_BY_ID[e.tmdbCollectionId] : undefined) ?? e.tag
  // numeric keys that are TMDB *collection* ids belong to the collection, not a movie with the same number
  if (collectionTmdbIds.has(e.tmdbId) && CUSTOM_GENRE_BY_ID[e.tmdbId]) warnings.push(`tmdbId ${e.tmdbId} is also a collection id; its tag may belong to the collection`)
  return CUSTOM_GENRE_BY_ID[e.tmdbId]
}

const year = (d?: string | null) => (d ? Number(d.slice(0, 4)) || 0 : 0)
const names = (a?: { name: string }[]) => [...new Set((a ?? []).map((x) => x.name))]
const warnings: string[] = []

// ------------------------------------------------------------------ build each entry
async function buildMovie(e: MovieRef) {
  const d = await tmdb(`/movie/${e.tmdbId}`, { append_to_response: 'credits,external_ids' })
  const imdbId = d.external_ids?.imdb_id || d.imdb_id || ''
  return {
    id: `movie-${d.id}`,
    kind: 'movie' as const,
    tmdbId: d.id,
    imdbId,
    title: d.title,
    year: year(d.release_date),
    director: names((d.credits?.crew ?? []).filter((c: any) => c.job === 'Director')).join(' & '),
    runtime: d.runtime ?? 0,
    genres: names(d.genres),
    overview: d.overview || undefined,
    posterPath: d.poster_path ?? undefined,
    backdropPath: d.backdrop_path ?? undefined,
    palette: await palette(d.poster_path),
    ...(await omdb(imdbId)),
  }
}

async function buildTv(e: MovieRef) {
  const d = await tmdb(`/tv/${e.tmdbId}`, { append_to_response: 'external_ids' })
  const imdbId = d.external_ids?.imdb_id || ''
  return {
    id: `tv-${d.id}`,
    kind: 'tv' as const,
    tmdbId: d.id,
    imdbId,
    title: d.name,
    year: year(d.first_air_date),
    director: '',
    creator: names(d.created_by).join(' & ') || undefined,
    runtime: d.episode_run_time?.[0] ?? 0,
    seasons: d.number_of_seasons ?? undefined,
    episodes: d.number_of_episodes ?? undefined,
    genres: names(d.genres),
    overview: d.overview || undefined,
    posterPath: d.poster_path ?? undefined,
    backdropPath: d.backdrop_path ?? undefined,
    palette: await palette(d.poster_path),
    ...(await omdb(imdbId)),
  }
}

async function buildCollection(e: CollectionRef) {
  const col = e.tmdbCollectionId ? await tmdb(`/collection/${e.tmdbCollectionId}`).catch((err) => {
    warnings.push(`${e.id}: /collection/${e.tmdbCollectionId} failed (${err.message})`)
    return null
  }) : null
  const favorites = new Set(e.favoriteMovieIds ?? [])
  const films = await Promise.all(
    e.movieIds.map(async (id) => {
      const d = await tmdb(`/movie/${id}`, { append_to_response: 'external_ids' })
      return {
        tmdbId: d.id,
        title: d.title,
        year: year(d.release_date),
        posterPath: d.poster_path ?? undefined,
        imdbId: d.external_ids?.imdb_id || d.imdb_id || undefined,
        myRating: ratingOf(MIHIR_RATINGS_BY_TMDB_ID[id]),
        favorite: favorites.has(id) || undefined,
        _genres: names(d.genres),
        _backdrop: d.backdrop_path ?? undefined,
        _overview: d.overview,
      }
    }),
  )
  const posterPath = e.customPosterPath ?? col?.poster_path ?? films[0]?.posterPath
  const years = films.map((f) => f.year).filter(Boolean)
  return {
    id: e.id,
    kind: 'collection' as const,
    tmdbId: e.tmdbCollectionId ?? 0,
    imdbId: '',
    title: titleCase(e.title),
    sourceTitle: e.title, // exactly as written in favoriteMovies.ts
    year: years.length ? Math.min(...years) : 0,
    director: '',
    runtime: 0,
    genres: films[0]?._genres ?? [],
    overview: col?.overview || films[0]?._overview || undefined,
    posterPath,
    backdropPath: col?.backdrop_path ?? films[0]?._backdrop,
    palette: await palette(posterPath),
    parts: films.length,
    children: films.map(({ _genres, _backdrop, _overview, ...f }) => f),
  }
}

/** Title-case the old ALL-CAPS label: small words lower-case (except first / after ":" or "—"), roman numerals and acronyms kept. */
function titleCase(s: string) {
  const SMALL = new Set(['a', 'an', 'and', 'as', 'at', 'by', 'for', 'in', 'of', 'on', 'or', 'the', 'to', 'vs'])
  const KEEP = /^(I{1,3}|IV|VI{0,3}|IX|X|DC|[IVX]+[–-][IVX]+)$/
  const words = s.split(' ')
  return words
    .map((w, i) => {
      if (KEEP.test(w) || /\d/.test(w) || /^[&—–+]$/.test(w)) return w
      const lower = w.toLowerCase()
      const startOfPhrase = i === 0 || /[:—–]$/.test(words[i - 1]) || /^[—–]$/.test(words[i - 1])
      if (!startOfPhrase && SMALL.has(lower)) return lower
      // capitalise each hyphen part ("x-men" → "X-Men"); apostrophes don't start a word ("ocean's")
      return lower.replace(/(^|-)([a-z])/g, (_m, p, c) => p + c.toUpperCase())
    })
    .join(' ')
}

// ------------------------------------------------------------------ run
const BASE_ADDED = Date.UTC(2025, 0, 1)
const failures: string[] = []
const results = await Promise.all(
  entries.map(async (e, i) => {
    const { n, title } = commentInfo[i]
    try {
      const built = e.kind === 'collection' ? await buildCollection(e) : e.kind === 'tv' ? await buildTv(e) : await buildMovie(e)
      const myRating = e.kind === 'collection' ? ratingOf(MIHIR_RATINGS_BY_COLLECTION_ID[e.id]) : ratingOf(MIHIR_RATINGS_BY_TMDB_ID[e.tmdbId])
      if (myRating === undefined) failures.push(`#${n} ${title}: no rating in mihirRatings.ts`)
      const tag = tagFor(e)
      // drop undefined so the JSON stays tidy
      const out: Record<string, unknown> = { ...built, myRating, myReview: '', tag, originalOrder: n, addedAt: BASE_ADDED + n * 60_000 }
      for (const k of Object.keys(out)) if (out[k] === undefined) delete out[k]
      return out
    } catch (err) {
      failures.push(`#${n} ${title} (${e.kind} ${e.kind === 'collection' ? e.id : e.tmdbId}): ${(err as Error).message}`)
      return null
    }
  }),
)

const seed = results.filter(Boolean) as Record<string, any>[]
writeFileSync(join(ROOT, 'src', 'data', 'seed.json'), JSON.stringify(seed, null, 1) + '\n')

const count = (k: string) => seed.filter((m) => m.kind === k).length
console.log('\n──────── Import summary ────────')
console.log(`Entries in old catalog : ${entries.length}`)
console.log(`Imported               : ${seed.length}`)
console.log(`  movies / TV / collections: ${count('movie')} / ${count('tv')} / ${count('collection')}   (expected 128 / 27 / 24)`)
console.log(`  films inside collections : ${seed.reduce((s, m) => s + (m.children?.length ?? 0), 0)}`)
console.log(`  with tag / palette / backdrop: ${seed.filter((m) => m.tag).length} / ${seed.filter((m) => m.palette).length} / ${seed.filter((m) => m.backdropPath).length}`)
console.log(`  critic scores: ${OMDB_KEY ? `${seed.filter((m) => m.imdbRating != null).length} with IMDb rating (OMDb)` : 'skipped (no VITE_OMDB_API_KEY)'}`)
if (failures.length) console.log('\nFailed to resolve:\n  ' + failures.join('\n  '))
else console.log('\nFailed to resolve: none')
if (warnings.length) console.log('\nWarnings:\n  ' + warnings.join('\n  '))
console.log('\nWrote src/data/seed.json')
if (failures.length) process.exitCode = 1
