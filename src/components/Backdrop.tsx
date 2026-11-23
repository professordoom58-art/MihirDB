import { memo, useEffect, useRef, useState } from 'react'
import { motion, useTransform, type MotionValue } from 'framer-motion'
import type { Movie } from '../types'
import type { ShelfLayout } from '../lib/layout'
import { alpha, DEFAULT_PALETTE, type Palette } from '../lib/palette'
import { blobUrl, posterFor, thumbFor } from '../lib/posters'
import { backdropSrc } from '../lib/tmdb'

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

/**
 * One backdrop scene = TWO composited layers (it used to be ~10, four of them
 * full-screen with a CSS blur, which is what exhausted the iOS WebView's memory):
 *  1. the image: the still drawn into a ~64px canvas and stretched to full screen,
 *     which is the blur, with no blur filter and no offscreen filter buffers. Parallax drives `transform`; the
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
  const x = useTransform([pos, glareX] as MotionValue<number>[], ([p, gx]: number[]) => (p - index) * layout.d1 * 0.1 + gx * 7)
  const y = useTransform(glareY, (gy) => gy * 5)

  const primary = movie.backdropPath ? backdropSrc(movie.backdropPath, 'w300') : (thumbFor(movie, 'w185') ?? posterFor(movie))
  const canvas = useRef<HTMLCanvasElement>(null)
  const [ready, setReady] = useState(false)

  // Draw the still into a tiny canvas (cover-cropped to the screen's shape) and let the
  // GPU stretch it: a 64px-wide image upscaled to full screen IS a heavy blur, at a few
  // KB of memory instead of a full-screen blurred surface. Offline / missing backdrop →
  // the poster (locally cached blob if we have it).
  useEffect(() => {
    let alive = true
    const sources = [primary, blobUrl(movie) ?? movie.posterUrl].filter((u, i, a): u is string => !!u && a.indexOf(u) === i)
    const draw = (img: HTMLImageElement) => {
      const c = canvas.current
      if (!c || !alive) return
      const W = 64
      const H = Math.max(1, Math.round((W * layout.vh) / layout.vw))
      c.width = W
      c.height = H
      const ctx = c.getContext('2d')
      if (!ctx) return
      // object-fit: cover, anchored a little above centre
      const s = Math.max(W / img.naturalWidth, H / img.naturalHeight)
      const dw = img.naturalWidth * s
      const dh = img.naturalHeight * s
      ctx.imageSmoothingEnabled = true
      ctx.imageSmoothingQuality = 'high'
      ctx.drawImage(img, (W - dw) / 2, (H - dh) * 0.35, dw, dh)
      // two down/up passes = a soft box blur, so the upscale shows no blocks
      for (let pass = 0; pass < 2; pass++) {
        ctx.drawImage(c, 0, 0, W, H, 0, 0, W / 3, H / 3)
        ctx.drawImage(c, 0, 0, W / 3, H / 3, 0, 0, W, H)
      }
      setReady(true)
    }
    const tryLoad = (i: number) => {
      if (i >= sources.length || !alive) return
      const img = new Image()
      img.decoding = 'async'
      img.onload = () => draw(img)
      img.onerror = () => tryLoad(i + 1)
      img.src = sources[i]
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
    // floor: a faint horizon where the cases stand
    `linear-gradient(180deg, ${alpha(palette.light, 0.07)} 0px, ${alpha(palette.vivid, 0.05)} 2px, transparent 38%) 0 ${px(floorTop)} / 100% ${px(vh - floorTop)} no-repeat`,
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
