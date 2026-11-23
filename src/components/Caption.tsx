import { motion, type MotionValue } from 'framer-motion'
import type { Movie } from '../types'
import { formatRating } from '../lib/sort'

interface Props {
  movie: Movie | undefined
  /** 1-based position on the shelf, and how many are on it */
  position: number
  total: number
  top: number
  accent: string
  /** fades out while the detail view is open */
  opacity: MotionValue<number>
}

export function Caption({ movie, position, total, top, accent, opacity }: Props) {
  return (
    <motion.div className="caption" style={{ top, opacity }}>
      {/* One caption at a time: the new one fades in and the old one is removed at once.
          (Exit animations stacked up to ~8 captions mid-flick.) */}
      {movie && (
          <motion.div
            key={movie.id}
            className="caption__inner"
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.18, ease: [0.2, 0.7, 0.2, 1] }}
          >
            <div className="caption__count" aria-label={`${position} of ${total}`}>
              {position}
              <span>/{total}</span>
            </div>
            <div className="caption__title">{movie.title}</div>
            <div className="caption__year">{movie.year}</div>
            <div className="caption__rating" style={{ color: accent }}>
              {formatRating(movie.myRating)}
            </div>
          </motion.div>
      )}
    </motion.div>
  )
}
