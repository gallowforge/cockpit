import { useState } from 'preact/hooks'
import type { ViewProps } from '../app'
import type { Timer } from '../types'
import { sortTimers } from '../derive'
import { ago, dateTime, duration, ms, until } from '../format'
import { Dot, PageHead, Pill, RunStrip } from '../components/ui'

export function TimersView({ snap, now }: ViewProps) {
  const [all, setAll] = useState(false)
  const [open, setOpen] = useState<string | null>(null)
  const list = sortTimers(snap.timers, !all)
  const failed = snap.timers.filter((t) => t.result === 'failed').length
  const hl = snap.timers.filter((t) => t.highlight).length
  return (
    <div>
      <PageHead
        title="Timers"
        sub={`${snap.timers.length} systemd timers, ${hl} of them the homelab's own · ${failed} failed on their last run · no cron`}
        right={
          <div class="seg">
            <button type="button" class={!all ? 'on' : ''} onClick={() => setAll(false)}>Homelab</button>
            <button type="button" class={all ? 'on' : ''} onClick={() => setAll(true)}>All</button>
          </div>
        }
      />
      <div class="timer-table">
        <div class="timer-head">
          <span>Job</span><span>Next</span><span>Last</span><span>Result</span>
        </div>
        {list.map((t) => (
          <TimerRow key={t.unit} t={t} now={now} open={open === t.unit} toggle={() => setOpen(open === t.unit ? null : t.unit)} />
        ))}
      </div>
    </div>
  )
}

function TimerRow({ t, now, open, toggle }: { t: Timer; now: number; open: boolean; toggle: () => void }) {
  const soon = t.next ? ms(t.next) - now < 60_000 : false
  const level = t.result === 'failed' ? 'warn' : t.enabled && t.enabled !== 'enabled' && t.enabled !== 'static' ? 'warn' : 'ok'
  return (
    <div class={`timer-item${open ? ' open' : ''}`}>
      <button type="button" class="timer-line" onClick={toggle} aria-expanded={open}>
        <span class="timer-job">
          <Dot level={t.result === 'running' ? 'info' : level} size={8} pulse={t.result === 'running'} />
          <span>
            <span class="timer-name">{t.activates.replace(/\.service$/, '')}</span>
            <span class="timer-desc">{t.description}</span>
          </span>
        </span>
        <span class={`mono timer-next${soon ? ' soon' : ''}`}>{until(t.next, now)}</span>
        <span class="muted">{ago(t.last, now)}</span>
        <span>
          {t.result === 'failed' ? <Pill level="warn">failed</Pill> : t.result === 'running' ? <Pill level="info">running</Pill> : t.last ? <Pill level="ok">ok</Pill> : <span class="muted">—</span>}
          {t.enabled && t.enabled !== 'enabled' && t.enabled !== 'static' && <Pill level="warn">{t.enabled}</Pill>}
        </span>
      </button>
      {open && (
        <div class="timer-more">
          <dl>
            <div><dt>Timer</dt><dd class="mono">{t.unit}</dd></div>
            <div><dt>Runs</dt><dd class="mono">{t.activates}</dd></div>
            <div><dt>Next</dt><dd>{dateTime(t.next)}</dd></div>
            <div><dt>Last</dt><dd>{dateTime(t.last)}</dd></div>
            <div><dt>Enabled</dt><dd>{t.enabled || '—'}</dd></div>
          </dl>
          {t.runs && t.runs.length > 0 ? (
            <div class="timer-runs">
              <div class="muted">Recent runs (journal)</div>
              <RunStrip runs={t.runs} n={Math.min(30, Math.max(14, t.runs.length))} />
              <ul class="run-lines">
                {t.runs.slice(0, 5).map((r) => (
                  <li key={r.start}>
                    <Dot level={r.result === 'success' ? 'ok' : r.result === 'failed' ? 'crit' : 'info'} size={7} />
                    <span class="mono">{dateTime(r.start)}</span>
                    <span class="muted">{duration(r.start, r.end)}</span>
                    <span class="run-sum">{r.summary}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p class="hint">Add the service to [timers] history in cockpit.conf to keep its runs here.</p>
          )}
        </div>
      )}
    </div>
  )
}
