import { useMemo, useRef, useState } from 'react'
import type { Movie } from '../types'
import { fetchFull } from '../lib/catalog'
import { db, newId, requestPersistence } from '../lib/db'
import { detectScale, matchRow, normaliseRating, parseCatalog, type Match, type RawRow } from '../lib/importer'
import { formatRating } from '../lib/sort'
import { syncPending } from '../lib/sync'
import { Sheet, Spinner } from './ui'

/**
 * One-time importer for the old catalog:
 *  1. source: fetch the old site's URL (dev server), upload a file, or paste text
 *  2. parse → rows (title / year / rating / review), detect rating scale
 *  3. match every row on TMDB; confident matches are pre-accepted
 *  4. review the uncertain ones, then save everything
 */
export function Importer({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Sheet open={open} onClose={onClose} title="Import old catalog" label="Import old catalog" z={50}>
      <ImporterBody onClose={onClose} />
    </Sheet>
  )
}

type Step = 'source' | 'preview' | 'matching' | 'review' | 'saving' | 'done'

function ImporterBody({ onClose }: { onClose: () => void }) {
  const [step, setStep] = useState<Step>('source')
  const [url, setUrl] = useState('')
  const [text, setText] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [rows, setRows] = useState<RawRow[]>([])
  const [scale, setScale] = useState(10)
  const [matches, setMatches] = useState<Match[]>([])
  const [ratings, setRatings] = useState<(number | undefined)[]>([])
  const [progress, setProgress] = useState(0)
  const [result, setResult] = useState({ saved: 0, skipped: 0, failed: 0 })
  const file = useRef<HTMLInputElement>(null)

  const parse = (t: string) => {
    const r = parseCatalog(t)
    if (!r.length) {
      setError("Couldn't find any movies in that. Try exporting a CSV/JSON from the old site, or paste a plain list.")
      return
    }
    setError('')
    setRows(r)
    setScale(detectScale(r))
    setStep('preview')
  }

  const fetchUrl = async () => {
    setBusy(true)
    setError('')
    try {
      if (!import.meta.env.DEV) throw new Error('Fetching a URL only works while running "npm run dev". Upload or paste instead.')
      const res = await fetch(`/__fetch?url=${encodeURIComponent(url.trim())}`)
      const body = await res.text()
      if (!res.ok) throw new Error(`Could not load the page (${res.status}).`)
      setText(body)
      parse(body)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const startMatching = async () => {
    setStep('matching')
    setProgress(0)
    const existing = await db.movies.toArray()
    const out: Match[] = new Array(rows.length)
    let next = 0
    let done = 0
    // three lookups at a time keeps us well inside TMDB's rate limit
    const worker = async () => {
      while (next < rows.length) {
        const i = next++
        out[i] = await matchRow(rows[i])
        done++
        setProgress(done / rows.length)
      }
    }
    await Promise.all([worker(), worker(), worker()])
    // already on the shelf → skip by default
    for (const m of out) {
      const c = m.candidates[m.choice]
      if (c && existing.some((e) => (c.tmdbId && e.tmdbId === c.tmdbId) || (c.imdbId && e.imdbId === c.imdbId))) {
        m.choice = -1
        m.confident = true
        m.error = 'Already on your shelf'
      }
    }
    setMatches(out)
    setRatings(rows.map((r) => normaliseRating(r.rating, scale)))
    setStep('review')
  }

  const save = async () => {
    setStep('saving')
    setProgress(0)
    let saved = 0
    let skipped = 0
    let failed = 0
    const base = Date.now() - matches.length * 1000
    const seen = new Set<string>()
    for (let i = 0; i < matches.length; i++) {
      const m = matches[i]
      const c = m.candidates[m.choice]
      setProgress(i / matches.length)
      if (!c) {
        skipped++
        continue
      }
      const key = `${c.tmdbId ?? ''}|${c.imdbId ?? ''}`
      if (seen.has(key)) {
        skipped++
        continue
      }
      seen.add(key)
      try {
        const full = await fetchFull(c)
        const now = base + i * 1000 // keeps the old list's order for rating ties
        const movie: Movie = {
          ...full.info,
          ...full.scores,
          id: newId(),
          myRating: ratings[i] ?? 5,
          myReview: m.row.review ?? '',
          scoresStatus: full.scoresOk ? 'done' : 'pending',
          addedAt: now,
          updatedAt: now,
        }
        await db.movies.put(movie)
        saved++
      } catch {
        failed++
      }
    }
    requestPersistence()
    void syncPending() // posters + any scores that hit the OMDb limit
    setResult({ saved, skipped, failed })
    setStep('done')
  }

  const uncertain = useMemo(() => matches.map((m, i) => ({ m, i })).filter(({ m }) => !m.confident), [matches])
  const confidentCount = matches.length - uncertain.length
  const toSave = matches.filter((m) => m.choice >= 0).length

  const update = (i: number, choice: number) =>
    setMatches((ms) => ms.map((m, j) => (j === i ? { ...m, choice } : m)))

  // ------------------------------------------------------------ render
  if (step === 'source')
    return (
      <div className="importer">
        <p className="muted">
          Point this at your old catalog. It reads JSON, CSV, a web page, or a plain list like
          <code> The Matrix (1999) - 9/10 - great</code>.
        </p>
        <label className="input">
          <span>Old site URL {import.meta.env.DEV ? '' : '(dev server only)'}</span>
          <div className="inline">
            <input type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" />
            <button className="btn" disabled={!url.trim() || busy} onClick={fetchUrl}>
              {busy ? <Spinner size={16} /> : 'Fetch'}
            </button>
          </div>
        </label>
        <div className="or">or</div>
        <button className="btn" onClick={() => file.current?.click()}>
          Choose a file (JSON / CSV / HTML / TXT)
        </button>
        <input
          ref={file}
          type="file"
          accept=".json,.csv,.tsv,.txt,.html,.htm,application/json,text/*"
          hidden
          onChange={async (e) => {
            const f = e.target.files?.[0]
            e.target.value = ''
            if (f) {
              const t = await f.text()
              setText(t)
              parse(t)
            }
          }}
        />
        <div className="or">or paste</div>
        <textarea className="paste" rows={6} value={text} onChange={(e) => setText(e.target.value)} placeholder="Paste here" />
        <button className="btn btn--primary btn--block" disabled={!text.trim()} onClick={() => parse(text)}>
          Read movies
        </button>
        {error && <div className="hint hint--error">{error}</div>}
      </div>
    )

  if (step === 'preview')
    return (
      <div className="importer">
        <p>
          Found <b>{rows.length}</b> movies.
        </p>
        <div className="row">
          <span>
            Old rating scale
            <small>Converted to 1–10 in half steps</small>
          </span>
          <div className="seg">
            {[5, 10, 100].map((s) => (
              <button key={s} className={scale === s ? 'is-on' : ''} onClick={() => setScale(s)}>
                /{s}
              </button>
            ))}
          </div>
        </div>
        <table className="preview">
          <thead>
            <tr>
              <th>Title</th>
              <th>Year</th>
              <th>Rating</th>
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, 12).map((r, i) => (
              <tr key={i}>
                <td>{r.title}</td>
                <td>{r.year ?? ''}</td>
                <td>{r.rating != null ? `${r.rating} → ${formatRating(normaliseRating(r.rating, scale)!)}` : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length > 12 && <p className="muted">…and {rows.length - 12} more.</p>}
        <div className="btnrow">
          <button className="btn" onClick={() => setStep('source')}>
            Back
          </button>
          <button className="btn btn--primary" onClick={startMatching}>
            Match on TMDB
          </button>
        </div>
      </div>
    )

  if (step === 'matching' || step === 'saving')
    return (
      <div className="importer importer--progress">
        <Spinner size={28} />
        <p>{step === 'matching' ? 'Matching titles…' : 'Saving to your shelf…'}</p>
        <div className="progress">
          <div style={{ width: `${Math.round(progress * 100)}%` }} />
        </div>
        <p className="muted">{Math.round(progress * 100)}%</p>
      </div>
    )

  if (step === 'done')
    return (
      <div className="importer importer--progress">
        <p>
          Saved <b>{result.saved}</b> movies.
          {result.skipped > 0 && ` Skipped ${result.skipped}.`}
          {result.failed > 0 && ` ${result.failed} failed (network), so run the import again for those.`}
        </p>
        <p className="muted">Posters are downloading for offline use in the background.</p>
        <button className="btn btn--primary" onClick={onClose}>
          Done
        </button>
      </div>
    )

  // review
  return (
    <div className="importer">
      <p>
        <b>{confidentCount}</b> matched confidently.{' '}
        {uncertain.length ? (
          <>
            Check these <b>{uncertain.length}</b>:
          </>
        ) : (
          'Nothing needs checking.'
        )}
      </p>
      <ul className="review-list">
        {uncertain.map(({ m, i }) => (
          <li key={i} className="review-item">
            <div className="review-item__src">
              <b>{m.row.title}</b> {m.row.year ? `(${m.row.year})` : ''}
              <RatingPick value={ratings[i]} onChange={(v) => setRatings((r) => r.map((x, j) => (j === i ? v : x)))} />
            </div>
            {m.error && <div className="hint">{m.error}</div>}
            <div className="cands">
              {m.candidates.slice(0, 4).map((c, ci) => (
                <button key={ci} className={`cand${m.choice === ci ? ' is-on' : ''}`} onClick={() => update(i, ci)}>
                  {c.thumb ? <img src={c.thumb} alt="" loading="lazy" /> : <span className="cand__blank" />}
                  <span className="cand__title">{c.title}</span>
                  <span className="cand__year">{c.year ?? '—'}</span>
                </button>
              ))}
              <button className={`cand cand--skip${m.choice === -1 ? ' is-on' : ''}`} onClick={() => update(i, -1)}>
                <span className="cand__blank">✕</span>
                <span className="cand__title">Skip</span>
              </button>
            </div>
          </li>
        ))}
      </ul>
      {matches.some((m, i) => m.choice >= 0 && ratings[i] == null) && (
        <p className="muted">Movies without a rating in the old catalog get 5.0. You can edit them later.</p>
      )}
      <button className="btn btn--primary btn--block" disabled={!toSave} onClick={save}>
        Save {toSave} movies
      </button>
    </div>
  )
}

const OPTIONS = Array.from({ length: 19 }, (_, i) => 1 + i / 2)

function RatingPick({ value, onChange }: { value?: number; onChange: (v: number) => void }) {
  return (
    <select className="ratingpick" aria-label="Rating" value={value ?? ''} onChange={(e) => onChange(Number(e.target.value))}>
      {value == null && <option value="">–</option>}
      {OPTIONS.map((v) => (
        <option key={v} value={v}>
          {formatRating(v)}
        </option>
      ))}
    </select>
  )
}
