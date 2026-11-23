import type { Candidate } from '../types'
import { searchMovies } from './catalog'

/** One movie as found in the old catalog, before matching. */
export interface RawRow {
  title: string
  year?: number
  rating?: number // as found, on whatever scale the old site used
  review?: string
}

// ---------------------------------------------------------------- parsing

const KEY = {
  title: /^(title|name|movie|film|movie ?title|film ?title)$/i,
  year: /^(year|release|released|release ?year|release ?date|date)$/i,
  rating: /^(rating|my ?rating|score|my ?score|stars|rate|grade|points)$/i,
  review: /^(review|my ?review|comment|comments|notes?|thoughts|text|description|verdict)$/i,
}

function pickKey(keys: string[], re: RegExp) {
  return keys.find((k) => re.test(k.trim()))
}

function toYear(v: unknown): number | undefined {
  const m = String(v ?? '').match(/\b(18[89]\d|19\d\d|20\d\d)\b/)
  return m ? Number(m[1]) : undefined
}

function toRating(v: unknown): number | undefined {
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined
  const s = String(v ?? '').trim()
  if (!s) return undefined
  const stars = (s.match(/★/g) || []).length + (s.includes('½') ? 0.5 : 0)
  if (stars) return stars
  const frac = s.match(/(\d+(?:[.,]\d+)?)\s*\/\s*(\d+)/)
  if (frac) return (parseFloat(frac[1].replace(',', '.')) / Number(frac[2])) * 10
  const n = parseFloat(s.replace(',', '.').replace(/[^0-9.]/g, ''))
  return Number.isFinite(n) ? n : undefined
}

function fromObjects(list: Record<string, unknown>[]): RawRow[] {
  const keys = Object.keys(list[0] ?? {})
  const kt = pickKey(keys, KEY.title) ?? keys[0]
  const ky = pickKey(keys, KEY.year)
  const kr = pickKey(keys, KEY.rating)
  const kv = pickKey(keys, KEY.review)
  return list
    .map((o) => {
      const t = String(o[kt] ?? '').trim()
      return {
        title: t,
        year: ky ? toYear(o[ky]) : undefined,
        rating: kr ? toRating(o[kr]) : undefined,
        review: kv ? String(o[kv] ?? '').trim() || undefined : undefined,
      }
    })
    .filter((r) => r.title)
}

function parseJson(text: string): RawRow[] | null {
  try {
    const d = JSON.parse(text)
    const arr = Array.isArray(d) ? d : Object.values(d).find(Array.isArray)
    if (Array.isArray(arr) && arr.length && typeof arr[0] === 'object') return fromObjects(arr as Record<string, unknown>[])
  } catch {
    /* not JSON */
  }
  return null
}

function splitCsvLine(line: string, sep: string): string[] {
  const out: string[] = []
  let cur = ''
  let q = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (q) {
      if (c === '"' && line[i + 1] === '"') (cur += '"'), i++
      else if (c === '"') q = false
      else cur += c
    } else if (c === '"') q = true
    else if (c === sep) out.push(cur), (cur = '')
    else cur += c
  }
  out.push(cur)
  return out.map((s) => s.trim())
}

/** Split CSV text into lines, keeping newlines that sit inside quotes. */
function csvLines(text: string): string[] {
  const lines: string[] = []
  let cur = ''
  let q = false
  for (const ch of text.replace(/\r\n?/g, '\n')) {
    if (ch === '"') q = !q
    if (ch === '\n' && !q) {
      if (cur.trim()) lines.push(cur)
      cur = ''
    } else cur += ch
  }
  if (cur.trim()) lines.push(cur)
  return lines
}

function parseCsv(text: string): RawRow[] | null {
  const lines = csvLines(text)
  if (lines.length < 2) return null
  const sep = [',', '\t', ';', '|'].map((s) => [s, lines[0].split(s).length] as const).sort((a, b) => b[1] - a[1])[0]
  if (sep[1] < 2) return null
  const head = splitCsvLine(lines[0], sep[0])
  const hasHeader = head.some((h) => KEY.title.test(h))
  const keys = hasHeader ? head : head.map((_, i) => ['title', 'year', 'rating', 'review'][i] ?? `col${i}`)
  const body = hasHeader ? lines.slice(1) : lines
  return fromObjects(body.map((l) => Object.fromEntries(splitCsvLine(l, sep[0]).map((v, i) => [keys[i] ?? `col${i}`, v]))))
}

/** "Title (1999) - 8.5/10 - great film" style lines. */
function parseLines(text: string): RawRow[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && l.length < 400)
    .map((l) => {
      const year = toYear(l)
      const rm = l.match(/(\d+(?:[.,]\d)?)\s*\/\s*(10|5|100)\b/) || l.match(/[-–|:]\s*(\d{1,2}(?:[.,]5)?)\s*(?:[-–|:]|$)/)
      const rating = rm ? toRating(rm[0].replace(/^[-–|:]\s*/, '').replace(/\s*[-–|:]$/, '')) : (l.match(/★/g)?.length ?? undefined)
      let title = l
      if (year) title = title.split(new RegExp(`[\\(\\[]?\\s*${year}`))[0]
      if (rm) title = title.split(rm[0])[0]
      title = title.replace(/[★½]+.*$/, '').replace(/[\s\-–|:,]+$/, '').replace(/^\d+[.)]\s+/, '').trim()
      const rest = rm ? l.slice(l.indexOf(rm[0]) + rm[0].length).replace(/^[\s\-–|:]+/, '').trim() : ''
      return { title, year, rating, review: rest.length > 3 ? rest : undefined }
    })
    .filter((r) => r.title.length > 0 && r.title.length < 120)
}

function parseHtml(html: string): RawRow[] | null {
  const doc = new DOMParser().parseFromString(html, 'text/html')

  // 1. schema.org JSON-LD (Movie / Review)
  const ld: RawRow[] = []
  doc.querySelectorAll('script[type="application/ld+json"]').forEach((s) => {
    try {
      const walk = (n: unknown): void => {
        if (Array.isArray(n)) return n.forEach(walk)
        if (!n || typeof n !== 'object') return
        const o = n as Record<string, any>
        if (o['@graph']) walk(o['@graph'])
        const type = String(o['@type'] ?? '')
        if (type === 'Review' && o.itemReviewed?.name) {
          const r = o.reviewRating
          const best = Number(r?.bestRating) || 10
          ld.push({
            title: o.itemReviewed.name,
            year: toYear(o.itemReviewed.dateCreated ?? o.itemReviewed.datePublished),
            rating: r?.ratingValue != null ? (Number(r.ratingValue) / best) * 10 : undefined,
            review: o.reviewBody,
          })
        } else if (type === 'Movie' && o.name) {
          ld.push({ title: o.name, year: toYear(o.dateCreated ?? o.datePublished) })
        }
        Object.values(o).forEach((v) => typeof v === 'object' && walk(v))
      }
      walk(JSON.parse(s.textContent || ''))
    } catch {
      /* ignore bad block */
    }
  })
  if (ld.length) return ld

  // 2. tables with a header row
  for (const table of Array.from(doc.querySelectorAll('table'))) {
    const rows = Array.from(table.querySelectorAll('tr')).map((tr) =>
      Array.from(tr.querySelectorAll('th,td')).map((c) => (c.textContent || '').trim()),
    )
    if (rows.length > 1 && rows[0].some((h) => KEY.title.test(h))) {
      return fromObjects(rows.slice(1).map((r) => Object.fromEntries(r.map((v, i) => [rows[0][i] ?? `col${i}`, v]))))
    }
  }

  // 3. repeated "cards": elements with a heading, plus nearby rating/review text
  const cards: RawRow[] = []
  doc.querySelectorAll('article, li, .movie, .card, [class*="movie"], [class*="film"]').forEach((el) => {
    const h = el.querySelector('h1,h2,h3,h4,h5,.title,[class*="title"]')
    if (!h) return
    const title = (h.textContent || '').trim()
    if (!title || title.length > 120) return
    const text = (el.textContent || '').replace(/\s+/g, ' ')
    const rEl = el.querySelector('[class*="rating"],[class*="score"],[class*="star"]')
    const pEl = el.querySelector('p,[class*="review"],[class*="comment"]')
    cards.push({
      title: title.replace(/\(\s*\d{4}\s*\)/, '').trim(),
      year: toYear(title) ?? toYear(el.querySelector('[class*="year"],time')?.textContent),
      rating: toRating(rEl?.getAttribute('data-rating') ?? rEl?.textContent ?? text.match(/\d+(?:\.\d)?\s*\/\s*10/)?.[0]),
      review: pEl && pEl !== h ? (pEl.textContent || '').trim() || undefined : undefined,
    })
  })
  const seen = new Set<string>()
  const uniq = cards.filter((c) => !seen.has(c.title) && seen.add(c.title))
  if (uniq.length >= 2) return uniq

  // 4. plain text
  return parseLines(doc.body?.innerText || doc.body?.textContent || '')
}

export function parseCatalog(text: string): RawRow[] {
  const t = text.trim()
  if (!t) return []
  if (/^[[{]/.test(t)) {
    const j = parseJson(t)
    if (j) return j
  }
  if (/<\/?[a-z][\s\S]*>/i.test(t.slice(0, 2000))) {
    const h = parseHtml(t)
    if (h?.length) return h
  }
  return parseCsv(t) ?? parseLines(t)
}

/** Work out the old site's rating scale and map to 1–10 in 0.5 steps. */
export function detectScale(rows: RawRow[]): number {
  const max = Math.max(0, ...rows.map((r) => r.rating ?? 0))
  if (max <= 5) return 5
  if (max <= 10) return 10
  return 100
}

export function normaliseRating(r: number | undefined, scale: number): number | undefined {
  if (r == null) return undefined
  const v = Math.round(((r / scale) * 10) * 2) / 2
  return Math.min(10, Math.max(1, v))
}

// ---------------------------------------------------------------- matching

function norm(s: string) {
  return s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/^(the|a|an)\s+/, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

/** Sørensen–Dice similarity over character bigrams, 0..1. */
export function similarity(a: string, b: string): number {
  const x = norm(a)
  const y = norm(b)
  if (x === y) return 1
  if (x.length < 2 || y.length < 2) return 0
  const grams = (s: string) => {
    const m = new Map<string, number>()
    for (let i = 0; i < s.length - 1; i++) m.set(s.slice(i, i + 2), (m.get(s.slice(i, i + 2)) ?? 0) + 1)
    return m
  }
  const gx = grams(x)
  const gy = grams(y)
  let inter = 0
  gx.forEach((n, g) => (inter += Math.min(n, gy.get(g) ?? 0)))
  return (2 * inter) / (x.length - 1 + (y.length - 1))
}

export interface Match {
  row: RawRow
  candidates: Candidate[]
  /** index into candidates; -1 = skip */
  choice: number
  confident: boolean
  error?: string
}

function score(row: RawRow, c: Candidate) {
  const t = Math.max(similarity(row.title, c.title), c.originalTitle ? similarity(row.title, c.originalTitle) : 0)
  const y = row.year && c.year ? (row.year === c.year ? 0.15 : Math.abs(row.year - c.year) === 1 ? 0.05 : -0.25) : 0
  return t + y
}

export async function matchRow(row: RawRow): Promise<Match> {
  try {
    let { results } = await searchMovies(row.title, undefined, row.year)
    if (!results.length && row.year) results = (await searchMovies(row.title)).results
    const ranked = results
      .map((c) => ({ c, s: score(row, c) }))
      .sort((a, b) => b.s - a.s)
      .slice(0, 5)
    const best = ranked[0]
    const second = ranked[1]
    const confident =
      !!best && best.s >= (row.year ? 1.05 : 0.95) && (!second || best.s - second.s > 0.12 || !!row.year)
    return { row, candidates: ranked.map((r) => r.c), choice: best ? 0 : -1, confident }
  } catch (e) {
    return { row, candidates: [], choice: -1, confident: false, error: (e as Error).message }
  }
}
