import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { Candidate, Movie } from '../types'
import { describeError, fetchFull, searchMovies, type FullInfo, type Provider } from '../lib/catalog'
import { findExisting } from '../lib/db'
import { addMovie, updateMine } from '../lib/store'
import { formatRating } from '../lib/sort'
import { posterFor } from '../lib/posters'
import { AutoTextarea, RatingSlider, Sheet, Spinner } from './ui'

interface Props {
  open: boolean
  /** editing an existing movie; otherwise "add" mode starting at search */
  editing: Movie | null
  onClose: () => void
  onSaved: (id: string, isNew: boolean) => void
}

export function MovieEditor({ open, editing, onClose, onSaved }: Props) {
  return (
    <Sheet open={open} onClose={onClose} label={editing ? 'Edit movie' : 'Add movie'} z={30}>
      <EditorBody key={editing?.id ?? 'new'} editing={editing} onClose={onClose} onSaved={onSaved} />
    </Sheet>
  )
}

function EditorBody({ editing, onClose, onSaved }: Omit<Props, 'open'>) {
  const [mode, setMode] = useState<'search' | 'form'>(editing ? 'form' : 'search')
  const [target, setTarget] = useState<Movie | null>(editing)
  const [picked, setPicked] = useState<Candidate | null>(null)

  if (mode === 'search')
    return (
      <SearchStep
        onPick={(c) => {
          setPicked(c)
          setMode('form')
        }}
      />
    )
  return (
    <FormStep
      key={target?.id ?? picked?.tmdbId ?? picked?.imdbId}
      editing={target}
      candidate={picked}
      onBack={editing ? undefined : () => setMode('search')}
      onSwitchToEdit={(m) => {
        setTarget(m)
        setPicked(null)
      }}
      onDone={(id, isNew) => {
        onSaved(id, isNew)
        onClose()
      }}
    />
  )
}

// ----------------------------------------------------------------- search

function SearchStep({ onPick }: { onPick: (c: Candidate) => void }) {
  const [q, setQ] = useState('')
  const [results, setResults] = useState<Candidate[]>([])
  const [provider, setProvider] = useState<Provider>('tmdb')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const input = useRef<HTMLInputElement>(null)

  // Focus synchronously after the tap so iOS shows the keyboard.
  useLayoutEffect(() => {
    input.current?.focus({ preventScroll: true })
  }, [])

  useEffect(() => {
    const query = q.trim()
    if (query.length < 2) {
      setResults([])
      setError('')
      setBusy(false)
      return
    }
    const ac = new AbortController()
    setBusy(true)
    const t = window.setTimeout(async () => {
      try {
        const r = await searchMovies(query, ac.signal)
        setResults(r.results)
        setProvider(r.provider)
        setError(r.results.length ? '' : 'No matches.')
      } catch (e) {
        if ((e as Error).name !== 'AbortError') setError(describeError(e))
      } finally {
        if (!ac.signal.aborted) setBusy(false)
      }
    }, 300)
    return () => {
      ac.abort()
      window.clearTimeout(t)
    }
  }, [q])

  return (
    <div className="editor">
      <div className="searchfield">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
          <circle cx="10.5" cy="10.5" r="6.5" />
          <path d="M15.5 15.5 20 20" />
        </svg>
        <input
          ref={input}
          autoFocus
          type="search"
          inputMode="search"
          enterKeyHint="search"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          placeholder="Search for a movie"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        {busy && <Spinner size={16} />}
      </div>
      {provider === 'omdb' && results.length > 0 && (
        <div className="hint">TMDB is unreachable from this network, so these results come from OMDb.</div>
      )}
      {error && <div className="hint">{error}</div>}
      <ul className="results">
        {results.map((c) => (
          <li key={`${c.source}-${c.tmdbId ?? c.imdbId}`}>
            <button className="result" onClick={() => onPick(c)}>
              <div className="result__thumb">{c.thumb ? <img src={c.thumb} alt="" loading="lazy" /> : <span />}</div>
              <div className="result__text">
                <div className="result__title">{c.title}</div>
                <div className="result__meta">
                  {c.year ?? '—'}
                  {c.originalTitle && c.originalTitle !== c.title ? ` · ${c.originalTitle}` : ''}
                </div>
                {c.overview && <div className="result__overview">{c.overview}</div>}
              </div>
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

// ----------------------------------------------------------------- form

function FormStep({
  editing,
  candidate,
  onBack,
  onSwitchToEdit,
  onDone,
}: {
  editing: Movie | null
  candidate: Candidate | null
  onBack?: () => void
  onSwitchToEdit: (m: Movie) => void
  onDone: (id: string, isNew: boolean) => void
}) {
  const [full, setFull] = useState<FullInfo | null>(null)
  const [error, setError] = useState('')
  const [dupe, setDupe] = useState<Movie | null>(null)
  const [rating, setRating] = useState(editing?.myRating ?? 7)
  const [review, setReview] = useState(editing?.myReview ?? '')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (editing || !candidate) return
    let alive = true
    findExisting(candidate.tmdbId, candidate.imdbId).then((m) => alive && m && setDupe(m))
    fetchFull(candidate)
      .then(async (f) => {
        if (!alive) return
        setFull(f)
        const m = await findExisting(f.info.tmdbId, f.info.imdbId)
        if (alive && m) setDupe(m)
      })
      .catch((e) => alive && setError(describeError(e)))
    return () => {
      alive = false
    }
  }, [editing, candidate])

  const info = editing ?? full?.info
  const title = info?.title ?? candidate?.title ?? ''
  const year = info?.year || candidate?.year
  const thumb = editing ? posterFor(editing) : full?.info.posterUrl || candidate?.thumb

  const save = async () => {
    setSaving(true)
    try {
      if (editing) {
        await updateMine(editing.id, rating, review)
        onDone(editing.id, false)
      } else if (full) {
        const m = await addMovie({ ...full, myRating: rating, myReview: review })
        onDone(m.id, true)
      }
    } catch (e) {
      setError(describeError(e))
      setSaving(false)
    }
  }

  return (
    <div className="editor">
      {onBack && (
        <button className="textbtn backbtn" onClick={onBack}>
          ‹ Search
        </button>
      )}
      <div className="picked">
        <div className="picked__poster">{thumb ? <img src={thumb} alt="" /> : <span />}</div>
        <div className="picked__text">
          <div className="picked__title">{title}</div>
          <div className="picked__meta">
            {year || ''}
            {info?.director ? ` · ${info.director}` : ''}
          </div>
          {!editing && !full && !error && (
            <div className="picked__loading">
              <Spinner size={14} /> Fetching details and scores…
            </div>
          )}
          {info && info.runtime > 0 && (
            <div className="picked__meta">
              {fmtRuntime(info.runtime)}
              {info.genres.length ? ` · ${info.genres.slice(0, 3).join(', ')}` : ''}
            </div>
          )}
        </div>
      </div>

      {dupe && !editing && (
        <div className="notice">
          <div>
            Already on your shelf, rated <b>{formatRating(dupe.myRating)}</b>.
          </div>
          <button className="btn btn--small" onClick={() => onSwitchToEdit(dupe)}>
            Edit that one instead
          </button>
        </div>
      )}
      {error && <div className="hint hint--error">{error}</div>}

      <div className="field">
        <div className="field__label">My rating</div>
        <RatingSlider value={rating} onChange={setRating} />
      </div>

      <div className="field">
        <div className="field__label">My review</div>
        <AutoTextarea
          className="review-input"
          placeholder="What did you think?"
          value={review}
          onChange={(e) => setReview(e.target.value)}
        />
      </div>

      <button
        className="btn btn--primary btn--block"
        disabled={saving || (!editing && (!full || !!dupe))}
        onClick={save}
      >
        {saving ? <Spinner size={16} /> : editing ? 'Save changes' : 'Save to shelf'}
      </button>
    </div>
  )
}

export function fmtRuntime(min: number) {
  const h = Math.floor(min / 60)
  const m = min % 60
  return h ? `${h}h ${m}m` : `${m}m`
}
