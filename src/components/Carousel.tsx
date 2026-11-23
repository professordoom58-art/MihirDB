import { memo, useCallback, useEffect, useImperativeHandle, useRef, type Ref } from 'react'
import {
  animate,
  motion,
  useMotionValueEvent,
  useTransform,
  type AnimationPlaybackControls,
  type MotionValue,
} from 'framer-motion'
import type { CaseStyle, Movie } from '../types'
import { clamp, itemTransform, type ShelfLayout } from '../lib/layout'
import { hapticTick } from '../lib/haptics'
import { JewelCase } from './JewelCase'

export interface CarouselHandle {
  goTo: (index: number) => void
  /** move instantly (no animation, no settle) */
  jumpTo: (index: number) => void
  /** screen rect of a case, for the open/close transition */
  caseRect: (index: number) => DOMRect | null
}

interface Props {
  movies: Movie[]
  layout: ShelfLayout
  caseStyle: CaseStyle
  /** fractional index of the item at the centre; shared with the backdrop */
  pos: MotionValue<number>
  activeIndex: number
  onActiveChange: (i: number) => void
  /** fires when the carousel comes to rest on an item */
  onSettle: (i: number) => void
  onTapCentre: (i: number) => void
  /** movie id + counter; the glare sweep plays on that case */
  sweep: { id: string; key: number } | null
  glareX: MotionValue<number>
  glareY: MotionValue<number>
  /** case currently "lifted" into the detail view */
  hiddenId?: string | null
  /** just-saved movie: plays an entry animation */
  freshId?: string | null
  ref?: Ref<CarouselHandle>
}

const SPRING = { type: 'spring' as const, stiffness: 260, damping: 32, mass: 1, restDelta: 0.0005, restSpeed: 0.01 }
const FLICK = 0.24 // seconds of projected momentum
const TAP_SLOP = 7 // px

/** iOS-style edge resistance */
function rubber(over: number) {
  return (1 - 1 / (over * 0.9 + 1)) * 0.6
}

export function Carousel({
  movies,
  layout,
  caseStyle,
  pos,
  activeIndex,
  onActiveChange,
  onSettle,
  onTapCentre,
  sweep,
  glareX,
  glareY,
  hiddenId,
  freshId,
  ref,
}: Props) {
  const n = movies.length
  const stageRef = useRef<HTMLDivElement>(null)
  const anim = useRef<AnimationPlaybackControls | null>(null)
  const target = useRef(Math.round(pos.get()))
  const lastRounded = useRef(Math.round(pos.get()))
  const drag = useRef<{
    id: number
    x0: number
    y0: number
    p0: number
    moved: boolean
    /** element under the finger at pointerdown (pointer capture retargets later events) */
    hit: HTMLElement | null
    samples: { t: number; x: number }[]
  } | null>(null)

  // "Settled" = visually in place, not the end of the spring's long invisible tail.
  const settlePending = useRef(false)
  const fireSettle = useCallback(
    (t: number) => {
      if (!settlePending.current) return
      settlePending.current = false
      onSettle(t)
    },
    [onSettle],
  )

  const goTo = useCallback(
    (index: number, velocity = 0) => {
      const t = clamp(Math.round(index), 0, Math.max(0, n - 1))
      target.current = t
      settlePending.current = true
      anim.current?.stop()
      anim.current = animate(pos, t, {
        ...SPRING,
        velocity,
        onComplete: () => fireSettle(t),
      })
    },
    [n, pos, fireSettle],
  )

  useImperativeHandle(
    ref,
    () => ({
      goTo: (i: number) => goTo(i),
      jumpTo: (i: number) => {
        anim.current?.stop()
        settlePending.current = false
        target.current = i
        pos.jump(i)
      },
      caseRect: (i: number) =>
        stageRef.current?.querySelector(`.item[data-index="${i}"] .case`)?.getBoundingClientRect() ?? null,
    }),
    [goTo, pos],
  )

  // Haptic tick + active-index update whenever a new item crosses the centre.
  useMotionValueEvent(pos, 'change', (v) => {
    const r = clamp(Math.round(v), 0, Math.max(0, n - 1))
    if (r !== lastRounded.current) {
      lastRounded.current = r
      hapticTick()
      onActiveChange(r)
    }
    if (settlePending.current && !drag.current && Math.abs(v - target.current) < 0.025 && Math.abs(pos.getVelocity()) < 1.2) {
      fireSettle(target.current)
    }
  })

  // ---- pointer (touch + mouse) -------------------------------------------
  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0 || n === 0) return
    anim.current?.stop()
    settlePending.current = false
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    const hit = (e.target as HTMLElement).closest<HTMLElement>('[data-index]')
    drag.current = { id: e.pointerId, x0: e.clientX, y0: e.clientY, p0: pos.get(), moved: false, hit, samples: [{ t: e.timeStamp, x: e.clientX }] }
  }

  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current
    if (!d || d.id !== e.pointerId) return
    const dx = e.clientX - d.x0
    if (!d.moved && Math.abs(e.clientY - d.y0) > TAP_SLOP * 2) d.hit = null // vertical drag: not a tap
    if (!d.moved && Math.abs(dx) > TAP_SLOP) d.moved = true
    if (!d.moved) return
    let p = d.p0 - dx / layout.d1
    if (p < 0) p = -rubber(-p)
    else if (p > n - 1) p = n - 1 + rubber(p - (n - 1))
    pos.set(p)
    d.samples.push({ t: e.timeStamp, x: e.clientX })
    if (d.samples.length > 8) d.samples.shift()
  }

  const endDrag = (e: React.PointerEvent, cancelled = false) => {
    const d = drag.current
    if (!d || d.id !== e.pointerId) return
    drag.current = null

    if (!d.moved) {
      if (cancelled) return goTo(target.current)
      // Tap: side item → bring it to centre; centred item → open.
      const i = d.hit ? Number(d.hit.dataset.index) : -1
      if (i < 0) return goTo(target.current)
      if (i === Math.round(pos.get())) {
        goTo(i)
        onTapCentre(i)
      } else goTo(i)
      return
    }

    // Release velocity from the last ~90ms of samples.
    const now = e.timeStamp
    const recent = d.samples.filter((s) => now - s.t < 90)
    let vx = 0
    if (recent.length >= 2) {
      const a = recent[0]
      const b = recent[recent.length - 1]
      const dt = Math.max(1, b.t - a.t) / 1000
      vx = (b.x - a.x) / dt
    }
    const v = -vx / layout.d1 // items per second
    const projected = pos.get() + v * FLICK
    goTo(projected, v)
  }

  // ---- wheel / trackpad + keyboard (laptop preview) ------------------------
  const wheelAcc = useRef(0)
  const wheelTimer = useRef<number | undefined>(undefined)
  const onWheel = (e: React.WheelEvent) => {
    const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY
    wheelAcc.current += delta
    window.clearTimeout(wheelTimer.current)
    wheelTimer.current = window.setTimeout(() => (wheelAcc.current = 0), 160)
    if (Math.abs(wheelAcc.current) > 45) {
      const step = Math.sign(wheelAcc.current)
      wheelAcc.current = 0
      goTo(target.current + step)
    }
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest?.('input, textarea, [role="dialog"]')) return
      if (document.querySelector('[role="dialog"]')) return
      if (e.key === 'ArrowRight') goTo(target.current + 1)
      else if (e.key === 'ArrowLeft') goTo(target.current - 1)
      else if (e.key === 'Enter' && n) onTapCentre(target.current)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [goTo, onTapCentre, n])

  // Keep the position valid if the list shrinks.
  useEffect(() => {
    if (n && pos.get() > n - 1) goTo(n - 1)
  }, [n, pos, goTo])

  // Only mount items near the centre (virtualisation; cheap even with hundreds).
  const lo = Math.max(0, activeIndex - layout.side - 1)
  const hi = Math.min(n - 1, activeIndex + layout.side + 1)
  const items = []
  for (let i = lo; i <= hi; i++) {
    const m = movies[i]
    items.push(
      <CarouselItem
        key={m.id}
        index={i}
        movie={m}
        pos={pos}
        layout={layout}
        caseStyle={caseStyle}
        glareX={glareX}
        glareY={glareY}
        live={Math.abs(i - activeIndex) <= 1}
        sweepKey={sweep && sweep.id === m.id ? sweep.key : null}
        hidden={hiddenId === m.id}
        fresh={freshId === m.id}
      />,
    )
  }

  return (
    <div
      ref={stageRef}
      className="stage"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={(e) => endDrag(e)}
      onPointerCancel={(e) => endDrag(e, true)}
      onWheel={onWheel}
    >
      {items}
    </div>
  )
}

interface ItemProps {
  index: number
  movie: Movie
  pos: MotionValue<number>
  layout: ShelfLayout
  caseStyle: CaseStyle
  glareX: MotionValue<number>
  glareY: MotionValue<number>
  live: boolean
  sweepKey: number | null
  hidden: boolean
  fresh: boolean
}

const CarouselItem = memo(function CarouselItem({
  index,
  movie,
  pos,
  layout,
  caseStyle,
  glareX,
  glareY,
  live,
  sweepKey,
  hidden,
  fresh,
}: ItemProps) {
  const distance = useTransform(pos, (p) => Math.abs(index - p))
  const transform = useTransform(pos, (p) => itemTransform(index - p, layout))
  const zIndex = useTransform(distance, (d) => 1000 - Math.round(d * 10))
  const dim = useTransform(distance, (d) => Math.min(d * 0.55, 0.8))
  const opacity = useTransform(distance, (d) => clamp(layout.side + 0.6 - d, 0, 1))
  const shadow = useTransform(distance, (d) => clamp(1 - d * 0.7, 0.25, 1))

  return (
    <motion.div
      className="item"
      data-index={index}
      style={{
        width: layout.w,
        height: layout.h,
        top: layout.cy - layout.h / 2,
        marginLeft: -layout.w / 2,
        transform,
        zIndex,
        opacity,
        visibility: hidden ? 'hidden' : 'visible',
      }}
    >
      <motion.div
        className="item__drop"
        initial={fresh ? { opacity: 0, y: -70, scale: 1.12 } : false}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ type: 'spring', stiffness: 220, damping: 22, delay: fresh ? 0.25 : 0 }}
      >
        <motion.div className="item__shadow" style={{ opacity: shadow }} />
        <div className="item__press">
          <JewelCase
            movie={movie}
            style={caseStyle}
            distance={distance}
            glareX={glareX}
            glareY={glareY}
            sweepKey={sweepKey}
            live={live}
          />
          <motion.div className="item__dim" style={{ opacity: dim }} />
        </div>
      </motion.div>
    </motion.div>
  )
})
