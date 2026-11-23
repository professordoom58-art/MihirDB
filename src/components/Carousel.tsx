import { memo, useCallback, useEffect, useImperativeHandle, useRef, useState, type Ref } from 'react'
import {
  AnimatePresence,
  animate,
  motion,
  useMotionValueEvent,
  useTransform,
  type AnimationPlaybackControls,
  type MotionValue,
} from 'framer-motion'
import type { CaseStyle, Movie } from '../types'
import { ARC, clamp, depthAt, itemTransform, screenPose, wrap, type ShelfLayout } from '../lib/layout'
import { hapticTick } from '../lib/haptics'
import { JewelCase } from './JewelCase'

export interface CarouselHandle {
  /** glide to a movie (by its index in the list), the short way round the loop */
  goTo: (index: number) => void
  /** move instantly (no animation, no settle) */
  jumpTo: (index: number) => void
  /** where a case is on screen right now (centre, width, rotation) for the shared-element transition */
  pose: (index: number) => { cx: number; cy: number; w: number; rotate: number }
}

interface Props {
  movies: Movie[]
  layout: ShelfLayout
  caseStyle: CaseStyle
  /**
   * Position on the wheel in *slots* (unbounded when looping): slot k shows movie k mod n.
   * Shared with the backdrop for parallax.
   */
  pos: MotionValue<number>
  /** a new movie reached the top: its index in the list, and the slot it sits in */
  onActiveChange: (index: number, slot: number) => void
  /** fires when the carousel comes to rest on an item (list index) */
  onSettle: (index: number) => void
  onTapCentre: (index: number) => void
  /** movie id + counter; the glare sweep plays on that case */
  sweep: { id: string; key: number } | null
  glareX: MotionValue<number>
  glareY: MotionValue<number>
  /** case currently "lifted" into the detail view */
  hiddenId?: string | null
  /** just-saved movie: plays an entry animation */
  freshId?: string | null
  /** 0..1 while the detail view is open: neighbours slide outward and fade */
  room: MotionValue<number>
  /** ignore swipes / wheel / keys (detail view open) */
  locked?: boolean
  ref?: Ref<CarouselHandle>
}

const SPRING = { type: 'spring' as const, stiffness: 260, damping: 32, mass: 1, restDelta: 0.0005, restSpeed: 0.01 }
const FLICK = 0.24 // seconds of projected momentum
const TAP_SLOP = 7 // px

/** iOS-style edge resistance (only when the list is too short to loop) */
function rubber(over: number) {
  return (1 - 1 / (over * 0.9 + 1)) * 0.6
}

export function Carousel({
  movies,
  layout,
  caseStyle,
  pos,
  onActiveChange,
  onSettle,
  onTapCentre,
  sweep,
  glareX,
  glareY,
  hiddenId,
  freshId,
  room,
  locked = false,
  ref,
}: Props) {
  const n = movies.length
  // Loop like a wheel (179 sits before 1) whenever there are enough cases to fill the
  // visible window without showing the same case twice; otherwise a bounded row.
  const loop = n > layout.side * 2 + 1
  const toIndex = useCallback((slot: number) => (loop ? wrap(slot, n) : clamp(slot, 0, Math.max(0, n - 1))), [loop, n])
  /** slot for movie `i` nearest to slot position `from` (the short way round) */
  const slotFor = useCallback((i: number, from: number) => (loop ? i + n * Math.round((from - i) / n) : i), [loop, n])

  const arcTilt = useTransform(glareX, (gx) => gx * ARC.tiltDeg)
  const anim = useRef<AnimationPlaybackControls | null>(null)
  const target = useRef(Math.round(pos.get()))
  const lastRounded = useRef(Math.round(pos.get()))
  const [centre, setCentre] = useState(Math.round(pos.get())) // slot at the top (drives the render window)
  const drag = useRef<{
    id: number
    x0: number
    y0: number
    p0: number
    moved: boolean
    /** slot of the case under the finger at pointerdown (pointer capture retargets later events) */
    hit: number | null
    samples: { t: number; x: number }[]
  } | null>(null)

  // "Settled" = visually in place, not the end of the spring's long invisible tail.
  const settlePending = useRef(false)
  const fireSettle = useCallback(
    (slot: number) => {
      if (!settlePending.current) return
      settlePending.current = false
      onSettle(toIndex(slot))
    },
    [onSettle, toIndex],
  )

  const goToSlot = useCallback(
    (slot: number, velocity = 0) => {
      const t = loop ? Math.round(slot) : clamp(Math.round(slot), 0, Math.max(0, n - 1))
      target.current = t
      settlePending.current = true
      anim.current?.stop()
      anim.current = animate(pos, t, {
        ...SPRING,
        velocity,
        onComplete: () => fireSettle(t),
      })
    },
    [loop, n, pos, fireSettle],
  )

  useImperativeHandle(
    ref,
    () => ({
      goTo: (i: number) => goToSlot(slotFor(i, pos.get())),
      jumpTo: (i: number) => {
        anim.current?.stop()
        settlePending.current = false
        const s = slotFor(i, pos.get())
        target.current = s
        pos.jump(s)
      },
      pose: (i: number) => screenPose(slotFor(i, pos.get()) - pos.get(), layout, glareX.get() * ARC.tiltDeg),
    }),
    [goToSlot, slotFor, pos, layout, glareX],
  )

  // Haptic tick + active-index update whenever a new case crosses the top.
  useMotionValueEvent(pos, 'change', (v) => {
    const r = loop ? Math.round(v) : clamp(Math.round(v), 0, Math.max(0, n - 1))
    if (r !== lastRounded.current) {
      lastRounded.current = r
      hapticTick()
      setCentre(r)
      onActiveChange(toIndex(r), r)
    }
    if (settlePending.current && !drag.current && Math.abs(v - target.current) < 0.025 && Math.abs(pos.getVelocity()) < 1.2) {
      fireSettle(target.current)
    }
  })

  // ---- pointer (touch + mouse) -------------------------------------------
  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0 || n === 0 || locked) return
    anim.current?.stop()
    settlePending.current = false
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    const el = (e.target as HTMLElement).closest<HTMLElement>('[data-slot]')
    drag.current = {
      id: e.pointerId,
      x0: e.clientX,
      y0: e.clientY,
      p0: pos.get(),
      moved: false,
      hit: el ? Number(el.dataset.slot) : null,
      samples: [{ t: e.timeStamp, x: e.clientX }],
    }
  }

  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current
    if (!d || d.id !== e.pointerId) return
    const dx = e.clientX - d.x0
    if (!d.moved && Math.abs(e.clientY - d.y0) > TAP_SLOP * 2) d.hit = null // vertical drag: not a tap
    if (!d.moved && Math.abs(dx) > TAP_SLOP) d.moved = true
    if (!d.moved) return
    let p = d.p0 - dx / layout.d1
    if (!loop) {
      if (p < 0) p = -rubber(-p)
      else if (p > n - 1) p = n - 1 + rubber(p - (n - 1))
    }
    pos.set(p)
    d.samples.push({ t: e.timeStamp, x: e.clientX })
    if (d.samples.length > 8) d.samples.shift()
  }

  const endDrag = (e: React.PointerEvent, cancelled = false) => {
    const d = drag.current
    if (!d || d.id !== e.pointerId) return
    drag.current = null

    if (!d.moved) {
      if (cancelled || d.hit === null) return goToSlot(target.current)
      // Tap: side case → bring it to the top; top case → open.
      if (d.hit === Math.round(pos.get())) {
        goToSlot(d.hit)
        onTapCentre(toIndex(d.hit))
      } else goToSlot(d.hit)
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
    const v = -vx / layout.d1 // slots per second
    goToSlot(pos.get() + v * FLICK, v)
  }

  // ---- wheel / trackpad + keyboard (laptop preview) ------------------------
  const wheelAcc = useRef(0)
  const wheelTimer = useRef<number | undefined>(undefined)
  const onWheel = (e: React.WheelEvent) => {
    if (locked) return
    const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY
    wheelAcc.current += delta
    window.clearTimeout(wheelTimer.current)
    wheelTimer.current = window.setTimeout(() => (wheelAcc.current = 0), 160)
    if (Math.abs(wheelAcc.current) > 45) {
      const step = Math.sign(wheelAcc.current)
      wheelAcc.current = 0
      goToSlot(target.current + step)
    }
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest?.('input, textarea, [role="dialog"]')) return
      if (document.querySelector('[role="dialog"]')) return
      if (e.key === 'ArrowRight') goToSlot(target.current + 1)
      else if (e.key === 'ArrowLeft') goToSlot(target.current - 1)
      else if (e.key === 'Enter' && n) onTapCentre(toIndex(target.current))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [goToSlot, onTapCentre, n, toIndex])

  // A short (non-looping) list must stay within range.
  useEffect(() => {
    if (!n || loop) return
    const p = pos.get()
    if (p < 0 || p > n - 1) {
      const i = clamp(wrap(Math.round(p), n), 0, n - 1)
      anim.current?.stop()
      target.current = i
      pos.jump(i)
    }
  }, [n, loop, pos])

  // Only mount the ~7 cases around the top of the wheel (virtualisation).
  const items = []
  for (let k = centre - layout.side; k <= centre + layout.side; k++) {
    if (!loop && (k < 0 || k >= n)) continue
    const i = wrap(k, n)
    const m = movies[i]
    items.push(
      <CarouselItem
        key={m.id}
        slot={k}
        index={i}
        movie={m}
        pos={pos}
        layout={layout}
        caseStyle={caseStyle}
        glareX={glareX}
        glareY={glareY}
        live={Math.abs(k - centre) <= 1}
        // The floor reflection only ever has opacity under |offset| < 0.625, so it can
        // only be visible on the top case and its immediate neighbours — the other
        // four copies were pure cost (a mirrored JewelCase each, always at opacity 0).
        reflect={Math.abs(k - centre) <= 1}
        sweepKey={sweep && sweep.id === m.id ? sweep.key : null}
        hidden={hiddenId === m.id}
        fresh={freshId === m.id}
        room={room}
      />,
    )
  }

  return (
    <div
      className="stage"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={(e) => endDrag(e)}
      onPointerCancel={(e) => endDrag(e, true)}
      onWheel={onWheel}
    >
      {/* Real perspective for every case (translateZ in itemTransform), vanishing point at the top case.
          The whole arc also tilts a few degrees around the wheel's centre (device tilt / mouse). */}
      <motion.div
        className="arc"
        style={{
          rotate: arcTilt,
          transformOrigin: `50% ${layout.cy + layout.R}px`,
          perspective: ARC.perspective,
          perspectiveOrigin: `50% ${layout.cy}px`,
        }}
      >
        {/* cases entering/leaving (e.g. while dragging the rating filter) scale + fade */}
        <AnimatePresence initial={false}>{items}</AnimatePresence>
      </motion.div>
    </div>
  )
}

interface ItemProps {
  slot: number
  index: number
  movie: Movie
  pos: MotionValue<number>
  layout: ShelfLayout
  caseStyle: CaseStyle
  glareX: MotionValue<number>
  glareY: MotionValue<number>
  live: boolean
  /** render the glossy floor reflection (only the centred case ever shows one) */
  reflect: boolean
  sweepKey: number | null
  hidden: boolean
  fresh: boolean
  room: MotionValue<number>
}

const CarouselItem = memo(function CarouselItem({
  slot,
  index,
  movie,
  pos,
  layout,
  caseStyle,
  glareX,
  glareY,
  live,
  reflect,
  sweepKey,
  hidden,
  fresh,
  room,
}: ItemProps) {
  // Every depth cue is a continuous function of `offset` (no steps, no thresholds).
  const offset = useTransform(pos, (p) => slot - p)
  const distance = useTransform(offset, (o) => Math.abs(o))
  const transform = useTransform([offset, room] as MotionValue<number>[], ([o, r]: number[]) => itemTransform(o, layout, r))
  // Paint order follows distance, so it swaps exactly at |progress| = 0.5, where both
  // cases are equally bright/large/shadowed. Quantised to 0.25 steps: z-index is a
  // discrete property, and writing it on every animation frame forces a layer
  // re-order each frame. Ties break by DOM order, which looks identical.
  const zIndex = useTransform(distance, (d) => 10000 - Math.round(d * 4))
  const dim = useTransform(distance, (d) => 1 - depthAt(d).brightness)
  // Depth blur, in three steps rather than continuously: animating `filter` makes
  // WebKit re-rasterise the case every frame, which is the single most expensive
  // thing in the scene. Stepped values keep the look and re-raster ~twice per pass.
  const blur = useTransform(distance, (d) => (d < 0.5 ? 'none' : d < 1.2 ? 'blur(0.7px)' : `blur(${ARC.blurAt2}px)`))
  const opacity = useTransform([distance, room] as MotionValue<number>[], ([d, r]: number[]) => depthAt(d).opacity * (d > 0.5 ? 1 - r : 1))
  // cast shadow from the nearer case: darkest on the edge that faces the centre
  const castLeft = useTransform(offset, (o) => (o > 0 ? depthAt(o).cast : 0)) // case on the right → its left edge
  const castRight = useTransform(offset, (o) => (o < 0 ? depthAt(-o).cast : 0))
  // contact shadow: strong and tight under the top case, softer/smaller further back
  const contact = useTransform(distance, (d) => 0.75 * (1 - Math.min(d, 2) * 0.3))
  const contactScale = useTransform(distance, (d) => 1 - Math.min(d, 2) * 0.12)
  // glossy floor reflection: only under the top case, fading out as it leaves the top
  const reflectOpacity = useTransform(distance, (d) => 0.25 * Math.max(0, 1 - d * 1.6))
  // Beyond the fade-out the case is invisible; hide it outright so the far slots
  // (there for a smooth entry) don't keep a filtered 3D layer alive.
  const itemVisibility = useTransform(distance, (d) => (d > 2.25 ? 'hidden' : 'visible'))

  return (
    <motion.div
      className="item"
      data-index={index}
      data-slot={slot}
      style={{
        width: layout.w,
        height: layout.h,
        top: layout.cy - layout.h / 2,
        marginLeft: -layout.w / 2,
        transform,
        zIndex,
        opacity,
        visibility: hidden ? 'hidden' : itemVisibility,
      }}
    >
      <motion.div
        className="item__drop"
        initial={fresh ? { opacity: 0, y: -70, scale: 1.12 } : { opacity: 0, scale: 0.86 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, scale: 0.86, transition: { type: 'spring', stiffness: 500, damping: 40 } }}
        transition={fresh ? { type: 'spring', stiffness: 220, damping: 22, delay: 0.25 } : { type: 'spring', stiffness: 420, damping: 34 }}
      >
        <motion.div className="item__shadow" style={{ opacity: contact, scale: contactScale }} />
        <motion.div className="item__press" style={{ filter: blur }}>
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
          <motion.div className="item__cast item__cast--left" style={{ opacity: castLeft }} />
          <motion.div className="item__cast item__cast--right" style={{ opacity: castRight }} />
        </motion.div>
        {reflect && (
          <motion.div className="item__reflect" style={{ opacity: reflectOpacity }} aria-hidden>
            <div className="item__reflect-flip">
              <JewelCase movie={movie} style={caseStyle} />
            </div>
          </motion.div>
        )}
      </motion.div>
    </motion.div>
  )
})
