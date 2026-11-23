import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  animate,
  motion,
  useMotionValue,
  useMotionValueEvent,
  useReducedMotion,
  useTransform,
  type AnimationPlaybackControls,
  type MotionValue,
  type Variants,
} from 'framer-motion'
import type { CaseStyle, Movie } from '../types'
import { formatRating } from '../lib/sort'
import { posterSrc } from '../lib/tmdb'
import { hapticTick } from '../lib/haptics'
import { CHOREO, DISMISS, REDUCED, SPRING } from '../lib/motion'
import { JewelCase } from './JewelCase'
import { fmtRuntime } from './MovieEditor'
import { Confirm } from './ui'

export interface CasePose {
  cx: number
  cy: number
  w: number
  rotate: number
}

interface Props {
  movie: Movie
  caseStyle: CaseStyle
  accent: string
  /** where the case sits on the arc right now (re-queried on close) */
  getOrigin: () => CasePose | null
  /** 0..1: drives the shelf "making room" (neighbours out, caption/top bar fade, background dim) */
  room: MotionValue<number>
  glareX: MotionValue<number>
  glareY: MotionValue<number>
  onClosed: () => void
  onEdit: (m: Movie) => void
  onDelete: (m: Movie) => void
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v))

export function DetailView({ movie, caseStyle, accent, getOrigin, room, glareX, glareY, onClosed, onEdit, onDelete }: Props) {
  const reduce = useReducedMotion() ?? false
  const card = useRef<HTMLDivElement>(null)
  const scroller = useRef<HTMLDivElement>(null)
  const slot = useRef<HTMLDivElement>(null)
  const phase = useRef<'open' | 'closing' | 'closed'>('open')
  const anims = useRef<AnimationPlaybackControls[]>([])
  const [shown, setShown] = useState(false) // content rows in/out
  const [closing, setClosing] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [sweep, setSweep] = useState<number | null>(null)
  const pushed = useRef(false)

  // ---------------------------------------------------------------- motion values
  const open = useMotionValue(0) // 0 = on the shelf, 1 = detail fully open
  const dragY = useMotionValue(0)
  const hx = useMotionValue(0) // hero (the case) offset from its detail slot, in card space
  const hy = useMotionValue(0)
  const hs = useMotionValue(1)
  const hr = useMotionValue(0)
  const count = useMotionValue(0)
  const zero = useMotionValue(0)

  const dragP = useTransform(dragY, (y) => clamp01(y / DISMISS.range))
  const cardScale = useTransform(dragP, (p) => 1 - (1 - DISMISS.minScale) * p)
  const cardRadius = useTransform(dragP, (p) => p * DISMISS.maxRadius)
  const scrimOpacity = useTransform([open, dragP] as MotionValue<number>[], ([o, p]: number[]) => o * (1 - p * 0.85))
  const surfaceOpacity = useTransform([open, dragP] as MotionValue<number>[], ([o, p]: number[]) => o * (1 - p * 0.25))
  const glowOpacity = useTransform(open, (o) => o * 0.9)
  const chromeOpacity = useTransform(open, (o) => clamp01(o * 1.4 - 0.4))

  // the shelf makes room while open, and comes back as you drag down
  useEffect(() => {
    const sync = () => room.set(open.get() * (1 - dragP.get() * 0.7))
    const a = open.on('change', sync)
    const b = dragP.on('change', sync)
    return () => {
      a()
      b()
      room.set(0)
    }
  }, [open, dragP, room])

  const stopAll = () => {
    anims.current.forEach((a) => a.stop())
    anims.current = []
  }
  const run = (a: AnimationPlaybackControls) => (anims.current.push(a), a)

  // ---------------------------------------------------------------- geometry
  /** Hero motion values that put the case exactly at a screen pose, given the card's current drag transform. */
  const heroTarget = (pose: CasePose) => {
    const s = cardScale.get()
    const dy = dragY.get()
    const C = { x: window.innerWidth / 2, y: window.innerHeight / 2 }
    const toLocal = (px: number, py: number) => ({ x: C.x + (px - C.x) / s, y: C.y + (py - dy - C.y) / s })
    const r = slot.current!.getBoundingClientRect()
    const slotC = toLocal(r.left + r.width / 2, r.top + r.height / 2)
    const t = toLocal(pose.cx, pose.cy)
    return { x: t.x - slotC.x, y: t.y - slotC.y, scale: pose.w / (r.width / s) / s, rotate: pose.rotate }
  }

  // ---------------------------------------------------------------- open
  const toOpen = (velocityY = 0) => {
    phase.current = 'open'
    setClosing(false)
    setShown(true)
    run(animate(open, 1, SPRING.main))
    run(animate(hx, 0, SPRING.main))
    run(animate(hy, 0, { ...SPRING.main, velocity: velocityY }))
    run(animate(hs, 1, SPRING.main))
    run(animate(hr, 0, SPRING.main))
  }

  useLayoutEffect(() => {
    hapticTick()
    if (!pushed.current) {
      pushed.current = true
      try {
        history.pushState({ shelfDetail: true }, '') // so the back gesture/button closes the detail
      } catch {
        /* ignore */
      }
    }
    if (reduce) {
      setShown(true)
      run(animate(open, 1, { duration: REDUCED.duration }))
      count.set(movie.myRating)
      return
    }
    const pose = getOrigin()
    if (pose) {
      const t = heroTarget(pose)
      hx.set(t.x)
      hy.set(t.y)
      hs.set(t.scale)
      hr.set(t.rotate)
    }
    setSweep(1) // glare streak while it travels
    toOpen()
    run(animate(count, movie.myRating, { ...SPRING.count, delay: CHOREO.contentDelay + 3 * CHOREO.stagger }))
    return stopAll
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ---------------------------------------------------------------- close
  const finish = () => {
    if (phase.current !== 'closing') return
    phase.current = 'closed'
    onClosed()
  }

  const close = (velocityY = 0) => {
    if (phase.current !== 'open') return
    stopAll()
    phase.current = 'closing'
    setClosing(true)
    setShown(false)
    if (history.state?.shelfDetail) {
      try {
        history.back()
      } catch {
        /* ignore */
      }
    }
    if (reduce) {
      run(animate(open, 0, { duration: REDUCED.duration })).finished.then(finish)
      return
    }
    run(animate(open, 0, SPRING.main))
    const pose = getOrigin()
    if (!pose) {
      run(animate(open, 0, SPRING.main)).finished.then(finish)
      return
    }
    const t = heroTarget(pose)
    const s = cardScale.get()
    run(animate(hx, t.x, SPRING.main))
    run(animate(hs, t.scale, SPRING.main))
    run(animate(hr, t.rotate, SPRING.main))
    // keep the release velocity (screen px/s → card space)
    run(animate(hy, t.y, { ...SPRING.main, velocity: velocityY / s })).finished.then(finish)
  }

  // back button / Escape
  useEffect(() => {
    const onPop = () => close()
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !confirming && close()
    window.addEventListener('popstate', onPop)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('popstate', onPop)
      window.removeEventListener('keydown', onKey)
    }
  })

  // The tap that opened us is followed by a synthetic click that lands on the new
  // overlay; ignore background taps for a moment so it doesn't close straight away.
  const openedAt = useRef(performance.now())
  const closeFromBackground = () => performance.now() - openedAt.current > 350 && close()

  // ---------------------------------------------------------------- drag to dismiss
  const crossed = useRef(false)
  useMotionValueEvent(dragY, 'change', (y) => {
    const past = y > DISMISS.distance
    if (past !== crossed.current) {
      crossed.current = past
      if (past) hapticTick() // soft tick when crossing the threshold
    }
  })

  useEffect(() => {
    const el = card.current
    if (!el) return
    let startX = 0
    let startY = 0
    let base = 0
    let decided = false
    let active = false
    let samples: { t: number; y: number }[] = []

    const begin = (x: number, y: number, t: number) => {
      // grabbing it mid-close takes over from where things are
      if (phase.current === 'closing') {
        stopAll()
        toOpen()
      }
      startX = x
      startY = y
      base = dragY.get()
      decided = false
      active = false
      samples = [{ t, y }]
    }
    const move = (x: number, y: number, t: number, prevent: () => void) => {
      const dx = x - startX
      const dy = y - startY
      if (!decided) {
        if (Math.abs(dx) < 6 && Math.abs(dy) < 6) return
        decided = true
        const atTop = (scroller.current?.scrollTop ?? 0) <= 0
        active = atTop && dy > 0 && Math.abs(dy) > Math.abs(dx)
        // a real drag takes over any running spring (e.g. snapping back)
        if (active) anims.current.filter(Boolean).forEach((a) => a.stop())
        if (active && dragY.get() !== base) base = dragY.get()
      }
      if (!active) return
      prevent()
      dragY.set(Math.max(0, base + dy))
      samples.push({ t, y })
      if (samples.length > 6) samples.shift()
    }
    const end = () => {
      if (!active) return
      active = false
      const a = samples[0]
      const b = samples[samples.length - 1]
      const v = b && a && b.t > a.t ? ((b.y - a.y) / (b.t - a.t)) * 1000 : 0 // px/s
      if (dragY.get() > DISMISS.distance || v > DISMISS.velocity) close(v)
      else {
        if (phase.current !== 'open') toOpen()
        run(animate(dragY, 0, { ...SPRING.snapBack, velocity: v }))
      }
    }

    // touch: touch events (only they can cancel iOS scrolling)
    const ts = (e: TouchEvent) => begin(e.touches[0].clientX, e.touches[0].clientY, e.timeStamp)
    const tm = (e: TouchEvent) => move(e.touches[0].clientX, e.touches[0].clientY, e.timeStamp, () => e.preventDefault())
    const te = () => end()
    // mouse: pointer events + window listeners while held
    const pd = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse' || e.button !== 0) return
      begin(e.clientX, e.clientY, e.timeStamp)
      const pm = (ev: PointerEvent) => move(ev.clientX, ev.clientY, ev.timeStamp, () => ev.preventDefault())
      const pu = () => {
        window.removeEventListener('pointermove', pm)
        window.removeEventListener('pointerup', pu)
        end()
      }
      window.addEventListener('pointermove', pm)
      window.addEventListener('pointerup', pu)
    }
    el.addEventListener('touchstart', ts, { passive: true })
    el.addEventListener('touchmove', tm, { passive: false })
    el.addEventListener('touchend', te)
    el.addEventListener('touchcancel', te)
    el.addEventListener('pointerdown', pd)
    return () => {
      el.removeEventListener('touchstart', ts)
      el.removeEventListener('touchmove', tm)
      el.removeEventListener('touchend', te)
      el.removeEventListener('touchcancel', te)
      el.removeEventListener('pointerdown', pd)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ---------------------------------------------------------------- content
  const rows: Variants = reduce
    ? { hidden: { opacity: 1 }, shown: { opacity: 1 }, gone: { opacity: 1 } }
    : {
        hidden: { opacity: 0, y: CHOREO.rise },
        shown: (i: number) => ({ opacity: 1, y: 0, transition: { ...SPRING.content, delay: CHOREO.contentDelay + i * CHOREO.stagger } }),
        gone: { opacity: 0, y: 0, transition: SPRING.contentOut },
      }
  const state = shown ? 'shown' : closing ? 'gone' : 'hidden'
  let rowIndex = 0
  /** props for each content row: staggered in, all out together */
  const row = () => ({ variants: rows, custom: rowIndex++, initial: 'hidden', animate: state }) as const

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
        <span className={`mc mc--${movie.metacritic >= 61 ? 'good' : movie.metacritic >= 40 ? 'mixed' : 'bad'}`}>{movie.metacritic}</span>
        Metacritic
      </span>
    ),
  ].filter(Boolean)

  const years = movie.children?.map((c) => c.year).filter(Boolean) ?? []
  const meta = [
    movie.kind === 'collection' && years.length > 1 ? `${Math.min(...years)}–${Math.max(...years)}` : movie.year || null,
    movie.kind === 'collection' && movie.parts ? `${movie.parts} films` : null,
    movie.kind === 'tv' && movie.seasons ? `${movie.seasons} season${movie.seasons === 1 ? '' : 's'}` : movie.kind === 'tv' ? 'Series' : null,
    movie.kind === 'tv' && movie.creator ? `Created by ${movie.creator}` : movie.director || null,
    movie.runtime && movie.kind !== 'collection' ? fmtRuntime(movie.runtime) + (movie.kind === 'tv' ? ' / ep' : '') : null,
  ].filter(Boolean)

  return (
    <motion.div
      className="detail"
      role="dialog"
      aria-modal="true"
      aria-label={movie.title}
      style={reduce ? { opacity: open } : undefined}
    >
      <motion.div className="detail__scrim" style={{ opacity: scrimOpacity }} onClick={closeFromBackground} />
      <motion.div ref={card} className="detail__card" style={{ y: dragY, scale: cardScale, borderRadius: cardRadius }}>
        <motion.div className="detail__surface" style={{ opacity: surfaceOpacity }} />
        <div ref={scroller} className="detail__scroll" onClick={(e) => e.target === e.currentTarget && closeFromBackground()}>
          <div className="detail__top">
            <motion.button className="iconbtn detail__close" aria-label="Close" onClick={() => close()} style={{ opacity: chromeOpacity }}>
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M6 9l6 6 6-6" />
              </svg>
            </motion.button>
          </div>

          {/* the slot is the layout box; the hero inside it is the same case, flown in/out with springs */}
          <div ref={slot} className={`detail__slot detail__slot--${caseStyle}`}>
            <motion.div className="detail__hero" style={{ x: hx, y: hy, scale: hs, rotate: hr }}>
              <motion.div className="detail__glow" style={{ opacity: glowOpacity, background: `radial-gradient(closest-side, ${accent}66, transparent)` }} />
              <JewelCase movie={movie} style={caseStyle} distance={zero} glareX={glareX} glareY={glareY} sweepKey={sweep} live={sweep !== null} />
            </motion.div>
          </div>

          <div className="detail__content">
            <motion.div {...row()}>
              <h1 className="detail__title">{movie.title}</h1>
            </motion.div>
            <motion.div className="detail__meta" {...row()}>{meta.join(' · ')}</motion.div>
            {(movie.genres.length > 0 || movie.tag) && (
              <motion.div {...row()}>
                {movie.genres.length > 0 && <div className="detail__genres">{movie.genres.join(' · ')}</div>}
                {movie.tag && (
                  <div className="detail__tag" style={{ color: accent, borderColor: accent }}>
                    {movie.tag}
                  </div>
                )}
              </motion.div>
            )}
            <motion.div {...row()}>
              <div className="detail__rating" style={{ color: accent }}>
                <Count value={count} final={movie.myRating} />
                <span className="detail__of">/10</span>
              </div>
            </motion.div>
            {chips.length > 0 && <motion.div className="chips" {...row()}>{chips}</motion.div>}
            {movie.myReview && (
              <motion.div {...row()}>
                <p className="detail__review">{movie.myReview}</p>
              </motion.div>
            )}
            {movie.children && movie.children.length > 0 && (
              <motion.div className="films" {...row()}>
                <div className="films__label">{movie.children.length} films</div>
                <ul className="films__grid">
                  {movie.children.map((c) => (
                    <li key={c.tmdbId} className={`film${c.favorite ? ' film--fav' : ''}`}>
                      <div className="film__poster">
                        {c.posterPath ? <img src={posterSrc(c.posterPath, 'w185')} alt="" loading="lazy" draggable={false} /> : <span />}
                        {c.favorite && (
                          <span className="film__fav" style={{ background: accent }} title="Favourite">
                            ★
                          </span>
                        )}
                      </div>
                      <div className="film__title">{c.title}</div>
                      <div className="film__meta">
                        {c.year || ''}
                        {c.myRating != null && <b style={{ color: accent }}> · {formatRating(c.myRating)}</b>}
                      </div>
                      {c.myReview && <div className="film__review">{c.myReview}</div>}
                    </li>
                  ))}
                </ul>
              </motion.div>
            )}
            {movie.overview && (
              <motion.div {...row()}>
                <p className="detail__overview">{movie.overview}</p>
              </motion.div>
            )}
            <motion.div className="detail__actions" {...row()}>
              <button className="btn" onClick={() => onEdit(movie)}>
                Edit
              </button>
              <button className="btn btn--danger-ghost" onClick={() => setConfirming(true)}>
                Delete
              </button>
            </motion.div>
          </div>
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
    </motion.div>
  )
}

/** Rating that counts up as it appears; settles on the exact value. */
function Count({ value, final }: { value: MotionValue<number>; final: number }) {
  const ref = useRef<HTMLSpanElement>(null)
  useMotionValueEvent(value, 'change', (v) => {
    if (ref.current) ref.current.textContent = Math.abs(v - final) < 0.01 ? formatRating(final) : v.toFixed(1)
  })
  return <span ref={ref}>{value.get() ? formatRating(final) : '0.0'}</span>
}
