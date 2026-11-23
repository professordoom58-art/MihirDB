import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import type { Movie } from '../types'
import { formatRange, formatRating } from '../lib/sort'
import { similarity } from '../lib/importer'
import { posterFor } from '../lib/posters'
import { useEscape } from './ui'
import { RangeSlider } from './RangeSlider'

export interface Filter {
  min: number
  max: number
}

export const NO_FILTER: Filter = { min: 1, max: 10 }
export const isFiltered = (f: Filter) => f.min > 1 || f.max < 10

/** quick presets above the slider */
const CHIPS: { label: string; min: number; max: number }[] = [
  { label: 'All', min: 1, max: 10 },
  { label: '10', min: 10, max: 10 },
  { label: '9+', min: 9, max: 10 },
  { label: '8+', min: 8, max: 10 },
  { label: '7+', min: 7, max: 10 },
  { label: 'Under 7', min: 1, max: 6.5 },
]

interface Props {
  open: boolean
  movies: Movie[]
  filter: Filter
  onFilter: (f: Filter) => void
  onPick: (id: string) => void
  onSettings: () => void
  onClose: () => void
}

export function SearchPanel(props: Props) {
  return <AnimatePresence>{props.open && <PanelInner {...props} />}</AnimatePresence>
}

function PanelInner({ movies, filter, onFilter, onPick, onSettings, onClose }: Props) {
  const [q, setQ] = useState('')
  const [dragging, setDragging] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  useEscape(onClose)
  useLayoutEffect(() => {
    // focus within the tap so the keyboard comes up on iOS
    if (matchMedia('(pointer: fine)').matches) input.current?.focus({ preventScroll: true })
  }, [])

  const hits = useMemo(() => {
    const query = q.trim().toLowerCase()
    if (!query) return []
    return movies
      .map((m) => {
        const t = m.title.toLowerCase()
        const s = t.includes(query) ? 2 - t.indexOf(query) / 100 : similarity(query, m.title)
        return { m, s }
      })
      .filter((x) => x.s > 0.45)
      .sort((a, b) => b.s - a.s)
      .slice(0, 8)
      .map((x) => x.m)
  }, [q, movies])

  return (
    <>
      <motion.div className="scrim" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} />
      <motion.div
        className="panel"
        role="dialog"
        aria-label="Search and filter"
        initial={{ opacity: 0, y: -12, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: -8, scale: 0.98 }}
        transition={{ type: 'spring', stiffness: 420, damping: 34 }}
      >
        <div className="panel__search">
          <input
            ref={input}
            type="search"
            enterKeyHint="search"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            placeholder="Find on my shelf"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <button className="iconbtn iconbtn--small" aria-label="Settings" onClick={onSettings}>
            <svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
            </svg>
          </button>
        </div>

        {hits.length > 0 && (
          <ul className="panel__hits">
            {hits.map((m) => (
              <li key={m.id}>
                <button className="hit" onClick={() => onPick(m.id)}>
                  <img src={posterFor(m)} alt="" />
                  <span className="hit__title">
                    {m.title} <em>{m.year || ''}</em>
                  </span>
                  <span className="hit__rating">{formatRating(m.myRating)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {q.trim() && hits.length === 0 && <div className="panel__note">Not on your shelf.</div>}

        <div className="panel__filter">
          <div className="panel__filterhead">
            <span>My rating</span>
            <span className="panel__range" aria-live="polite">
              {dragging ? '' : formatRange(filter.min, filter.max, ' – ')}
            </span>
          </div>
          <div className="chips-row" role="group" aria-label="Rating presets">
            {CHIPS.map((c) => {
              const on = filter.min === c.min && filter.max === c.max
              return (
                <button key={c.label} className={`qchip${on ? ' is-on' : ''}`} aria-pressed={on} onClick={() => onFilter({ min: c.min, max: c.max })}>
                  {c.label}
                </button>
              )
            })}
          </div>
          <RangeSlider
            value={[filter.min, filter.max] as [number, number]}
            onChange={([min, max]) => onFilter({ min, max })}
            label="My rating"
            onDragging={setDragging}
          />
        </div>
      </motion.div>
    </>
  )
}
