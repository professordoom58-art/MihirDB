import { useRef, useState } from 'react'
import { exportJson, getLastBackup, importJson } from '../lib/backup'
import { db, useLive } from '../lib/db'
import { syncPending } from '../lib/sync'
import { crashCount, isLiteMode, setLiteMode } from '../lib/perf'
import { Sheet, Spinner } from './ui'

interface Props {
  open: boolean
  onClose: () => void
}

export function Settings(props: Props) {
  return (
    <Sheet open={props.open} onClose={props.onClose} title="Settings" label="Settings" z={40}>
      <SettingsBody />
    </Sheet>
  )
}

function SettingsBody() {
  const count = useLive(() => db.movies.count(), [], 0)
  const pending = useLive(() => db.movies.where('scoresStatus').equals('pending').count(), [], 0)
  const uncached = useLive(async () => (await db.movies.toArray()).filter((m) => !m.posterBlob).length, [], 0)
  const lastBackup = useLive(() => getLastBackup(), [], undefined as number | undefined)
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState('')
  const [lite, setLite] = useState(isLiteMode)
  const crashes = crashCount()
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
        {/* always visible, in both states */}
        <div className="row">
          <span>
            Lite mode
            <small>
              {lite
                ? crashes > 0
                  ? `On. The app ran out of memory ${crashes}× on this device, so heavy effects are off.`
                  : 'On: lighter effects for smoother scrolling.'
                : 'Off: full effects.'}
            </small>
          </span>
          <button
            role="switch"
            aria-checked={lite}
            aria-label="Lite mode"
            className={`switch${lite ? ' is-on' : ''}`}
            onClick={() => {
              setLiteMode(!lite)
              setLite(!lite)
            }}
          >
            <span className="switch__knob" />
          </button>
        </div>
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
          Reinstalling a sideloaded app can wipe its data. Export a backup regularly and keep the file somewhere safe
          (Files, iCloud Drive). Import a backup to restore it; your current shelf is merged, not replaced.
        </p>
        <div className="row">
          <span>
            Last backup
            <small>{lastBackup ? new Date(lastBackup).toLocaleString() : 'Never'}</small>
          </span>
        </div>
        <div className="btnrow">
          <button
            className="btn btn--primary"
            disabled={!!busy || !count}
            onClick={() =>
              run('export', async () => {
                const r = await exportJson()
                return r === 'cancelled' ? '' : `Exported ${count} movies.`
              })
            }
          >
            {busy === 'export' ? <Spinner size={16} /> : 'Export backup'}
          </button>
          <button className="btn" disabled={!!busy} onClick={() => file.current?.click()}>
            {busy === 'import' ? <Spinner size={16} /> : 'Import backup'}
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
                  return `Backup imported: added ${r.added}, updated ${r.updated}, unchanged ${r.skipped}.`
                })
            }}
          />
        </div>
      </section>

      {msg && (
        <div className="toast" role="status">
          {msg}
        </div>
      )}
    </div>
  )
}
