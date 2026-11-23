import { memo } from 'react'
import { motion, useTransform, type MotionValue } from 'framer-motion'
import type { Movie } from '../types'
import { backdropFor } from '../lib/posters'

/**
 * Heavily blurred, darkened copy of the active poster. Each nearby poster has its
 * own pre-blurred layer whose opacity follows the scroll position, so the
 * background crossfades continuously while you drag (only opacity animates).
 */
export function Backdrop({ movies, pos, activeIndex }: { movies: Movie[]; pos: MotionValue<number>; activeIndex: number }) {
  const lo = Math.max(0, activeIndex - 1)
  const hi = Math.min(movies.length - 1, activeIndex + 1)
  const layers = []
  for (let i = lo; i <= hi; i++) layers.push(<Layer key={movies[i].id} index={i} movie={movies[i]} pos={pos} />)
  return (
    <div className="backdrop" aria-hidden>
      {layers}
      <div className="backdrop__shade" />
    </div>
  )
}

const Layer = memo(function Layer({ index, movie, pos }: { index: number; movie: Movie; pos: MotionValue<number> }) {
  const opacity = useTransform(pos, (p) => Math.max(0, 1 - Math.abs(index - p)))
  const src = backdropFor(movie)
  return (
    <motion.div className="backdrop__layer" style={{ opacity }}>
      {src && <img src={src} alt="" draggable={false} />}
    </motion.div>
  )
})
