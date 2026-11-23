import { memo, useEffect, useRef, useState } from 'react'
import { motion, useTransform, type MotionValue } from 'framer-motion'
import type { Movie } from '../types'
import type { ShelfLayout } from '../lib/layout'
import { alpha, DEFAULT_PALETTE, type Palette } from '../lib/palette'
import { blobUrl, posterFor } from '../lib/posters'
import { backdropSrc, corsUrl } from '../lib/tmdb'
import { blurAsync } from '../lib/blur'

interface Props {
  movie: Movie | undefined
  index: number
  palette: Palette
  pos: MotionValue<number>
  layout: ShelfLayout
  glareX: MotionValue<number>
  glareY: MotionValue<number>
}

interface SceneSpec {
  key: string
  movie: Movie
  index: number
  palette: Palette
}

const SETTLE_MS = 120 // don't start loading backdrops for items you're flicking past

/**
 * PS5-style stage behind the shelf. Per active movie: its backdrop (lightly blurred,
 * slow Ken Burns drift), a palette colour grade, a glow + spotlight behind the case
 * and a floor sheen. Scenes crossfade (~600ms); at most two are mounted.
 * Vignette and grain sit on top and never change.
 */
export function Backdrop({ movie, index, palette, pos, layout, glareX, glareY }: Props) {
  const [scenes, setScenes] = useState<SceneSpec[]>([])

  useEffect(() => {
    if (!movie) return
    const t = window.setTimeout(() => {
      setScenes((s) => {
        const last = s[s.length - 1]
        if (last && last.key === movie.id) {
          // same movie, maybe a fresher palette / poster: update in place
          return [...s.slice(0, -1), { ...last, movie, index, palette }]
        }
        return [...s.slice(-1), { key: movie.id, movie, index, palette }]
      })
    }, SETTLE_MS)
    return () => window.clearTimeout(t)
  }, [movie, index, palette])

  // Once the newest scene has faded in, drop the one underneath.
  const settled = (key: string) => setScenes((s) => (s.length > 1 && s[s.length - 1].key === key ? s.slice(-1) : s))

  return (
    <div className="backdrop" aria-hidden>
      {scenes.map((sc) => (
        <Scene key={sc.key} spec={sc} pos={pos} layout={layout} glareX={glareX} glareY={glareY} onIn={settled} />
      ))}
      <div className="backdrop__vignette" />
      <div className="backdrop__grain" />
    </div>
  )
}

const FADE = { duration: 0.6, ease: [0.25, 0.1, 0.25, 1] as const }
/** the image extends 10% past every screen edge (must exceed parallax + tilt + drift) */
const OVERSCAN = 1.2
/** canvas resolution relative to CSS pixels: half-res, then GPU-stretched */
const RES = 0.5
/** blur strength in CSS px (the old CSS filter was 10px) */
const BLUR_CSS_PX = 12

/**
 * One backdrop scene = TWO composited layers (it used to be ~10, four of them
 * full-screen with a CSS blur, which is what exhausted the iOS WebView's memory):
 *  1. the image: the still blurred once on a half-resolution canvas (JS box-blur passes)
 *     and GPU-stretched, with no CSS filter and no offscreen filter buffers. Parallax drives `transform`; the
 *     Ken Burns drift animates the separate `scale`/`translate` properties on the same element.
 *  2. the grade: tint, wash, glow, beam, spot and floor painted as stacked backgrounds
 *     on one static element (rasterised once).
 * The crossfade animates both elements' opacity directly (a faded wrapper would force
 * an offscreen group render).
 */
const Scene = memo(function Scene({
  spec,
  pos,
  layout,
  glareX,
  glareY,
  onIn,
}: {
  spec: SceneSpec
  pos: MotionValue<number>
  layout: ShelfLayout
  glareX: MotionValue<number>
  glareY: MotionValue<number>
  onIn: (key: string) => void
}) {
  const { movie, index, palette = DEFAULT_PALETTE } = spec
  // Parallax: ~10% of the drag, opposite to the finger, plus a few px of tilt / mouse.
  // tanh keeps it bounded: a fast flick travels many cases before the scene switches,
  // and an unbounded shift slid the image's edge into view
  const x = useTransform([pos, glareX] as MotionValue<number>[], ([p, gx]: number[]) => Math.tanh(p - index) * layout.d1 * 0.1 + gx * 7)
  const y = useTransform(glareY, (gy) => gy * 5)

  const primary = movie.backdropPath ? backdropSrc(movie.backdropPath, 'w780') : posterFor(movie)
  const canvas = useRef<HTMLCanvasElement>(null)
  const [ready, setReady] = useState(false)

  // Render the still ONCE into a half-resolution canvas with a real (Gaussian-ish) blur
  // done on its pixels, then let the GPU stretch it 2×. Blurred content upscales without
  // visible pixels, so it looks like the old CSS blur, but costs ~0.4MB instead of a
  // full-screen blurred surface plus filter buffers (what ran the WebView out of memory).
  // Offline / missing backdrop → the poster (locally cached blob if we have it).
  useEffect(() => {
    let alive = true
    const fallback = blobUrl(movie) ?? movie.posterUrl
    const sources = [primary, fallback].filter((u, i, a): u is string => !!u && a.indexOf(u) === i)
    const draw = (img: HTMLImageElement) => {
      const c = canvas.current
      if (!c || !alive) return
      const W = Math.round(layout.vw * OVERSCAN * RES)
      const H = Math.round(layout.vh * OVERSCAN * RES)
      c.width = W
      c.height = H
      const ctx = c.getContext('2d', { willReadFrequently: true })
      if (!ctx) return
      // object-fit: cover, anchored a little above centre
      const sc = Math.max(W / img.naturalWidth, H / img.naturalHeight)
      const dw = img.naturalWidth * sc
      const dh = img.naturalHeight * sc
      ctx.imageSmoothingEnabled = true
      ctx.imageSmoothingQuality = 'high'
      ctx.drawImage(img, (W - dw) / 2, (H - dh) * 0.35, dw, dh)
      let px: ImageData
      try {
        px = ctx.getImageData(0, 0, W, H)
      } catch {
        // pixels not readable (no CORS): cheap fallback, downsample + upscale passes
        for (let pass = 0; pass < 3; pass++) {
          ctx.drawImage(c, 0, 0, W, H, 0, 0, W / 8, H / 8)
          ctx.drawImage(c, 0, 0, W / 8, H / 8, 0, 0, W, H)
        }
        setReady(true)
        return
      }
      // the blur itself runs in a worker; the canvas stays hidden until it's done
      blurAsync(px, BLUR_CSS_PX * RES, 0.9, 1.05).then((out) => {
        if (!alive || !canvas.current) return
        try {
          ctx.putImageData(out, 0, 0)
        } catch {
          // worker died after taking the pixels: redraw and use the cheap blur
          ctx.drawImage(img, (W - dw) / 2, (H - dh) * 0.35, dw, dh)
          for (let pass = 0; pass < 3; pass++) {
            ctx.drawImage(c, 0, 0, W, H, 0, 0, W / 8, H / 8)
            ctx.drawImage(c, 0, 0, W / 8, H / 8, 0, 0, W, H)
          }
        }
        setReady(true)
      })
    }
    const tryLoad = (i: number) => {
      if (i >= sources.length || !alive) return
      const img = new Image()
      img.decoding = 'async'
      const url = sources[i]
      // reading pixels back needs a CORS-clean image (separate cache entry, see corsUrl)
      if (!url.startsWith('blob:')) img.crossOrigin = 'anonymous'
      img.onload = () => draw(img)
      img.onerror = () => tryLoad(i + 1)
      img.src = url.startsWith('blob:') ? url : corsUrl(url)
    }
    tryLoad(0)
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [primary, layout.vw, layout.vh])

  const { cy, w, h, vw, vh } = layout
  const caseTop = cy - h / 2
  const floorTop = cy + h / 2 + 2
  const px = (n: number) => `${Math.round(n)}px`
  const grade = [
    // floor: a faint sheen where the cases stand. It dissolves IN from transparent over
    // ~70px (eased, 4 intermediate stops). It used to start at full strength with a 2px
    // highlight, which drew a hard line across the whole screen under the case.
    `linear-gradient(180deg, transparent 0px, ${alpha(palette.light, 0.008)} 14px, ${alpha(palette.light, 0.022)} 30px, ${alpha(palette.vivid, 0.036)} 48px, ${alpha(palette.vivid, 0.045)} 70px, transparent 40%) 0 ${px(floorTop)} / 100% ${px(vh - floorTop)} no-repeat`,
    // stage light: an elliptical pool just above/behind the case…
    `radial-gradient(closest-side, ${alpha(palette.vivid, 0.35)}, ${alpha(palette.vivid, 0.1)} 60%, transparent) ${px(vw / 2 - w * 0.7)} ${px(caseTop - w * 0.32)} / ${px(w * 1.4)} ${px(w * 0.6)} no-repeat`,
    // …and a soft beam from above
    `radial-gradient(50% 100% at 50% 100%, ${alpha(palette.light, 0.09)}, ${alpha(palette.light, 0.03)} 55%, transparent 80%) ${px(vw / 2 - w * 0.75)} 0 / ${px(w * 1.5)} ${px(caseTop + h * 0.25)} no-repeat`,
    // glow behind the case
    `radial-gradient(closest-side, ${alpha(palette.vivid, 0.42)}, ${alpha(palette.vivid, 0.12)} 55%, transparent) ${px(vw / 2 - w * 0.95)} ${px(cy - w * 0.75)} / ${px(w * 1.9)} ${px(w * 1.5)} no-repeat`,
    // wash: sink into the dark colour toward the bottom
    `linear-gradient(180deg, ${alpha(palette.dark, 0.35)} 0%, ${alpha(palette.dark, 0.05)} 28%, ${alpha(palette.dark, 0.25)} 52%, ${alpha(palette.dark, 0.9)} 76%, ${palette.dark} 100%)`,
    // tint toward the vivid colour
    `linear-gradient(${alpha(palette.vivid, 0.15)}, ${alpha(palette.vivid, 0.15)})`,
  ].join(', ')

  return (
    <div className="scene">
      <motion.canvas
        ref={canvas}
        className="scene__img"
        style={{ x, y }}
        initial={{ opacity: 0 }}
        animate={{ opacity: ready ? 1 : 0 }}
        transition={FADE}
      />
      <motion.div
        className="scene__grade"
        style={{ background: grade }}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={FADE}
        onAnimationComplete={() => onIn(spec.key)}
      />
    </div>
  )
})
