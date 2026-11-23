import { useRef, useState } from 'react'
import type { CaseStyle } from '../types'
import { exportJson, getLastBackup, importJson } from '../lib/backup'
import { db, useLive } from '../lib/db'
import { syncPending } from '../lib/sync'
import { disableTilt, enableTilt, tiltNeedsPermission, tiltSupported, tiltWanted } from '../lib/tilt'
import { mergeSeed } from '../lib/seed'
import { crashCount, resetSafeMode } from '../lib/perf'
import { importOldReviews, OLD_REVIEWS_SNIPPET } from '../lib/reviews'
import { Confirm, Sheet, Spinner } from './ui'

interface Props {
  open: boolean
  onClose: () => void
  caseStyle: CaseStyle
  onCaseStyle: (s: CaseStyle) => void
  onOpenImporter: () => void
}

export function Settings(props: Props) {
  return (
    <Sheet open={props.open} onClose={props.onClose} title="Settings" label="Settings" z={40}>
      <SettingsBody {...props} />
    </Sheet>
  )
}

function SettingsBody({ caseStyle, onCaseStyle, onOpenImporter }: Props) {
  const count = useLive(() => db.movies.count(), [], 0)
  const pending = useLive(() => db.movies.where('scoresStatus').equals('pending').count(), [], 0)
  const uncached = useLive(async () => (await db.movies.toArray()).filter((m) => !m.posterBlob).length, [], 0)
  const lastBackup = useLive(() => getLastBackup(), [], undefined as number | undefined)
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState('')
  const [tilt, setTilt] = useState(tiltWanted())
  const [confirmSeed, setConfirmSeed] = useState(false)
  const [reviewsJson, setReviewsJson] = useState('')
  const file = useRef<HTMLInputElement>(null)


  const run = async (label: string, fn: () => Promise<string | void>) => {
    setBusy(label)
    setMsg('')
    try {
      const r = await fn()
      if (r) setMsg(r)
    } catch (e) {
      setMsg((e as Error).message)
    } finally {
      setBusy('')
    }
  }

  return (
    <div className="settings">
      <section>
        <h2>Shelf</h2>
        <div className="row">
          <span>Case style</span>
          <div className="seg" role="radiogroup" aria-label="Case style">
            {(['cd', 'dvd'] as const).map((s) => (
              <button key={s} role="radio" aria-checked={caseStyle === s} className={caseStyle === s ? 'is-on' : ''} onClick={() => onCaseStyle(s)}>
                {s === 'cd' ? 'CD' : 'DVD'}
              </button>
            ))}
          </div>
        </div>
        {tiltSupported && (
          <div className="row">
            <span>
              Tilt glare
              <small>The glare follows how you tilt the phone</small>
            </span>
            {tilt ? (
              <button className="btn btn--small" onClick={() => (disableTilt(), setTilt(false))}>
                Turn off
              </button>
            ) : (
              <button
                className="btn btn--small btn--primary"
                onClick={async () => {
                  const ok = await enableTilt()
                  setTilt(ok)
                  if (!ok) setMsg(tiltNeedsPermission ? 'Motion access was not allowed.' : 'No motion sensor found.')
                }}
              >
                Enable
              </button>
            )}
          </div>
        )}
        {(crashCount() > 0 || document.querySelector('.app.perf-lite')) && (
          <div className="row">
            <span>
              Lite mode is on
              <small>
                {crashCount() > 0
                  ? `The app ran out of memory ${crashCount()}× on this device, so heavy effects are off.`
                  : 'Turned on because animation was running slowly on this device.'}
              </small>
            </span>
            <button
              className="btn btn--small"
              onClick={() => {
                resetSafeMode()
                location.reload()
              }}
            >
              Turn off
            </button>
          </div>
        )}
        <div className="row">
          <span>
            {count} movie{count === 1 ? '' : 's'}
            {(pending > 0 || uncached > 0) && (
              <small>
                {pending > 0 && `${pending} waiting for critic scores. `}
                {uncached > 0 && `${uncached} poster${uncached === 1 ? '' : 's'} not saved offline yet.`}
              </small>
            )}
          </span>
          {(pending > 0 || uncached > 0) && (
            <button className="btn btn--small" disabled={!!busy} onClick={() => run('sync', async () => (await syncPending(), 'Done.'))}>
              {busy === 'sync' ? <Spinner size={14} /> : 'Retry now'}
            </button>
          )}
        </div>
      </section>

      <section>
        <h2>Backup</h2>
        <p className="muted">
          Reinstalling a sideloaded app can wipe its data. Export regularly and keep the file somewhere safe (Files, iCloud Drive).
        </p>
        <div className="row">
          <span>
            Last backup
            <small>{lastBackup ? new Date(lastBackup).toLocaleString() : 'Never'}</small>
          </span>
        </div>
        <div className="btnrow">
          <button className="btn btn--primary" disabled={!!busy || !count} onClick={() => run('export', async () => {
            const r = await exportJson()
            return r === 'cancelled' ? '' : `Exported ${count} movies.`
          })}>
            {busy === 'export' ? <Spinner size={16} /> : 'Export JSON'}
          </button>
          <button className="btn" disabled={!!busy} onClick={() => file.current?.click()}>
            {busy === 'import' ? <Spinner size={16} /> : 'Import JSON'}
          </button>
          <input
            ref={file}
            type="file"
            accept="application/json,.json"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0]
              e.target.value = ''
              if (f)
                run('import', async () => {
                  const r = await importJson(await f.text())
                  return `Added ${r.added}, updated ${r.updated}, unchanged ${r.skipped}.`
                })
            }}
          />
        </div>
      </section>

      <section>
        <h2>Old catalog</h2>
        <p className="muted">
          Your ILOVEMOVIES catalog ships with the app. Re-import merges it back in: missing titles are added and
          details refreshed, but ratings or reviews you changed here, and movies you added, are kept.
        </p>
        <div className="btnrow">
          <button className="btn" disabled={!!busy} onClick={() => setConfirmSeed(true)}>
            {busy === 'seed' ? <Spinner size={16} /> : 'Re-import seed'}
          </button>
          <button className="btn" onClick={onOpenImporter}>
            Import another list…
          </button>
        </div>
      </section>

      <section>
        <h2>Import old reviews</h2>
        <p className="muted">
          Your written reviews were saved in the old site's browser storage. Open the old site, press F12 → Console,
          run this line (it copies them to the clipboard), then paste below.
        </p>
        <div className="snippet" data-noswipe>
          <code>{OLD_REVIEWS_SNIPPET}</code>
          <button
            className="btn btn--small"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(OLD_REVIEWS_SNIPPET)
                setMsg('Snippet copied.')
              } catch {
                setMsg('Select the line and copy it manually.')
              }
            }}
          >
            Copy
          </button>
        </div>
        <textarea
          className="paste"
          rows={5}
          placeholder='{"mfm_review_27205": {"tmdbId": 27205, "reviewText": "…", "mihirScore": 10}}'
          value={reviewsJson}
          onChange={(e) => setReviewsJson(e.target.value)}
        />
        <button
          className="btn btn--primary"
          style={{ marginTop: 10 }}
          disabled={!reviewsJson.trim() || !!busy}
          onClick={() =>
            run('reviews', async () => {
              const r = await importOldReviews(reviewsJson)
              setReviewsJson('')
              return `Imported ${r.matched + r.inCollections} reviews${r.inCollections ? ` (${r.inCollections} on films inside collections)` : ''}.${
                r.unmatched.length ? ` Not on the shelf: TMDB ${r.unmatched.join(', ')}.` : ''
              }`
            })
          }
        >
          {busy === 'reviews' ? <Spinner size={16} /> : 'Import reviews'}
        </button>
      </section>

      <Confirm
        open={confirmSeed}
        title="Re-import your old catalog?"
        body="Adds anything missing and refreshes posters and details. Your own edits and additions stay."
        confirmLabel="Re-import"
        onCancel={() => setConfirmSeed(false)}
        onConfirm={() => {
          setConfirmSeed(false)
          run('seed', async () => {
            const r = await mergeSeed()
            void syncPending()
            return `Added ${r.added}, refreshed ${r.refreshed}${r.keptEdits ? ` (kept your edits on ${r.keptEdits})` : ''}.`
          })
        }}
      />

      {msg && <div className="toast" role="status">{msg}</div>}
    </div>
  )
}
