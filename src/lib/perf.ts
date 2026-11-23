import { useEffect, useState } from 'react'
import type { MotionValue } from 'framer-motion'

/**
 * Adaptive "lite" mode.
 *
 * The full look is expensive: an animated blur on every case, a full-screen
 * blend-mode colour grade, the grain and Ken Burns loops, and a second copy of
 * each case for the floor reflection. On a desktop browser that's nothing; in a
 * sideloaded WebView (LiveContainer / no JIT / memory pressure) it can drop the
 * carousel to ~20fps.
 *
 * So instead of degrading the look for everyone, sample real frame pacing while
 * the wheel is actually moving, and only then drop the expensive decoration.
 * A capable device never sees a difference.
 */

const KEY = 'shelf.perfLite'

/** ~38fps. Below this the spring visibly stutters. */
const SLOW_MS = 26
/** Frames to judge by (≈0.8s of movement at 60fps). */
const WINDOW = 50
/** Keep sampling this long after the last movement, so a flick is fully measured. */
const TAIL_MS = 1400

function readLite(): boolean {
  try {
    return sessionStorage.getItem(KEY) === '1'
  } catch {
    return false
  }
}

export function useAutoPerf(pos: MotionValue<number>): boolean {
  const [lite, setLite] = useState(readLite)

  useEffect(() => {
    if (lite) return

    let raf = 0
    let last = 0
    let movingUntil = 0
    let samples: number[] = []

    const sample = (t: number) => {
      if (t > movingUntil) {
        raf = 0
        last = 0
        samples = []
        return
      }
      if (last) {
        const dt = t - last
        if (dt > 0 && dt < 200) samples.push(dt) // ignore tab-switch gaps
      }
      last = t

      if (samples.length >= WINDOW) {
        const sorted = samples.slice().sort((a, b) => a - b)
        const median = sorted[sorted.length >> 1]
        samples = []
        if (median > SLOW_MS) {
          try {
            sessionStorage.setItem(KEY, '1')
          } catch {
            /* private mode */
          }
          setLite(true)
          return
        }
      }
      raf = requestAnimationFrame(sample)
    }

    const unsubscribe = pos.on('change', () => {
      movingUntil = performance.now() + TAIL_MS
      if (!raf) {
        last = 0
        raf = requestAnimationFrame(sample)
      }
    })

    return () => {
      unsubscribe()
      if (raf) cancelAnimationFrame(raf)
    }
  }, [pos, lite])

  return lite
}
