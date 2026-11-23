/**
 * Poster palette: 3 colours used to grade the background.
 *   dark  – deepest prominent colour (floor / bottom of the wash)
 *   vivid – most colourful prominent colour (glow, spotlight, rating tint)
 *   light – brightest prominent colour (highlights)
 *
 * Pure function over RGB(A) pixels so the seed script (Node + sharp) and the app
 * (canvas) produce identical results. No imports on purpose.
 */
export interface Palette {
  dark: string
  vivid: string
  light: string
}

export const DEFAULT_PALETTE: Palette = { dark: '#0b0b10', vivid: '#c9a46a', light: '#e8e4dc' }

type RGB = [number, number, number]

const hex = ([r, g, b]: RGB) =>
  '#' + [r, g, b].map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('')

export function hexToRgb(h: string): RGB {
  const n = parseInt(h.replace('#', ''), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

function hsl([r, g, b]: RGB): [number, number, number] {
  r /= 255
  g /= 255
  b /= 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  const d = max - min
  if (!d) return [0, 0, l]
  const s = d / (1 - Math.abs(2 * l - 1))
  let h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4
  h *= 60
  if (h < 0) h += 360
  return [h, s, l]
}

function fromHsl(h: number, s: number, l: number): RGB {
  const c = (1 - Math.abs(2 * l - 1)) * s
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = l - c / 2
  const [r, g, b] =
    h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x]
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255]
}

/** Quantise into a 4×4×4 RGB grid, then pick dark / vivid / light from the populated buckets. */
export function paletteFromPixels(data: ArrayLike<number>, channels = 4): Palette {
  const buckets = new Map<number, { n: number; r: number; g: number; b: number }>()
  for (let i = 0; i + 2 < data.length; i += channels) {
    const r = data[i]
    const g = data[i + 1]
    const b = data[i + 2]
    const key = ((r >> 6) << 4) | ((g >> 6) << 2) | (b >> 6)
    const e = buckets.get(key) ?? { n: 0, r: 0, g: 0, b: 0 }
    e.n++
    e.r += r
    e.g += g
    e.b += b
    buckets.set(key, e)
  }
  const total = data.length / channels
  const colours = [...buckets.values()]
    .map((e) => ({ rgb: [e.r / e.n, e.g / e.n, e.b / e.n] as RGB, share: e.n / total }))
    .filter((c) => c.share > 0.012)
  if (!colours.length) return DEFAULT_PALETTE

  const withHsl = colours.map((c) => ({ ...c, hsl: hsl(c.rgb) }))
  const dark = withHsl.reduce((a, b) => (b.hsl[2] * 1.0 - b.share * 0.3 < a.hsl[2] - a.share * 0.3 ? b : a))
  const vivid = withHsl.reduce((a, b) => {
    // saturation counts far more than area, so a small vivid patch (a fiery logo) beats a large muted field
    const score = (c: (typeof withHsl)[0]) => c.hsl[1] ** 2 * Math.max(0, 1 - Math.abs(c.hsl[2] - 0.5) * 1.3) * c.share ** 0.25
    return score(b) > score(a) ? b : a
  })
  const light = withHsl.reduce((a, b) => (b.hsl[2] + b.share * 0.2 > a.hsl[2] + a.share * 0.2 ? b : a))

  // Keep the dark colour genuinely dark and the vivid one usable as light/glow.
  const [dh, ds, dl] = dark.hsl
  const [vh, vs, vl] = vivid.hsl
  const darkRgb = fromHsl(dh, Math.min(ds, 0.6), Math.min(dl, 0.12))
  const vividRgb = vs < 0.12 ? fromHsl(vh, vs, Math.max(0.55, Math.min(vl, 0.8))) : fromHsl(vh, Math.min(0.9, Math.max(vs, 0.45)), Math.max(0.45, Math.min(vl, 0.65)))
  return { dark: hex(darkRgb), vivid: hex(vividRgb), light: hex(light.rgb) }
}

// ------------------------------------------------------------------ contrast

function luminance([r, g, b]: RGB) {
  const f = (v: number) => {
    v /= 255
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
}

export function contrast(a: string, b: string) {
  const la = luminance(hexToRgb(a))
  const lb = luminance(hexToRgb(b))
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

/** The vivid colour, lightened just enough to reach `min` contrast against `bg`. */
export function readableTint(vivid: string, bg: string, min = 4.5): string {
  const [h, s, l] = hsl(hexToRgb(vivid))
  for (let L = Math.max(l, 0.5); L <= 0.97; L += 0.02) {
    const c = hex(fromHsl(h, Math.min(s, 0.85), L))
    if (contrast(c, bg) >= min) return c
  }
  return '#f2f2f2'
}

/** rgba() string from a hex colour. */
export function alpha(h: string, a: number) {
  const [r, g, b] = hexToRgb(h)
  return `rgba(${r}, ${g}, ${b}, ${a})`
}
