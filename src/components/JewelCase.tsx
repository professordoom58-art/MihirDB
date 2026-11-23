import { memo, useEffect, useState } from 'react'
import { motion, useTransform, type MotionValue } from 'framer-motion'
import type { Movie } from '../types'
import { displaySrc, thumbFor } from '../lib/posters'

interface Props {
  movie: Movie
  /** 0 when this case is centred, 1+ as it moves away */
  distance?: MotionValue<number>
  /** pointer / tilt position, -1..1 */
  glareX?: MotionValue<number>
  glareY?: MotionValue<number>
  /** changes each time this case snaps to centre; null when it isn't the active one */
  sweepKey?: number | null
  /** only the centred few need the live highlight layers */
  live?: boolean
}

function JewelCaseImpl({ movie, distance, glareX, glareY, sweepKey = null, live = false }: Props) {
  const src = displaySrc(movie)
  const lqip = thumbFor(movie)
  const [loaded, setLoaded] = useState(false)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    setFailed(false)
  }, [src])

  return (
    <div className="case">
      <div className="case__tray" />
      <div className="case__insert">
        {src && !failed ? (
          <>
            {lqip && !loaded && <img className="case__lqip" src={lqip} alt="" draggable={false} aria-hidden />}
            <img
              className={`case__poster${loaded ? ' is-loaded' : ''}`}
              src={src}
              alt={movie.title}
              draggable={false}
              decoding="async"
              onLoad={() => setLoaded(true)}
              onError={() => setFailed(true)}
            />
          </>
        ) : (
          <div className="case__fallback">
            <span>{movie.title}</span>
          </div>
        )}
      </div>
      <div className="case__spine" />
      <div className="case__plastic" />
      {live && distance && glareX && glareY && (
        <Glare distance={distance} glareX={glareX} glareY={glareY} sweepKey={sweepKey} />
      )}
    </div>
  )
}

function Glare({
  distance,
  glareX,
  glareY,
  sweepKey,
}: {
  distance: MotionValue<number>
  glareX: MotionValue<number>
  glareY: MotionValue<number>
  sweepKey: number | null
}) {
  // Faint static highlight: present only while (nearly) centred, fades as the case leaves.
  const centred = useTransform(distance, (d) => Math.max(0, 1 - d * 1.6))
  const hl = useTransform(
    [glareX, glareY] as MotionValue<number>[],
    ([x, y]: number[]) => `translate3d(${(x * 22).toFixed(2)}%, ${(y * 22).toFixed(2)}%, 0)`,
  )
  return (
    <motion.div className="case__glare" style={{ opacity: centred }}>
      <motion.div className="case__highlight" style={{ transform: hl }} />
      {sweepKey !== null && <div key={sweepKey} className="case__sweep" />}
    </motion.div>
  )
}

export const JewelCase = memo(JewelCaseImpl)
