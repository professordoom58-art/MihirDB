import type { MotionValue } from 'framer-motion'

/**
 * Tilt-driven glare. iOS needs DeviceOrientationEvent.requestPermission() from a
 * tap, so Settings has an "Enable tilt glare" button; we never ask on load.
 */
const LS = 'shelf.tilt'

type DOE = typeof DeviceOrientationEvent & { requestPermission?: () => Promise<'granted' | 'denied'> }

export const tiltSupported = typeof window !== 'undefined' && 'DeviceOrientationEvent' in window
export const tiltNeedsPermission = tiltSupported && typeof (DeviceOrientationEvent as DOE).requestPermission === 'function'

export function tiltWanted(): boolean {
  try {
    return localStorage.getItem(LS) === 'on'
  } catch {
    return false
  }
}

export async function enableTilt(): Promise<boolean> {
  if (!tiltSupported) return false
  try {
    const req = (DeviceOrientationEvent as DOE).requestPermission
    if (req && (await req()) !== 'granted') return false
    localStorage.setItem(LS, 'on')
    window.dispatchEvent(new Event('shelf:tilt'))
    return true
  } catch {
    return false
  }
}

export function disableTilt() {
  try {
    localStorage.removeItem(LS)
  } catch {
    /* ignore */
  }
  window.dispatchEvent(new Event('shelf:tilt'))
}

/** Feeds the glare motion values from the gyroscope. Returns a cleanup fn. */
export function startTilt(gx: MotionValue<number>, gy: MotionValue<number>, onData?: () => void): () => void {
  let baseBeta: number | null = null
  const clamp = (v: number) => Math.max(-1, Math.min(1, v))
  const on = (e: DeviceOrientationEvent) => {
    if (e.beta == null || e.gamma == null) return
    onData?.()
    if (baseBeta === null) baseBeta = e.beta // however you naturally hold the phone = neutral
    baseBeta += (e.beta - baseBeta) * 0.004 // slowly re-centre
    const x = clamp(e.gamma / 25)
    const y = clamp((e.beta - baseBeta) / 20)
    // light low-pass so it glides instead of jittering
    gx.set(gx.get() + (x - gx.get()) * 0.25)
    gy.set(gy.get() + (y - 0.3 - gy.get()) * 0.25)
  }
  window.addEventListener('deviceorientation', on)
  return () => window.removeEventListener('deviceorientation', on)
}
