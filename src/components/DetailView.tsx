import { useLayoutEffect, useRef, useState } from 'react'
import { animate, motion, useMotionValue, useTransform, useReducedMotion } from 'framer-motion'
import type { CaseStyle, Movie } from '../types'
import { formatRating } from '../lib/sort'
import { hapticTap } from '../lib/haptics'
import { JewelCase } from './JewelCase'
import { fmtRuntime } from './MovieEditor'
import { Confirm, useEscape, useSwipeDown } from './ui'

interface Props {
  movie: Movie
  caseStyle: CaseStyle
  accent: string
  /** where the case sits on the shelf right now (re-queried on close) */
  originRect: () => DOMRect | null
  onClosed: () => void
  onEdit: (m: Movie) => void
  onDelete: (m: Movie) => void
}

const EASE = [0.2, 0.8, 0.2, 1] as const

export function DetailView({ movie, caseStyle, accent, originRect, onClosed, onEdit, onDelete }: Props) {
  const hero = useRef<HTMLDivElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  const scroller = useRef<HTMLDivElement>(null)
  const reduce = useReducedMotion()
  const [closing, setClosing] = useState(false)
  const [confirming, setConfirming] = useState(false)

  // The tap that opened us is followed by a synthetic click that lands on the new
  // overlay; ignore background clicks for a moment so it doesn't close straight away.
  const openedAt = useRef(performance.now())
  const closeFromBackground = () => performance.now() - openedAt.current > 450 && close()

  const dragY = useMotionValue(0)
  const fade = useMotionValue(0) // 0..1 visibility of sheet chrome
  const scrimOpacity = useTransform([fade, dragY] as never, ([f, y]: number[]) => f * Math.max(0, 1 - y / 500))
  const contentY = useTransform(fade, (f) => (1 - f) * 40)

  /** FLIP: the hero case starts exactly over the shelf case, then flies to its place. */
  const flyFrom = (r: DOMRect | null) => {
    const el = hero.current
    if (!el || !r) return null
    const h = el.getBoundingClientRect()
    return {
      x: r.left + r.width / 2 - (h.left + h.width / 2),
      y: r.top + r.height / 2 - (h.top + h.height / 2) - dragY.get(),
      scale: r.width / h.width,
    }
  }

  useLayoutEffect(() => {
    const el = hero.current
    if (!el) return
    const from = flyFrom(originRect())
    hapticTap()
    if (reduce || !from) {
      animate(fade, 1, { duration: 0.2 })
      return
    }
    el.style.transform = `perspective(1100px) translate3d(${from.x}px, ${from.y}px, 0) scale(${from.scale})`
    // lift (scale up + a little flip), then settle
    animate(
      el,
      {
        transform: [
          `perspective(1100px) translate3d(${from.x}px, ${from.y}px, 0) scale(${from.scale}) rotateY(0deg)`,
          `perspective(1100px) translate3d(${from.x * 0.4}px, ${from.y * 0.45 - 24}px, 60px) scale(${(from.scale + 1) / 2 + 0.04}) rotateY(-16deg)`,
          'perspective(1100px) translate3d(0px, 0px, 0px) scale(1) rotateY(0deg)',
        ],
      },
      { duration: 0.62, ease: EASE, times: [0, 0.45, 1] },
    )
    animate(fade, 1, { duration: 0.45, ease: EASE, delay: 0.08 })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const close = () => {
    if (closing) return
    setClosing(true)
    const el = hero.current
    const from = flyFrom(originRect())
    animate(fade, 0, { duration: 0.28, ease: EASE })
    if (!el || !from || reduce) {
      setTimeout(onClosed, 220)
      return
    }
    animate(
      el,
      { transform: `perspective(1100px) translate3d(${from.x}px, ${from.y}px, 0px) scale(${from.scale}) rotateY(0deg)` },
      { duration: 0.44, ease: EASE },
    ).then(onClosed)
    animate(dragY, 0, { duration: 0.44, ease: EASE })
  }

  useSwipeDown(panel, scroller, dragY, close, !closing)
  useEscape(close, !confirming)

  const chips = [
    movie.imdbRating != null && (
      <span key="imdb" className="chip chip--imdb">
        <b>IMDb</b> ★ {movie.imdbRating.toFixed(1)}
      </span>
    ),
    movie.rtScore != null && (
      <span key="rt" className="chip">
        🍅 {movie.rtScore}%
      </span>
    ),
    movie.metacritic != null && (
      <span key="mc" className="chip chip--mc">
        <span className={`mc mc--${movie.metacritic >= 61 ? 'good' : movie.metacritic >= 40 ? 'mixed' : 'bad'}`}>
          {movie.metacritic}
        </span>
        Metacritic
      </span>
    ),
  ].filter(Boolean)

  const meta = [
    movie.year || null,
    movie.kind === 'collection' && movie.parts ? `${movie.parts} films` : movie.kind === 'tv' ? 'Series' : null,
    movie.director || null,
    movie.runtime && movie.kind !== 'collection' ? fmtRuntime(movie.runtime) + (movie.kind === 'tv' ? ' / ep' : '') : null,
  ].filter(Boolean)

  return (
    <div className="detail" role="dialog" aria-modal="true" aria-label={movie.title}>
      <motion.div className="detail__scrim" style={{ opacity: scrimOpacity }} onClick={closeFromBackground} />
      <motion.div ref={panel} className="detail__panel" style={{ y: dragY }}>
        <div ref={scroller} className="detail__scroll" onClick={(e) => e.target === e.currentTarget && closeFromBackground()}>
          <div className="detail__top">
            <motion.button className="iconbtn detail__close" aria-label="Close" onClick={close} style={{ opacity: fade }}>
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M6 9l6 6 6-6" />
              </svg>
            </motion.button>
          </div>
          <div className={`detail__hero detail__hero--${caseStyle}`} ref={hero}>
            <JewelCase movie={movie} style={caseStyle} />
          </div>
          <motion.div className="detail__content" style={{ opacity: fade, y: contentY }}>
            <h1 className="detail__title">{movie.title}</h1>
            <div className="detail__meta">{meta.join(' · ')}</div>
            {movie.genres.length > 0 && <div className="detail__genres">{movie.genres.join(' · ')}</div>}
            {movie.tag && (
              <div className="detail__tag" style={{ color: accent, borderColor: accent }}>
                {movie.tag}
              </div>
            )}

            <div className="detail__rating" style={{ color: accent }}>
              {formatRating(movie.myRating)}
              <span>/10</span>
            </div>

            {chips.length > 0 && <div className="chips">{chips}</div>}

            {movie.myReview && <p className="detail__review">{movie.myReview}</p>}

            <div className="detail__actions">
              <button className="btn" onClick={() => onEdit(movie)}>
                Edit
              </button>
              <button className="btn btn--danger-ghost" onClick={() => setConfirming(true)}>
                Delete
              </button>
            </div>
          </motion.div>
        </div>
      </motion.div>
      <Confirm
        open={confirming}
        title={`Delete “${movie.title}”?`}
        body="Your rating and review will be removed. This can't be undone."
        confirmLabel="Delete"
        danger
        onCancel={() => setConfirming(false)}
        onConfirm={() => {
          setConfirming(false)
          onDelete(movie)
        }}
      />
    </div>
  )
}
