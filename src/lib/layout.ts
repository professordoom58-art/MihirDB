import type { CaseStyle } from '../types'
import { CHOREO } from './motion'

/**
 * Arc carousel tuning. Every case's transform is derived from one number, its offset
 * from the top of the wheel in items (index − activeFloat), so motion is continuous
 * mid-swipe, not just at the snaps.
 */
export const ARC = {
  /** wheel radius, × screen height. The wheel's centre sits this far below the centred case. */
  radius: 0.78,
  /** neighbour spacing (× case width) at the top of the wheel; widens the wheel if needed.
   *  Tuned so a resting neighbour's projected box overlaps the centre case by ~12% of its
   *  width (scale + rotateY shrink it, so the layout gap is larger than the visual overlap). */
  minSpacing: 0.825,
  /** angle between neighbouring cases on the wheel (also their rotateZ per step) */
  stepDeg: 12,
  /** scale at 0, 1, 2, 3… steps from the top (interpolated in between) */
  scales: [1, 0.78, 0.62, 0.52, 0.44],
  /** brightness at 0, 1, 2, 3 steps (rendered as a black overlay: 1 − brightness) */
  brightness: [1, 0.45, 0.3, 0.25],
  /** blur in px at 2 steps (linear from 0 at the centre) */
  blurAt2: 1.5,
  /** rotateY away from the viewer: degrees at 1 step, and at 2+ steps */
  rotateY1: 35,
  rotateY2: 40,
  /** pushed back along Z per step (px); the arc container's perspective does the foreshortening */
  depthPerStep: 80,
  perspective: 1000,
  /** opacity of the shadow a nearer case casts on the inner edge of the one behind (at 1+ step) */
  castShadow: 0.7,
  /** neighbours fade out between these distances (so none get chopped at the screen edge) */
  fadeStart: 1.8,
  fadeEnd: 2.2,
  /** centred case width, × screen width (capped by height) */
  caseWidth: 0.65,
  /** max whole-arc rotation from device tilt / mouse, degrees */
  tiltDeg: 3,
}

/** piecewise-linear lookup in a stops array indexed by step distance */
export function stopsAt(stops: number[], a: number) {
  const i = Math.min(Math.floor(a), stops.length - 2)
  const t = Math.min(1, a - i)
  return stops[i] + (stops[i + 1] - stops[i]) * t
}

/** Everything about a case's depth, from its distance to the centre (continuous, no thresholds). */
export function depthAt(d: number) {
  return {
    brightness: stopsAt(ARC.brightness, d),
    blur: (Math.min(d, 2) / 2) * ARC.blurAt2,
    cast: Math.min(d, 1) * ARC.castShadow,
    opacity: Math.min(1, Math.max(0, (ARC.fadeEnd - d) / (ARC.fadeEnd - ARC.fadeStart))),
  }
}

/** n items arranged in a loop: index of slot k */
export const wrap = (k: number, n: number) => ((k % n) + n) % n

export interface ShelfLayout {
  vw: number
  vh: number
  /** centred case size in px */
  w: number
  h: number
  /** vertical centre of the centred case */
  cy: number
  /** wheel radius in px (centre at cy + R) */
  R: number
  /** px of horizontal travel for one step at the top of the wheel; maps drag to angle */
  d1: number
  /** how many neighbours to keep mounted on each side (virtualisation) */
  side: number
}

export function computeLayout(vw: number, vh: number, style: CaseStyle): ShelfLayout {
  const aspect = style === 'cd' ? 1 : 1.5 // height / width
  let w = vw * ARC.caseWidth
  const maxH = vh * (style === 'cd' ? 0.42 : 0.5)
  if (w * aspect > maxH) w = maxH / aspect
  w = Math.min(w, 420)
  const h = w * aspect
  const sinStep = Math.sin((ARC.stepDeg * Math.PI) / 180)
  const R = Math.max(ARC.radius * vh, (ARC.minSpacing * w) / sinStep)
  const d1 = R * sinStep
  return { vw, vh, w, h, cy: vh * 0.42, R, d1, side: 3 }
}


/** Position on the wheel for an offset of `o` steps from the top (relative to the top slot). */
export function arcPose(o: number, L: ShelfLayout) {
  const theta = (o * ARC.stepDeg * Math.PI) / 180
  return {
    x: L.R * Math.sin(theta),
    y: L.R * (1 - Math.cos(theta)),
    rotate: o * ARC.stepDeg, // follow the curve
    scale: stopsAt(ARC.scales, Math.abs(o)),
  }
}

/**
 * CSS transform for a case `o` steps from the top. `room` (0..1) pushes neighbours
 * outward while the detail view is open ("making room" for the lifted case).
 */
export function itemTransform(o: number, L: ShelfLayout, room = 0): string {
  const a = Math.abs(o)
  const sign = Math.sign(o)
  const p = arcPose(o, L)
  const push = a > 0.5 ? sign * room * L.vw * CHOREO.roomPush : 0
  // rotated away (inner edge recedes) and pushed back in Z; perspective lives on the arc container
  const rotY = -sign * (Math.min(a, 1) * ARC.rotateY1 + Math.max(0, Math.min(a, 2) - 1) * (ARC.rotateY2 - ARC.rotateY1))
  const z = -a * ARC.depthPerStep
  return `translate3d(${(p.x + push).toFixed(2)}px,${p.y.toFixed(2)}px,${z.toFixed(2)}px) rotate(${p.rotate.toFixed(3)}deg) rotateY(${rotY.toFixed(2)}deg) scale(${p.scale.toFixed(4)})`
}

/**
 * Where a case is on screen right now: centre, width, rotation. Includes the whole-arc
 * tilt (which rotates around the wheel's centre). Used to fly the case to and from the
 * detail view without measuring rotated DOM boxes.
 */
export function screenPose(o: number, L: ShelfLayout, tiltDeg: number) {
  const p = arcPose(o, L)
  // case centre relative to the wheel centre, then rotated by the arc tilt
  const t = (tiltDeg * Math.PI) / 180
  const rx = p.x
  const ry = p.y - L.R
  const x = rx * Math.cos(t) - ry * Math.sin(t)
  const y = rx * Math.sin(t) + ry * Math.cos(t)
  return { cx: L.vw / 2 + x, cy: L.cy + L.R + y, w: L.w * p.scale, rotate: p.rotate + tiltDeg }
}

export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
