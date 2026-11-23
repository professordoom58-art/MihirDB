import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion, useMotionValue, useReducedMotion, useTransform } from 'framer-motion'
import { Backdrop } from './components/Backdrop'
import { Caption } from './components/Caption'
import { Carousel, type CarouselHandle } from './components/Carousel'
import { DetailView } from './components/DetailView'
import { Importer } from './components/Importer'
import { MovieEditor } from './components/MovieEditor'
import { isFiltered, NO_FILTER, SearchPanel, type Filter } from './components/SearchPanel'
import { Settings } from './components/Settings'
import { TopBar } from './components/TopBar'
import { getPalette } from './lib/accent'
import { DEFAULT_PALETTE, readableTint, type Palette } from './lib/palette'
import { db, useLive } from './lib/db'
import { computeLayout, wrap } from './lib/layout'
import { CHOREO } from './lib/motion'
import { useAutoPerf } from './lib/perf'
import { blobUrl } from './lib/posters'
import { formatRange, inRange, sortShelf } from './lib/sort'
import { deleteMovie } from './lib/store'
import { syncPending } from './lib/sync'
import { startTilt, tiltWanted } from './lib/tilt'
import { corsUrl, posterSrc } from './lib/tmdb'
import { useViewport } from './lib/useViewport'
import type { CaseStyle, Movie } from './types'

const STYLE_KEY = 'shelf.caseStyle'
/** Last movie the wheel came to rest on: a WebView reload (memory pressure in a
 *  sideloaded container) should come back to it instead of the first entry. */
const ACTIVE_KEY = 'shelf.activeId'

function loadCaseStyle(): CaseStyle {
  try {
    return localStorage.getItem(STYLE_KEY) === 'dvd' ? 'dvd' : 'cd'
  } catch {
    return 'cd'
  }
}

function loadActiveId(): string | null {
  try {
    return localStorage.getItem(ACTIVE_KEY)
  } catch {
    return null
  }
}

function paletteSource(m: Movie): string | null {
  return blobUrl(m) ?? (m.posterPath ? corsUrl(posterSrc(m.posterPath, 'w185')) : m.posterUrl ? corsUrl(m.posterUrl) : null)
}

export default function App() {
  const all = useLive(() => db.movies.toArray(), [], null as Movie[] | null)
  const [filter, setFilterState] = useState<Filter>(NO_FILTER)
  const filterChanged = useRef(false)
  const setFilter = useCallback((f: Filter) => {
    filterChanged.current = true
    setFilterState(f)
  }, [])
  const shelf = useMemo(
    () => (all ? sortShelf(all).filter((m) => inRange(m.myRating, filter.min, filter.max)) : []),
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
  // Where we left off last time (survives a WebView reload; see ACTIVE_KEY).
  const [savedId] = useState(loadActiveId)
  const restored = useRef(false)
  const lite = useAutoPerf(pos)
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
  // 0..1 while the detail view is open: neighbours make room, caption/top bar fade, background dims
  const room = useMotionValue(0)
  const chromeOpacity = useTransform(room, (r) => 1 - r)
  const bgDim = useTransform(room, (r) => r * CHOREO.bgDim)
  const [computed, setComputed] = useState<Record<string, Palette>>({})

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
      if (!id) return
      // Remember the resting place, so a WebView relaunch resumes here.
      try {
        localStorage.setItem(ACTIVE_KEY, id)
      } catch {
        /* private mode */
      }
      if (id === lastSwept.current) return
      lastSwept.current = id
      if (!reduceMotion) setSweep((s) => ({ id, key: (s?.key ?? 0) + 1 }))
    },
    [reduceMotion],
  )
  const [activeSlot, setActiveSlot] = useState(0)
  const onActiveChange = useCallback((i: number, slot: number) => {
    setActive(i)
    setActiveSlot(slot)
    const id = shelfRef.current[i]?.id ?? null
    activeId.current = id
    // leaving the centre re-arms the sweep for when it settles again
    if (id !== lastSwept.current) lastSwept.current = null
  }, [])

  // ---------------------------------------------------------------- keep the shelf steady across data changes
  useLayoutEffect(() => {
    const n = shelf.length
    if (!n) return
    // First data load: resume the movie the shelf was last resting on (survives a
    // WebView reload, which is what made it look like the app "reset to 1/179").
    if (!restored.current) {
      restored.current = true
      if (savedId && shelf.some((m) => m.id === savedId)) activeId.current = savedId
    }
    const cur = activeId.current ? shelf.findIndex((m) => m.id === activeId.current) : -1
    const keep = cur >= 0 ? cur : Math.min(active, n - 1)
    if (keep !== wrap(Math.round(pos.get()), n) || keep !== active) {
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
    } else if (filterChanged.current) {
      // rating filter changed: glide to the highest-rated remaining case
      lastSwept.current = null
      requestAnimationFrame(() => carousel.current?.goTo(0))
    }
    filterChanged.current = false
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shelf])

  // first sweep after launch
  const launched = useRef(false)
  useEffect(() => {
    if (launched.current || !shelf.length) return
    launched.current = true
    const t = window.setTimeout(() => onSettle(wrap(Math.round(pos.get()), shelf.length)), 450)
    return () => window.clearTimeout(t)
  }, [shelf.length, onSettle, pos])

  // ---------------------------------------------------------------- palette (stored per entry; computed once if missing)
  const activeMovie = shelf[active]
  const palette = activeMovie?.palette ?? (activeMovie && computed[activeMovie.id]) ?? DEFAULT_PALETTE
  useEffect(() => {
    if (!activeMovie || activeMovie.palette || computed[activeMovie.id]) return
    const src = paletteSource(activeMovie)
    if (!src) return
    const id = activeMovie.id
    getPalette(src).then((p) => {
      setComputed((c) => ({ ...c, [id]: p }))
      void db.movies.update(id, { palette: p })
    })
  }, [activeMovie, computed])
  // rating tint: the vivid colour, lifted until it has ≥4.5:1 contrast on the dark floor
  const accent = useMemo(() => readableTint(palette.vivid, palette.dark), [palette])

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
    <div className={`app${detailId ? ' has-detail' : ''}${lite ? ' perf-lite' : ''}`} style={{ ['--accent' as string]: accent }}>
      {all && all.length > 0 && (
        <div className="backdrop-wrap">
          <Backdrop movie={activeMovie} index={activeSlot} palette={palette} pos={pos} layout={layout} glareX={glareX} glareY={glareY} />
          {/* extra dim while the detail view is open: an opacity-only overlay (a blur filter here re-rasterised every frame) */}
          <motion.div className="backdrop-dim" style={{ opacity: bgDim }} />
        </div>
      )}
      {shelf.length > 0 && (
        <Carousel
          ref={carousel}
          movies={shelf}
          layout={layout}
          caseStyle={caseStyle}
          pos={pos}
          onActiveChange={onActiveChange}
          onSettle={onSettle}
          onTapCentre={onTapCentre}
          sweep={sweep}
          glareX={glareX}
          glareY={glareY}
          hiddenId={detailId}
          freshId={freshId}
          room={room}
          locked={!!detailId}
        />
      )}
      {shelf.length > 0 && (
        <Caption
          movie={activeMovie}
          position={active + 1}
          total={shelf.length}
          top={layout.cy + layout.h / 2 + Math.max(26, layout.h * 0.26)}
          accent={accent}
          opacity={chromeOpacity}
        />
      )}

      <AnimatePresence>
        {empty && all && all.length > 0 && (
          <motion.div className="nomatch" key="nomatch" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <span>Nothing rated {formatRange(filter.min, filter.max)} yet</span>
            <button className="textbtn" onClick={() => setFilter(NO_FILTER)}>
              Reset
            </button>
          </motion.div>
        )}
        {empty && all?.length === 0 && (
          <motion.div className="empty" key="empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <div className="empty__case" aria-hidden>
              <div className="case case--cd">
                <div className="case__tray" />
                <div className="case__spine" />
                <div className="case__plastic" />
              </div>
            </div>
            <p>Your shelf is empty.</p>
            <button className="btn btn--primary" onClick={() => setEditor({ open: true, editing: null })}>
              Add your first movie
            </button>
            <button className="textbtn" onClick={() => setSettingsOpen(true)}>
              Import a catalog
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      <TopBar
        opacity={chromeOpacity}
        filtered={isFiltered(filter)}
        onSearch={() => setPanelOpen((o) => !o)}
        onAdd={() => setEditor({ open: true, editing: null })}
        onHome={() => {
          lastSwept.current = null
          carousel.current?.goTo(0)
        }}
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
          getOrigin={() => (detailIndex >= 0 ? (carousel.current?.pose(detailIndex) ?? null) : null)}
          room={room}
          glareX={glareX}
          glareY={glareY}
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
