/**
 * Every spring / timing used by the detail transition, in one place to tune.
 * Springs only (no linear/eased durations), except the reduced-motion crossfade.
 */
export const SPRING = {
  /** the case flying between the arc and the detail view; ~350ms with a hint of overshoot */
  main: { type: 'spring', stiffness: 380, damping: 32, mass: 0.9 },
  /** detail rows sliding/fading in */
  content: { type: 'spring', stiffness: 500, damping: 40 },
  /** detail rows fading out on close (~120ms, no stagger) */
  contentOut: { type: 'spring', stiffness: 900, damping: 60 },
  /** rating number counting up (≈300ms) */
  count: { type: 'spring', stiffness: 260, damping: 36 },
  /** card snapping back after a drag that didn't dismiss */
  snapBack: { type: 'spring', stiffness: 420, damping: 34 },
} as const

export const CHOREO = {
  /** detail content starts this long after the case starts flying (s) */
  contentDelay: 0.08,
  /** per-row stagger (s) */
  stagger: 0.03,
  /** rows rise this far (px) */
  rise: 12,
  /** neighbours slide outward by this fraction of the screen width when the detail opens */
  roomPush: 0.45,
  /** extra background dim while open (opacity of a black overlay) */
  bgDim: 0.35,
}

export const DISMISS = {
  /** release past this distance (px) … */
  distance: 120,
  /** … or faster than this (px/s) closes */
  velocity: 500,
  /** card scale at full drag */
  minScale: 0.9,
  /** drag distance (px) for full scale-down / max corner radius */
  range: 360,
  maxRadius: 30,
}

/** prefers-reduced-motion: everything becomes a quick crossfade */
export const REDUCED = { duration: 0.15 }
