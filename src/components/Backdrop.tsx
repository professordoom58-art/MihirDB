import { memo, useEffect, useRef, useState } from 'react'
import { motion, useTransform, type MotionValue } from 'framer-motion'
import type { Movie } from '../types'
import type { ShelfLayout } from '../lib/layout'
import { alpha, DEFAULT_PALETTE, type Palette } from '../lib/palette'
import { blobUrl, posterFor } from '../lib/posters'
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

  const primary = movie.backdropPath ? backdropSrc(movie.backdropPath, 'w1280') : posterFor(movie)
  const [src, setSrc] = useState(primary)
  const fellBack = useRef(false)
  useEffect(() => {
    fellBack.current = false
    setSrc(primary)
  }, [primary])
  // Offline / missing backdrop: use the poster (locally cached blob if we have it).
  const onError = () => {
    if (fellBack.current) return
    fellBack.current = true
    const p = blobUrl(movie) ?? movie.posterUrl
    if (p && p !== src) setSrc(p)
  }

  const { cy, w, h } = layout
  const caseTop = cy - h / 2
  return (
    <motion.div
      className="scene"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.6, ease: [0.25, 0.1, 0.25, 1] }}
      onAnimationComplete={() => onIn(spec.key)}
    >
      <motion.div className="scene__parallax" style={{ x, y }}>
        <div className="scene__kb">
          {src && <img src={src} alt="" draggable={false} onError={onError} decoding="async" />}
        </div>
      </motion.div>
      {/* colour grade: tint toward the vivid colour, sink into the dark one */}
      <div className="scene__tint" style={{ background: palette.vivid }} />
      <div
        className="scene__wash"
        style={{
          background: `linear-gradient(180deg, ${alpha(palette.dark, 0.35)} 0%, ${alpha(palette.dark, 0.05)} 28%, ${alpha(
            palette.dark,
            0.25,
          )} 52%, ${alpha(palette.dark, 0.9)} 76%, ${palette.dark} 100%)`,
        }}
      />
      {/* glow behind the case */}
      <div
        className="scene__glow"
        style={{
          left: `calc(50% - ${w * 0.95}px)`,
          top: cy - w * 0.75,
          width: w * 1.9,
          height: w * 1.5,
          background: `radial-gradient(closest-side, ${alpha(palette.vivid, 0.42)}, ${alpha(palette.vivid, 0.12)} 55%, transparent)`,
        }}
      />
      {/* stage light: a soft beam from above + an elliptical pool just above/behind the case */}
      <div
        className="scene__beam"
        style={{
          left: `calc(50% - ${w * 0.75}px)`,
          width: w * 1.5,
          height: caseTop + h * 0.25,
          background: `radial-gradient(50% 100% at 50% 100%, ${alpha(palette.light, 0.09)}, ${alpha(palette.light, 0.03)} 55%, transparent 80%)`,
        }}
      />
      <div
        className="scene__spot"
        style={{
          left: `calc(50% - ${w * 0.7}px)`,
          top: caseTop - w * 0.32,
          width: w * 1.4,
          height: w * 0.6,
          background: `radial-gradient(closest-side, ${alpha(palette.vivid, 0.35)}, ${alpha(palette.vivid, 0.1)} 60%, transparent)`,
        }}
      />
      {/* glossy floor: a faint horizon where the cases stand */}
      <div
        className="scene__floor"
        style={{
          top: cy + h / 2 + 2,
          background: `linear-gradient(180deg, ${alpha(palette.light, 0.07)} 0px, ${alpha(palette.vivid, 0.05)} 2px, transparent 38%)`,
        }}
      />
    </motion.div>
  )
})
