import { AnimatePresence, motion } from 'framer-motion'
import type { Movie } from '../types'
import { formatRating } from '../lib/sort'

export function Caption({ movie, top, accent }: { movie: Movie | undefined; top: number; accent: string }) {
  return (
    <div className="caption" style={{ top }}>
      <AnimatePresence initial={false} mode="popLayout">
        {movie && (
          <motion.div
            key={movie.id}
            className="caption__inner"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.22, ease: [0.2, 0.7, 0.2, 1] }}
          >
            <div className="caption__title">{movie.title}</div>
            <div className="caption__year">{movie.year}</div>
            <div className="caption__rating" style={{ color: accent }}>
              {formatRating(movie.myRating)}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
