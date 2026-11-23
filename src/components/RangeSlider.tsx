import { useRef, useState } from 'react'
import { hapticTick } from '../lib/haptics'
import { shortRating } from '../lib/sort'

type Value = number | [number, number]

interface Props<V extends Value> {
  /** a number = single thumb (my rating); a pair = range (filter) */
  value: V
  onChange: (v: V) => void
  min?: number
  max?: number
  step?: number
  /** accessible name; dual sliders get "minimum"/"maximum" appended */
  label: string
  /** value bubble above the thumb while dragging */
  bubble?: boolean
  onDragging?: (dragging: boolean) => void
}

/**
 * The app's one rating control. Custom-built (no native <input type=range>):
 * thin track, accent fill, round thumbs with a 28px touch target, live bubble while
 * dragging, haptic tick per step, touch + mouse + keyboard.
 */
export function RangeSlider<V extends Value>({
  value,
  onChange,
  min = 1,
  max = 10,
  step = 0.5,
  label,
  bubble = true,
  onDragging,
}: Props<V>) {
  const dual = Array.isArray(value)
  const [lo, hi] = dual ? (value as [number, number]) : [min, value as number]
  const track = useRef<HTMLDivElement>(null)
  const [active, setActive] = useState<0 | 1 | null>(null) // which thumb is being dragged
  const pending = useRef<{ x: number } | null>(null) // both thumbs on the same spot: pick by first move
  const last = useRef<number[]>([lo, hi])
  last.current = [lo, hi]

  const pct = (v: number) => ((v - min) / (max - min)) * 100
  const snap = (v: number) => Math.min(max, Math.max(min, Math.round((v - min) / step) * step + min))
  const fromX = (clientX: number) => {
    const r = track.current!.getBoundingClientRect()
    return snap(min + ((clientX - r.left) / r.width) * (max - min))
  }

  const commit = (thumb: 0 | 1, v: number) => {
    const [a, b] = last.current
    let next: [number, number] = thumb === 0 ? [Math.min(v, b), b] : [a, Math.max(v, a)] // thumbs never cross
    if (!dual) next = [min, v]
    if (next[0] === a && next[1] === b) return
    hapticTick()
    last.current = next
    onChange((dual ? next : next[1]) as V)
  }

  const setDragging = (t: 0 | 1 | null) => {
    setActive(t)
    onDragging?.(t !== null)
  }

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    const v = fromX(e.clientX)
    if (!dual) {
      setDragging(1)
      commit(1, v)
      return
    }
    if (lo === hi) {
      // stacked thumbs: decide by the direction of the first move (or the side of the tap)
      if (v < lo) (setDragging(0), commit(0, v))
      else if (v > hi) (setDragging(1), commit(1, v))
      else pending.current = { x: e.clientX }
      return
    }
    // nearest thumb; on a tie, the side you tapped on
    const dLo = Math.abs(v - lo)
    const dHi = Math.abs(v - hi)
    const t: 0 | 1 = dLo < dHi ? 0 : dHi < dLo ? 1 : v <= lo ? 0 : 1
    setDragging(t)
    commit(t, v)
  }

  const onPointerMove = (e: React.PointerEvent) => {
    if (pending.current) {
      const dx = e.clientX - pending.current.x
      if (Math.abs(dx) < 3) return
      pending.current = null
      setDragging(dx < 0 ? 0 : 1)
      commit(dx < 0 ? 0 : 1, fromX(e.clientX))
      return
    }
    if (active === null) return
    commit(active, fromX(e.clientX))
  }

  const onPointerUp = () => {
    pending.current = null
    if (active !== null) setDragging(null)
  }

  const onKey = (thumb: 0 | 1) => (e: React.KeyboardEvent) => {
    const cur = thumb === 0 ? lo : hi
    const map: Record<string, number> = {
      ArrowRight: cur + step,
      ArrowUp: cur + step,
      ArrowLeft: cur - step,
      ArrowDown: cur - step,
      PageUp: cur + 1,
      PageDown: cur - 1,
      Home: min,
      End: max,
    }
    if (!(e.key in map)) return
    e.preventDefault()
    e.stopPropagation()
    commit(thumb, snap(map[e.key]))
  }

  const thumbs: (0 | 1)[] = dual ? [0, 1] : [1]
  return (
    <div className="rs" data-noswipe>
      <div
        ref={track}
        className="rs__track"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <div className="rs__rail" />
        <div className="rs__fill" style={{ left: `${pct(lo)}%`, width: `${pct(hi) - pct(lo)}%` }} />
        {thumbs.map((t) => {
          const v = t === 0 ? lo : hi
          return (
            <div
              key={t}
              role="slider"
              tabIndex={0}
              aria-label={dual ? `${label} ${t === 0 ? 'minimum' : 'maximum'}` : label}
              aria-valuemin={dual && t === 1 ? lo : min}
              aria-valuemax={dual && t === 0 ? hi : max}
              aria-valuenow={v}
              aria-valuetext={shortRating(v)}
              className={`rs__thumb${active === t ? ' is-active' : ''}`}
              // the later-moved thumb sits on top so stacked thumbs stay grabbable
              style={{ left: `${pct(v)}%`, zIndex: active === t ? 3 : t === 0 && lo === max ? 2 : 1 }}
              onKeyDown={onKey(t)}
            >
              <span className="rs__knob" />
              {bubble && active === t && <span className="rs__bubble">{shortRating(v)}</span>}
            </div>
          )
        })}
      </div>
    </div>
  )
}
