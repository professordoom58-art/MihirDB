import { DEFAULT_PALETTE, paletteFromPixels, type Palette } from './palette'

/**
 * Palette for entries that don't have one stored yet (movies added in the app).
 * Same quantiser as the seed script, run on a small canvas downsample.
 * Pass a blob: URL or a CORS-enabled URL (see corsUrl in tmdb.ts).
 */
const cache = new Map<string, Promise<Palette>>()

export function getPalette(src: string): Promise<Palette> {
  let p = cache.get(src)
  if (!p) {
    p = extract(src).catch(() => DEFAULT_PALETTE)
    cache.set(src, p)
  }
  return p
}

function extract(src: string): Promise<Palette> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    if (!src.startsWith('blob:')) img.crossOrigin = 'anonymous'
    img.decoding = 'async'
    img.onload = () => {
      try {
        // 48×72 with high-quality smoothing: a single big downscale skips pixels and
        // loses small vivid details (e.g. the fiery bat on The Dark Knight).
        const c = document.createElement('canvas')
        c.width = 48
        c.height = 72
        const ctx = c.getContext('2d', { willReadFrequently: true })
        if (!ctx) return reject(new Error('no ctx'))
        ctx.imageSmoothingEnabled = true
        ctx.imageSmoothingQuality = 'high'
        ctx.drawImage(img, 0, 0, 48, 72)
        resolve(paletteFromPixels(ctx.getImageData(0, 0, 48, 72).data, 4))
      } catch (e) {
        reject(e)
      }
    }
    img.onerror = () => reject(new Error('load failed'))
    img.src = src
  })
}
