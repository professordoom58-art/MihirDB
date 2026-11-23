import type { CaseStyle } from '../types'

export interface ShelfLayout {
  vw: number
  vh: number
  /** centred case size in px */
  w: number
  h: number
  /** vertical centre of the carousel */
  cy: number
  /** distance from centre to first neighbour, and between further neighbours */
  d1: number
  d2: number
  /** how many neighbours to keep mounted on each side */
  side: number
}

export function computeLayout(vw: number, vh: number, style: CaseStyle): ShelfLayout {
  const aspect = style === 'cd' ? 1 : 1.5 // height / width
  let w = vw * 0.68
  const maxH = vh * (style === 'cd' ? 0.44 : 0.52)
  if (w * aspect > maxH) w = maxH / aspect
  w = Math.min(w, 440)
  const h = w * aspect

  const d1 = w * 0.6
  // On a phone this keeps ~1.5 neighbours per side; on a wide laptop window
  // neighbours spread out to fill the width instead of bunching in the middle.
  const room = vw / 2 - d1 - w * 0.25
  const d2 = Math.max(w * 0.2, Math.min(w * 0.42, room / 3))
  const side = Math.max(2, Math.min(7, Math.ceil(room / d2) + 1))

  return { vw, vh, w, h, cy: vh * 0.43, d1, d2, side }
}

/** Every per-item visual derives from one number: its offset from the centre (in items). */
export function itemTransform(o: number, L: ShelfLayout): string {
  const a = Math.abs(o)
  const s = Math.sign(o)
  const a1 = Math.min(a, 1)
  const far = Math.max(0, a - 1)
  const x = s * (a1 * L.d1 + far * L.d2)
  const scale = 1 - a1 * 0.26 - Math.min(far, 4) * 0.05
  const rot = -s * a1 * 32
  return `translate3d(${x.toFixed(2)}px,0,0) perspective(${Math.round(L.w * 2.6)}px) rotateY(${rot.toFixed(2)}deg) scale(${scale.toFixed(4)})`
}

export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
