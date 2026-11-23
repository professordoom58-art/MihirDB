import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion, useMotionValue, useReducedMotion } from 'framer-motion'
import { Backdrop } from './components/Backdrop'
import { Caption } from './components/Caption'
import { Carousel, type CarouselHandle } from './components/Carousel'
import { DetailView } from './components/DetailView'
import { Importer } from './components/Importer'
import { MovieEditor } from './components/MovieEditor'
import { isFiltered, NO_FILTER, SearchPanel, type Filter } from './components/SearchPanel'
import { Settings } from './components/Settings'
import { TopBar } from './components/TopBar'
import { getAccent } from './lib/accent'
import { db, useLive } from './lib/db'
import { computeLayout } from './lib/layout'
import { blobUrl } from './lib/posters'
import { sortShelf } from './lib/sort'
import { deleteMovie } from './lib/store'
import { syncPending } from './lib/sync'
import { startTilt, tiltWanted } from './lib/tilt'
import { corsUrl, posterSrc } from './lib/tmdb'
import { useViewport } from './lib/useViewport'
import type { CaseStyle, Movie } from './types'

const STYLE_KEY = 'shelf.caseStyle'

function loadCaseStyle(): CaseStyle {
  try {
    return localStorage.getItem(STYLE_KEY) === 'dvd' ? 'dvd' : 'cd'
  } catch {
    return 'cd'
  }
}

function accentSource(m: Movie): string | null {
  return blobUrl(m) ?? (m.posterPath ? corsUrl(posterSrc(m.posterPath, 'w92')) : m.posterUrl ? corsUrl(m.posterUrl) : null)
}

export default function App() {
  const all = useLive(() => db.movies.toArray(), [], null as Movie[] | null)
  const [filter, setFilter] = useState<Filter>(NO_FILTER)
  const shelf = useMemo(
    () => (all ? sortShelf(all).filter((m) => m.myRating >= filter.min && m.myRating <= filter.max) : []),
    [all, filter],
  )
  const shelfRef = useRef(shelf)
  shelfRef.current = shelf

  const { vw, vh } = useViewport()
  const [caseStyle, setCaseStyle] = useState<CaseStyle>(loadCaseStyle)
  const layout = useMemo(() => computeLayout(vw, vh, caseStyle), [vw, vh, caseStyle])

  const pos = useMotionValue(0)
  const [active, setActive] = useState(0)
  const activeId = useRef<string | null>(null)
  const [sweep, setSweep] = useState<{ id: string; key: number } | null>(null)
  const lastSwept = useRef<string | null>(null)
  const carousel = useRef<CarouselHandle>(null)
  const reduceMotion = useReducedMotion()

  const [panelOpen, setPanelOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [importerOpen, setImporterOpen] = useState(false)
  const [editor, setEditor] = useState<{ open: boolean; editing: Movie | null }>({ open: false, editing: null })
  const [detailId, setDetailId] = useState<string | null>(null)
  const [freshId, setFreshId] = useState<string | null>(null)
  const pendingFocus = useRef<string | null>(null)
  const [accent, setAccent] = useState('hsl(36 60% 70%)')

  // ---------------------------------------------------------------- glare input
  const glareX = useMotionValue(0)
  const glareY = useMotionValue(-0.3)
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse') return
      glareX.set((e.clientX / window.innerWidth) * 2 - 1)
      glareY.set((e.clientY / window.innerHeight) * 2 - 1)
    }
    window.addEventListener('pointermove', onMove)
    let stopTilt: (() => void) | null = null
    const applyTilt = () => {
      stopTilt?.()
      stopTilt = tiltWanted() ? startTilt(glareX, glareY) : null
    }
    applyTilt()
    window.addEventListener('shelf:tilt', applyTilt)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('shelf:tilt', applyTilt)
      stopTilt?.()
    }
  }, [glareX, glareY])

  // ---------------------------------------------------------------- background sync
  useEffect(() => {
    const t = window.setTimeout(syncPending, 1500)
    const on = () => void syncPending()
    window.addEventListener('online', on)
    return () => {
      window.clearTimeout(t)
      window.removeEventListener('online', on)
    }
  }, [])

  // ---------------------------------------------------------------- sweep
  const onSettle = useCallback(
    (i: number) => {
      const id = shelfRef.current[i]?.id
      if (!id || id === lastSwept.current) return
      lastSwept.current = id
      if (!reduceMotion) setSweep((s) => ({ id, key: (s?.key ?? 0) + 1 }))
    },
    [reduceMotion],
  )
  const onActiveChange = useCallback((i: number) => {
    setActive(i)
    const id = shelfRef.current[i]?.id ?? null
    activeId.current = id
    // leaving the centre re-arms the sweep for when it settles again
    if (id !== lastSwept.current) lastSwept.current = null
  }, [])

  // ---------------------------------------------------------------- keep the shelf steady across data changes
  useLayoutEffect(() => {
    const n = shelf.length
    if (!n) return
    const cur = activeId.current ? shelf.findIndex((m) => m.id === activeId.current) : -1
    const keep = cur >= 0 ? cur : Math.min(active, n - 1)
    if (keep !== Math.round(pos.get()) || keep !== active) {
      carousel.current?.jumpTo(keep)
      setActive(keep)
    }
    activeId.current = shelf[keep].id

    const focus = pendingFocus.current
    const target = focus ? shelf.findIndex((m) => m.id === focus) : -1
    if (target >= 0) {
      pendingFocus.current = null
      lastSwept.current = null
      // let the new case mount, then glide to its sorted position
      requestAnimationFrame(() => carousel.current?.goTo(target))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shelf])

  // first sweep after launch
  const launched = useRef(false)
  useEffect(() => {
    if (launched.current || !shelf.length) return
    launched.current = true
    const t = window.setTimeout(() => onSettle(Math.round(pos.get())), 450)
    return () => window.clearTimeout(t)
  }, [shelf.length, onSettle, pos])

  // ---------------------------------------------------------------- accent colour
  const activeMovie = shelf[active]
  const accentSrc = activeMovie ? accentSource(activeMovie) : null
  useEffect(() => {
    if (!accentSrc) return
    let alive = true
    getAccent(accentSrc).then((c) => alive && setAccent(c))
    return () => {
      alive = false
    }
  }, [accentSrc])

  // ---------------------------------------------------------------- actions
  const changeStyle = (s: CaseStyle) => {
    setCaseStyle(s)
    try {
      localStorage.setItem(STYLE_KEY, s)
    } catch {
      /* private mode */
    }
  }

  const onTapCentre = useCallback((i: number) => {
    const m = shelfRef.current[i]
    if (m) setDetailId(m.id)
  }, [])

  const onSaved = useCallback((id: string, isNew: boolean) => {
    pendingFocus.current = id
    if (isNew) {
      setFilter(NO_FILTER)
      setFreshId(id)
      window.setTimeout(() => setFreshId((f) => (f === id ? null : f)), 1600)
    }
  }, [])

  const goToId = (id: string) => {
    const i = shelf.findIndex((m) => m.id === id)
    if (i < 0) {
      // it's filtered out: clear the filter, then focus it
      pendingFocus.current = id
      setFilter(NO_FILTER)
    } else {
      lastSwept.current = null
      carousel.current?.goTo(i)
    }
    setPanelOpen(false)
  }

  const detailMovie = detailId ? all?.find((m) => m.id === detailId) : undefined
  const detailIndex = detailMovie ? shelf.findIndex((m) => m.id === detailMovie.id) : -1

  const loading = all === null
  const empty = !loading && shelf.length === 0

  return (
    <div className={`app${detailId ? ' has-detail' : ''}`} style={{ ['--accent' as string]: accent }}>
      {!empty && <Backdrop movies={shelf} pos={pos} activeIndex={active} />}
      {shelf.length > 0 && (
        <Carousel
          ref={carousel}
          movies={shelf}
          layout={layout}
          caseStyle={caseStyle}
          pos={pos}
          activeIndex={active}
          onActiveChange={onActiveChange}
          onSettle={onSettle}
          onTapCentre={onTapCentre}
          sweep={sweep}
          glareX={glareX}
          glareY={glareY}
          hiddenId={detailId}
          freshId={freshId}
        />
      )}
      {shelf.length > 0 && (
        <Caption movie={activeMovie} top={layout.cy + layout.h / 2 + Math.max(22, layout.vh * 0.035)} accent={accent} />
      )}

      <AnimatePresence>
        {empty && (
          <motion.div className="empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <div className="empty__case" aria-hidden>
              <div className="case case--cd">
                <div className="case__tray" />
                <div className="case__spine" />
                <div className="case__plastic" />
              </div>
            </div>
            {all && all.length > 0 ? (
              <>
                <p>
                  Nothing rated between {filter.min} and {filter.max}.
                </p>
                <button className="btn" onClick={() => setFilter(NO_FILTER)}>
                  Show all
                </button>
              </>
            ) : (
              <>
                <p>Your shelf is empty.</p>
                <button className="btn btn--primary" onClick={() => setEditor({ open: true, editing: null })}>
                  Add your first movie
                </button>
                <button className="textbtn" onClick={() => setSettingsOpen(true)}>
                  Import or load samples
                </button>
              </>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      <TopBar
        filtered={isFiltered(filter)}
        onSearch={() => setPanelOpen((o) => !o)}
        onAdd={() => setEditor({ open: true, editing: null })}
      />

      <SearchPanel
        open={panelOpen}
        movies={all ?? []}
        filter={filter}
        onFilter={setFilter}
        onPick={goToId}
        onSettings={() => {
          setPanelOpen(false)
          setSettingsOpen(true)
        }}
        onClose={() => setPanelOpen(false)}
      />

      {detailMovie && (
        <DetailView
          key={detailMovie.id}
          movie={detailMovie}
          caseStyle={caseStyle}
          accent={accent}
          originRect={() => (detailIndex >= 0 ? (carousel.current?.caseRect(detailIndex) ?? null) : null)}
          onClosed={() => setDetailId(null)}
          onEdit={(m) => setEditor({ open: true, editing: m })}
          onDelete={async (m) => {
            setDetailId(null)
            await deleteMovie(m.id)
          }}
        />
      )}

      <MovieEditor
        open={editor.open}
        editing={editor.editing}
        onClose={() => setEditor((e) => ({ ...e, open: false }))}
        onSaved={onSaved}
      />
      <Settings
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        caseStyle={caseStyle}
        onCaseStyle={changeStyle}
        onOpenImporter={() => setImporterOpen(true)}
      />
      <Importer open={importerOpen} onClose={() => setImporterOpen(false)} />
    </div>
  )
}
