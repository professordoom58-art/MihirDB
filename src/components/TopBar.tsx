interface Props {
  filtered: boolean
  onSearch: () => void
  onAdd: () => void
}

export function TopBar({ filtered, onSearch, onAdd }: Props) {
  return (
    <div className="topbar">
      <button className="iconbtn" aria-label="Search and filter" onClick={onSearch}>
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
          <circle cx="10.5" cy="10.5" r="6.5" />
          <path d="M15.5 15.5 20 20" />
        </svg>
        {filtered && <span className="iconbtn__dot" aria-label="Filter active" />}
      </button>
      <button className="iconbtn" aria-label="Add movie" onClick={onAdd}>
        <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
          <path d="M12 5v14M5 12h14" />
        </svg>
      </button>
    </div>
  )
}
