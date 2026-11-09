// History: what happened, when, and for how long. One timeline for alerts,
// backup runs, restore drills and failed jobs; a flapping alert is one row.
import { useMemo, useState } from 'preact/hooks'
import type { ViewProps } from '../app'
import type { Incident } from '../types'
import { alertHistogram, durationWords, events, foldRepeats, prioLevel, type EventKind } from '../derive'
import { clock, dateTime, dayLabel, ms, plural } from '../format'
import { Bars, Btn, Empty, Figure, Glyph, PageHead, Section } from '../components/ui'
import { IconBack, IconChevron } from '../components/icons'

const FILTERS: [string, string, EventKind[]][] = [
  ['all', 'All', ['alert', 'backup', 'drill', 'timer']],
  ['alerts', 'Alerts', ['alert']],
  ['backups', 'Backups', ['backup', 'drill']],
  ['jobs', 'Jobs', ['timer']],
]

export function HistoryView(p: ViewProps) {
  const { snap, now, route } = p
  const [f, setF] = useState('all')
  const all = useMemo(() => foldRepeats(events(snap), now), [snap, Math.floor(now / 60000)])
  if (route[1] === 'alert' && route[2]) return <IncidentDetail {...p} k={route[2]} />
  const kinds = FILTERS.find((x) => x[0] === f)![2]
  // a backup that went fine is routine: in "All" only the last two days show
  // it, the Backups filter keeps every night
  const routine = (e: (typeof all)[number]) => e.kind === 'backup' && e.level === 'ok' && now - e.t > 48 * 3600e3
  const list = all.filter((e) => kinds.includes(e.kind) && !(f === 'all' && routine(e)))
  const hidden = f === 'all' ? all.filter(routine).length : 0
  const days: { label: string; items: typeof list }[] = []
  for (const e of list) {
    const label = dayLabel(new Date(e.t).toISOString(), now)
    const last = days[days.length - 1]
    if (last && last.label === label) last.items.push(e)
    else days.push({ label, items: [e] })
  }
  const real = snap.alerts.incidents.filter((i) => i.state !== 'info')
  const cleared = real.filter((i) => i.resolved).map((i) => ms(i.resolved!) - ms(i.opened)).sort((a, b) => a - b)
  const median = cleared.length ? cleared[Math.floor(cleared.length / 2)] : NaN
  return (
    <div>
      <PageHead title="History" sub="Alerts, backup runs, restore drills and failed jobs, newest first. An alert that fires again and again on one day is folded into one row."
        aside={(
          <div class="seg" role="tablist" aria-label="Show">
            {FILTERS.map(([k, l]) => <button key={k} type="button" role="tab" aria-selected={f === k} class={f === k ? 'on' : ''} onClick={() => setF(k)}>{l}</button>)}
          </div>
        )} />
      <div class="figs">
        <Figure value={snap.alerts.open.length || 'None'} caption="open now" level={snap.alerts.open.length ? snap.alerts.level : undefined} />
        <Figure value={snap.alerts.sent_24h} caption="pushes in 24 hours" />
        <Figure value={snap.alerts.sent_7d} caption="pushes in 7 days" />
        <Figure value={isFinite(median) ? durationWords(median) : '—'} caption="median time to all-clear" />
      </div>
      <Section title="Alerts per day, the last 30 days">
        <div class="pane pad"><Bars bins={alertHistogram(real, now, 30)} h={48} /><div class="axis"><span>30 days ago</span><span>today</span></div></div>
      </Section>
      {days.length === 0 && <Empty>Nothing in the last 30 days.</Empty>}
      {days.map((d) => (
        <Section key={d.label} title={d.label}>
          <div class="rows">
            {d.items.map((e) => {
              const lit = e.level === 'crit' ? ' lit lit-down' : e.level === 'warn' ? ' lit lit-attn' : ''
              return (
                <a key={e.id} class={`row ev${lit}`} href={e.href}>
                  <span class="ev-time">{clock(new Date(e.t).toISOString())}</span>
                  <Glyph level={e.level === 'off' ? 'ok' : e.level} size={14} />
                  <span class="row-main">
                    <span class="row-title">{e.title}{e.count && e.count > 1 ? <span class="count">{e.count}×</span> : null}</span>
                    {e.sub && <span class="row-sub">{e.sub}</span>}
                  </span>
                  <IconChevron size={16} />
                </a>
              )
            })}
          </div>
        </Section>
      ))}
      {hidden > 0 && <p class="routine-note">{plural(hidden, 'older nightly backup')} went fine and {hidden === 1 ? 'is' : 'are'} not listed here. <button type="button" class="linklike" onClick={() => setF('backups')}>Show them</button></p>}
    </div>
  )
}

function IncidentDetail({ snap, now, k }: ViewProps & { k: string }) {
  const all = snap.alerts.incidents.filter((i) => i.key === k)
  const i: Incident | undefined = all[0]
  if (!i) return <Empty>No alert with the key <code>{k}</code> in the last 30 days. <a href="#/history">History</a></Empty>
  const lv = i.state === 'open' ? prioLevel(i.prio) : 'ok'
  const rb = i.runbook ? snap.runbooks.find((r) => r.id === i.runbook) : undefined
  return (
    <div class="detail">
      <a class="back" href="#/history"><IconBack size={16} /> History</a>
      <PageHead title={i.title} sub={i.state === 'open'
        ? <span class={`st-${lv}`}>Open for {durationWords(now - ms(i.opened))}.</span>
        : i.resolved ? <>Cleared after {durationWords(ms(i.resolved) - ms(i.opened))}.</> : <>{i.state}</>}
        aside={rb && <Btn href={`#/runbooks/${encodeURIComponent(rb.id)}`} primary>Open the checklist</Btn>} />
      <div class="figs">
        <Figure value={plural(all.length, 'time')} caption="in the last 30 days" />
        <Figure value={i.sends} caption={i.sends === 1 ? 'push sent' : 'pushes sent'} />
        <Figure value={i.suppressed} caption="repeats held back" />
        <Figure value={i.failed} caption="pushes that failed" level={i.failed ? 'warn' : undefined} />
      </div>
      <Section title="Facts">
        <dl class="facts pane">
          <div><dt>Key</dt><dd><code>{i.key}</code></dd></div>
          <div><dt>Priority</dt><dd>{i.prio || 'default'}</dd></div>
          <div><dt>Opened</dt><dd>{dateTime(i.opened)}</dd></div>
          {i.resolved && <div><dt>Cleared</dt><dd>{dateTime(i.resolved)}</dd></div>}
        </dl>
      </Section>
      {all.length > 1 && (
        <Section title="Every time it fired">
          <div class="rows">
            {all.map((x) => (
              <div key={x.opened} class="row static">
                <span class="ev-time">{clock(x.opened)}</span>
                <span class="row-main"><span class="row-title">{dayLabel(x.opened, now)}</span><span class="row-sub">{x.resolved ? `cleared after ${durationWords(ms(x.resolved) - ms(x.opened))}` : x.state}</span></span>
              </div>
            ))}
          </div>
        </Section>
      )}
    </div>
  )
}
