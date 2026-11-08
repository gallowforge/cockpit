import { useState } from 'preact/hooks'
import type { ViewProps } from '../app'
import type { Incident } from '../types'
import { alertHistogram, byDay, prioLevel } from '../derive'
import { ago, clock, duration, ms, short } from '../format'
import { Card, Dot, PageHead, Pill, RunbookLink, Stat } from '../components/ui'

const prioWord: Record<string, string> = { urgent: 'urgent', high: 'high', default: 'default', low: 'low', min: 'min' }

export function AlertsView({ snap, now }: ViewProps) {
  const a = snap.alerts
  const [showInfo, setShowInfo] = useState(false)
  const list = a.incidents.filter((i) => showInfo || i.state !== 'info')
  const groups = byDay(list, now)
  const bins = alertHistogram(a.incidents.filter((i) => i.state !== 'info'), now, 30)
  const peak = Math.max(1, ...bins.map((b) => b.crit + b.warn + b.info))
  const resolved = a.incidents.filter((i) => i.state === 'resolved' && i.resolved)
  const mttr = resolved.length
    ? resolved.map((i) => ms(i.resolved) - ms(i.opened)).sort((x, y) => x - y)[Math.floor(resolved.length / 2)]
    : NaN
  const title = (id?: string) => snap.runbooks.find((r) => r.id === id)?.title
  const open = a.incidents.filter((i) => i.state === 'open')
  const stale = a.incidents.filter((i) => i.state === 'stale')

  return (
    <div>
      <PageHead
        title="Alerts"
        sub="Every push the notifier sent, grouped into incidents: when each opened, how often it repeated, and when the all-clear went out."
      />
      <div class="stats-row">
        <Stat label="Open now" value={`${open.length}`} level={a.level === 'ok' ? undefined : a.level} sub={open.length ? open.map((i) => i.key).join(', ') : 'nothing waiting'} />
        <Stat label="Sent in 24 h" value={`${a.sent_24h}`} sub="pushes to the phone" />
        <Stat label="Sent in 7 days" value={`${a.sent_7d}`} sub="deduplicated per key" />
        <Stat label="Median time to all-clear" value={isFinite(mttr) ? short(mttr) : '—'} sub={`over ${resolved.length} resolved`} />
      </div>

      {(open.length > 0 || stale.length > 0) && (
        <Card title="Open incidents" class="mt">
          <ul class="inc-list">
            {[...open, ...stale].map((i) => <IncidentRow key={i.key + i.opened} i={i} now={now} rb={title(i.runbook)} />)}
          </ul>
        </Card>
      )}

      <Card title={<>Last 30 days</>} class="mt">
        <div class="hist hist-tall">
          {bins.map((b) => (
            <div class="hist-col" key={b.t} title={`${new Date(b.t).toDateString()}: ${b.crit + b.warn + b.info}`}>
              <div class="hist-stack" style={{ height: `${((b.crit + b.warn + b.info) / peak) * 100}%` }}>
                {b.crit > 0 && <span class="lv-bg-crit" style={{ flex: b.crit }} />}
                {b.warn > 0 && <span class="lv-bg-warn" style={{ flex: b.warn }} />}
                {b.info > 0 && <span class="lv-bg-info" style={{ flex: b.info }} />}
              </div>
            </div>
          ))}
        </div>
        <div class="hist-axis"><span>30 days ago</span><span class="legend"><span><i class="lv-bg-crit" />high</span><span><i class="lv-bg-warn" />default</span><span><i class="lv-bg-info" />low</span></span><span>today</span></div>
      </Card>

      <div class="timeline-head">
        <h2 class="group-title">Timeline</h2>
        <label class="toggle">
          <input type="checkbox" checked={showInfo} onChange={(e) => setShowInfo((e.target as HTMLInputElement).checked)} />
          <span>Show routine notes</span>
        </label>
      </div>
      <div class="timeline">
        {groups.map((g) => (
          <section key={g.label} class="tl-day">
            <h3 class="tl-label">{g.label}</h3>
            <ul class="inc-list">
              {g.items.map((i) => <IncidentRow key={i.key + i.opened} i={i} now={now} rb={title(i.runbook)} />)}
            </ul>
          </section>
        ))}
        {groups.length === 0 && <p class="muted">No alerts in the journal window.</p>}
      </div>
    </div>
  )
}

function IncidentRow({ i, now, rb }: { i: Incident; now: number; rb?: string }) {
  const sev = i.state === 'info' || i.state === 'sent' ? 'info' : prioLevel(i.prio)
  const resolvedAfter = i.resolved ? duration(i.opened, i.resolved) : ''
  return (
    <li class={`inc st-${i.state}`}>
      <span class="inc-time mono">{clock(i.opened)}</span>
      <span class={`inc-rail lv-bg-${i.state === 'resolved' ? sev : sev}`} />
      <div class="inc-body">
        <div class="inc-title">
          {i.title}
          {i.prio && <span class={`prio p-${i.prio}`}>{prioWord[i.prio] ?? i.prio}</span>}
        </div>
        <div class="inc-meta">
          {i.key && <code>{i.key}</code>}
          {i.state === 'open' && <span>open for {ago(i.opened, now).replace(' ago', '')}</span>}
          {i.state === 'stale' && <span>no push for a while: likely fixed without an all-clear</span>}
          {i.state === 'resolved' && resolvedAfter !== '—' && resolvedAfter !== '' && <span>all-clear after {resolvedAfter}</span>}
          {i.sends > 1 && <span>sent {i.sends}×</span>}
          {i.suppressed > 0 && <span>{i.suppressed} repeats suppressed</span>}
          {i.failed > 0 && <span class="lv-text-warn">{i.failed} delivery failures</span>}
        </div>
      </div>
      <div class="inc-side">
        {i.state === 'open' && <Pill level={sev}>open</Pill>}
        {i.state === 'resolved' && <Dot level="ok" size={7} />}
        <RunbookLink id={i.runbook} title={rb} />
      </div>
    </li>
  )
}
