/**
 * Pulls one accent colour from a poster: a saturation-weighted average of a tiny
 * downsample, then normalised so it always reads well on near-black.
 */
const cache = new Map<string, Promise<string>>()
const FALLBACK = 'hsl(36 60% 70%)'

/** Pass a blob: URL or a CORS-enabled URL (see corsUrl in tmdb.ts). */
export function getAccent(src: string): Promise<string> {
  let p = cache.get(src)
  if (!p) {
    p = extract(src).catch(() => FALLBACK)
    cache.set(src, p)
  }
  return p
}

function extract(src: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    if (!src.startsWith('blob:')) img.crossOrigin = 'anonymous'
    img.decoding = 'async'
    img.onload = () => {
      try {
        const w = 16
        const h = 24
        const c = document.createElement('canvas')
        c.width = w
        c.height = h
        const ctx = c.getContext('2d', { willReadFrequently: true })
        if (!ctx) return reject(new Error('no ctx'))
        ctx.drawImage(img, 0, 0, w, h)
        const d = ctx.getImageData(0, 0, w, h).data
        let r = 0, g = 0, b = 0, wt = 0
        for (let i = 0; i < d.length; i += 4) {
          const R = d[i] / 255, G = d[i + 1] / 255, B = d[i + 2] / 255
          const max = Math.max(R, G, B), min = Math.min(R, G, B)
          const sat = max === 0 ? 0 : (max - min) / max
          // favour colourful, mid-bright pixels; ignore near-black / near-white
          const lumW = max < 0.12 || min > 0.92 ? 0.02 : 1
          const weight = (0.05 + sat * sat) * lumW
          r += R * weight; g += G * weight; b += B * weight; wt += weight
        }
        if (!wt) return resolve(FALLBACK)
        const [hue, s] = rgbToHs(r / wt, g / wt, b / wt)
        const sat = Math.round(Math.min(78, Math.max(32, s * 100 * 1.4)))
        resolve(`hsl(${Math.round(hue)} ${sat}% 68%)`)
      } catch (e) {
        reject(e)
      }
    }
    img.onerror = () => reject(new Error('load failed'))
    img.src = src
  })
}

function rgbToHs(r: number, g: number, b: number): [number, number] {
  const max = Math.max(r, g, b), min = Math.min(r, g, b)
  const l = (max + min) / 2
  const d = max - min
  if (d === 0) return [36, 0]
  const s = d / (1 - Math.abs(2 * l - 1))
  let h: number
  if (max === r) h = ((g - b) / d) % 6
  else if (max === g) h = (b - r) / d + 2
  else h = (r - g) / d + 4
  h *= 60
  if (h < 0) h += 360
  return [h, s]
}
