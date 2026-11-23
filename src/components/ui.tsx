import { useEffect, useLayoutEffect, useRef, type ReactNode, type RefObject } from 'react'
import { AnimatePresence, animate, motion, useMotionValue, type MotionValue } from 'framer-motion'
import { formatRating } from '../lib/sort'
import { hapticTick } from '../lib/haptics'

/**
 * Swipe down to dismiss. Only takes over when the scroller is at the top and the
 * gesture is clearly downward, so normal scrolling keeps working. Touch events are
 * used (not pointer events) because only they can cancel iOS scrolling.
 */
export function useSwipeDown(
  panelRef: RefObject<HTMLElement | null>,
  scrollerRef: RefObject<HTMLElement | null>,
  y: MotionValue<number>,
  onDismiss: () => void,
  enabled = true,
) {
  const dismiss = useRef(onDismiss)
  dismiss.current = onDismiss
  useEffect(() => {
    const el = panelRef.current
    if (!el || !enabled) return
    let x0 = 0
    let y0 = 0
    let decided = false
    let active = false
    let lastY = 0
    let lastT = 0
    let v = 0
    const start = (e: TouchEvent) => {
      const t = e.touches[0]
      x0 = t.clientX
      y0 = lastY = t.clientY
      lastT = e.timeStamp
      decided = active = false
      v = 0
    }
    const move = (e: TouchEvent) => {
      const t = e.touches[0]
      const dx = t.clientX - x0
      const dy = t.clientY - y0
      if (!decided) {
        if (Math.abs(dx) < 6 && Math.abs(dy) < 6) return
        decided = true
        const sc = scrollerRef.current
        const atTop = !sc || sc.scrollTop <= 0
        const blocked = (e.target as HTMLElement).closest('[data-noswipe]')
        active = !blocked && atTop && dy > 0 && Math.abs(dy) > Math.abs(dx)
      }
      if (!active) return
      e.preventDefault()
      v = (t.clientY - lastY) / Math.max(1, e.timeStamp - lastT)
      lastY = t.clientY
      lastT = e.timeStamp
      y.set(Math.max(0, dy))
    }
    const end = () => {
      if (!active) return
      active = false
      if (y.get() > 120 || v > 0.55) dismiss.current()
      else animate(y, 0, { type: 'spring', stiffness: 420, damping: 38 })
    }
    el.addEventListener('touchstart', start, { passive: true })
    el.addEventListener('touchmove', move, { passive: false })
    el.addEventListener('touchend', end)
    el.addEventListener('touchcancel', end)
    return () => {
      el.removeEventListener('touchstart', start)
      el.removeEventListener('touchmove', move)
      el.removeEventListener('touchend', end)
      el.removeEventListener('touchcancel', end)
    }
  }, [panelRef, scrollerRef, y, enabled])
}

export function useEscape(onEscape: () => void, active = true) {
  const cb = useRef(onEscape)
  cb.current = onEscape
  useEffect(() => {
    if (!active) return
    const on = (e: KeyboardEvent) => e.key === 'Escape' && cb.current()
    window.addEventListener('keydown', on)
    return () => window.removeEventListener('keydown', on)
  }, [active])
}

// ------------------------------------------------------------------ Sheet

interface SheetProps {
  open: boolean
  onClose: () => void
  children: ReactNode
  title?: ReactNode
  /** right side of the header (e.g. a Save button) */
  action?: ReactNode
  tall?: boolean
  z?: number
  label: string
}

export function Sheet(props: SheetProps) {
  return <AnimatePresence>{props.open && <SheetInner {...props} />}</AnimatePresence>
}

function SheetInner({ onClose, children, title, action, tall = true, z = 20, label }: SheetProps) {
  const panel = useRef<HTMLDivElement>(null)
  const body = useRef<HTMLDivElement>(null)
  const y = useMotionValue(0)
  useSwipeDown(panel, body, y, onClose)
  useEscape(onClose)
  return (
    <>
      <motion.div
        className="sheet-scrim"
        style={{ zIndex: z }}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
      />
      <motion.div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        className={`sheet${tall ? ' sheet--tall' : ''}`}
        style={{ y, zIndex: z + 1 }}
        initial={{ y: '100%' }}
        animate={{ y: 0 }}
        exit={{ y: '100%' }}
        transition={{ type: 'spring', stiffness: 380, damping: 40, mass: 0.9 }}
      >
        <div className="sheet__grab" aria-hidden />
        <div className="sheet__head">
          <button className="textbtn" onClick={onClose}>
            Close
          </button>
          <div className="sheet__title">{title}</div>
          <div className="sheet__action">{action}</div>
        </div>
        <div ref={body} className="sheet__body">
          {children}
        </div>
      </motion.div>
    </>
  )
}

// ------------------------------------------------------------------ Rating slider

const STEPS = 18 // 1..10 in 0.5 steps

export function RatingSlider({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const track = useRef<HTMLDivElement>(null)
  const last = useRef(value)
  const set = (v: number) => {
    const c = Math.min(10, Math.max(1, Math.round(v * 2) / 2))
    if (c !== last.current) {
      last.current = c
      hapticTick()
      onChange(c)
    }
  }
  const fromX = (clientX: number) => {
    const r = track.current!.getBoundingClientRect()
    const t = Math.min(1, Math.max(0, (clientX - r.left) / r.width))
    set(1 + Math.round(t * STEPS) / 2)
  }
  useEffect(() => {
    last.current = value
  }, [value])
  const pct = ((value - 1) / 9) * 100
  return (
    <div className="rating" data-noswipe>
      <div className="rating__value" aria-hidden>
        {formatRating(value)}
        <span>/10</span>
      </div>
      <div
        ref={track}
        className="rating__track"
        role="slider"
        tabIndex={0}
        aria-label="My rating"
        aria-valuemin={1}
        aria-valuemax={10}
        aria-valuenow={value}
        aria-valuetext={formatRating(value)}
        onPointerDown={(e) => {
          ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
          fromX(e.clientX)
        }}
        onPointerMove={(e) => e.buttons && fromX(e.clientX)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowRight' || e.key === 'ArrowUp') (e.preventDefault(), set(value + 0.5))
          if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') (e.preventDefault(), set(value - 0.5))
        }}
      >
        <div className="rating__rail">
          <div className="rating__fill" style={{ width: `${pct}%` }} />
          {Array.from({ length: 10 }, (_, i) => (
            <div key={i} className="rating__tick" style={{ left: `${(i / 9) * 100}%` }} />
          ))}
        </div>
        <div className="rating__thumb" style={{ left: `${pct}%` }} />
      </div>
      <div className="rating__labels" aria-hidden>
        <span>1</span>
        <span>5</span>
        <span>10</span>
      </div>
    </div>
  )
}

// ------------------------------------------------------------------ Auto-growing textarea

export function AutoTextarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const ref = useRef<HTMLTextAreaElement>(null)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight + 2}px`
  }, [props.value])
  return <textarea ref={ref} rows={3} {...props} />
}

// ------------------------------------------------------------------ Confirm dialog

export function Confirm({
  open,
  title,
  body,
  confirmLabel,
  danger,
  onConfirm,
  onCancel,
}: {
  open: boolean
  title: string
  body?: string
  confirmLabel: string
  danger?: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  useEscape(onCancel, open)
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="confirm"
          role="alertdialog"
          aria-modal="true"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onCancel}
        >
          <motion.div
            className="confirm__card"
            initial={{ scale: 0.92, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.96, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 500, damping: 32 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="confirm__title">{title}</div>
            {body && <div className="confirm__body">{body}</div>}
            <div className="confirm__actions">
              <button className="btn" onClick={onCancel}>
                Cancel
              </button>
              <button className={`btn ${danger ? 'btn--danger' : 'btn--primary'}`} onClick={onConfirm}>
                {confirmLabel}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

export function Spinner({ size = 18 }: { size?: number }) {
  return <span className="spinner" style={{ width: size, height: size }} aria-label="Loading" />
}
