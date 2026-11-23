import { motion, type MotionValue } from 'framer-motion'

interface Props {
  opacity: MotionValue<number>
  filtered: boolean
  onSearch: () => void
  onAdd: () => void
  /** wordmark tap: back to the first (highest-rated) movie */
  onHome: () => void
}

export function TopBar({ opacity, filtered, onSearch, onAdd, onHome }: Props) {
  return (
    <motion.div className="topbar" style={{ opacity }}>
      <button className="iconbtn" aria-label="Search and filter" onClick={onSearch}>
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
          <circle cx="10.5" cy="10.5" r="6.5" />
          <path d="M15.5 15.5 20 20" />
        </svg>
        {filtered && <span className="iconbtn__dot" aria-label="Filter active" />}
      </button>
      <button className="wordmark" onClick={onHome} aria-label="MihirDB: back to the top-rated movie">
        <span className="wordmark__bold">Mihir</span>
        <span className="wordmark__light">DB</span>
      </button>
      <button className="iconbtn" aria-label="Add movie" onClick={onAdd}>
        <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
          <path d="M12 5v14M5 12h14" />
        </svg>
      </button>
    </motion.div>
  )
}
