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

const SAFE_KEY = 'shelf.safeMode'
const ALIVE_KEY = 'shelf.alive'
const CRASHES_KEY = 'shelf.crashes'

const MANUAL_KEY = 'shelf.liteManual' // 'on' | 'off': the user's explicit choice wins
const EVENT = 'shelf:perf'

function readLite(): boolean {
  try {
    const manual = localStorage.getItem(MANUAL_KEY)
    if (manual === 'on') return true
    if (manual === 'off') return false
    return sessionStorage.getItem(KEY) === '1' || localStorage.getItem(SAFE_KEY) === '1'
  } catch {
    return false
  }
}

/** Current lite-mode state (Settings switch). */
export function isLiteMode(): boolean {
  return readLite()
}

/** The Settings switch: applies immediately (no reload) and sticks, overriding auto-detection. */
export function setLiteMode(on: boolean) {
  try {
    localStorage.setItem(MANUAL_KEY, on ? 'on' : 'off')
    if (!on) {
      localStorage.removeItem(SAFE_KEY)
      sessionStorage.removeItem(KEY)
    }
  } catch {
    /* ignore */
  }
  window.dispatchEvent(new Event(EVENT))
}

function manualChoice(): boolean {
  try {
    return localStorage.getItem(MANUAL_KEY) !== null
  } catch {
    return false
  }
}

/**
 * Crash-loop guard. iOS kills the WebView's content process when it runs out of
 * memory; the app then reloads from scratch (black screen → back to the start).
 * While visible we write a heartbeat; a clean exit (backgrounding/closing) clears it.
 * If the next launch still finds a fresh heartbeat, the last session was killed, so
 * switch to lite mode *persistently* (sessionStorage doesn't survive that reload).
 * Call once, before the first render.
 */
export function guardAgainstCrashes() {
  try {
    const last = Number(localStorage.getItem(ALIVE_KEY) || 0)
    if (last && Date.now() - last < 20_000) {
      localStorage.setItem(SAFE_KEY, '1')
      localStorage.removeItem(MANUAL_KEY) // a crash overrides an earlier "off"
      localStorage.setItem(CRASHES_KEY, String(Number(localStorage.getItem(CRASHES_KEY) || 0) + 1))
    }
    const beat = () => {
      if (document.visibilityState === 'visible') localStorage.setItem(ALIVE_KEY, String(Date.now()))
    }
    const clear = () => localStorage.removeItem(ALIVE_KEY)
    beat()
    setInterval(beat, 3000)
    document.addEventListener('visibilitychange', () => (document.visibilityState === 'hidden' ? clear() : beat()))
    window.addEventListener('pagehide', clear)
  } catch {
    /* storage unavailable */
  }
}

/** How many times the WebView has been killed (for Settings / debugging). */
export function crashCount(): number {
  try {
    return Number(localStorage.getItem(CRASHES_KEY) || 0)
  } catch {
    return 0
  }
}

/** Leave lite mode (Settings). */
export function resetSafeMode() {
  try {
    localStorage.removeItem(SAFE_KEY)
    localStorage.removeItem(CRASHES_KEY)
    sessionStorage.removeItem(KEY)
  } catch {
    /* ignore */
  }
}

export function useAutoPerf(pos: MotionValue<number>): boolean {
  const [lite, setLite] = useState(readLite)

  // the Settings switch
  useEffect(() => {
    const on = () => setLite(readLite())
    window.addEventListener(EVENT, on)
    return () => window.removeEventListener(EVENT, on)
  }, [])

  useEffect(() => {
    if (lite || manualChoice()) return // never auto-switch against the user's choice

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
