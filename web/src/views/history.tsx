// History: what happened, when, and for how long. One timeline for alerts,
// backup runs, restore drills and failed jobs; a flapping alert is one row.
import { useMemo, useState } from 'preact/hooks'
import type { ViewProps } from '../app'
import type { Incident } from '../types'
import { alertHistogram, durationWords, events, foldRepeats, prioLevel, type Event, type EventKind } from '../derive'
import { clock, dateTime, dayLabel, ms, plural } from '../format'
import { Btn, Empty, Figures, Glyph, Hist, PageHead, Section, Seg } from '../components/ui'
import { IconBack, IconChevron } from '../components/icons'

type F = 'all' | 'alerts' | 'backups' | 'jobs'
const FILTERS: Record<F, EventKind[]> = { all: ['alert', 'backup', 'drill', 'timer'], alerts: ['alert'], backups: ['backup', 'drill'], jobs: ['timer'] }

export function HistoryView(p: ViewProps) {
  const { snap, now, route } = p
  const [f, setF] = useState<F>('all')
  const all = useMemo(() => foldRepeats(events(snap), now), [snap, Math.floor(now / 60000)])
  if (route[1] === 'alert' && route[2]) return <IncidentDetail {...p} k={route[2]} />
  // a backup that went fine is routine: in "All" only the last two days show it
  const routine = (e: Event) => e.kind === 'backup' && e.level === 'ok' && now - e.t > 48 * 3600e3
  const list = all.filter((e) => FILTERS[f].includes(e.kind) && !(f === 'all' && routine(e)))
  const hidden = f === 'all' ? all.filter(routine).length : 0
  const days: { label: string; items: Event[] }[] = []
  for (const e of list) {
    const label = dayLabel(new Date(e.t).toISOString(), now)
    const last = days[days.length - 1]
    if (last && last.label === label) last.items.push(e)
    else days.push({ label, items: [e] })
  }
  const real = snap.alerts.incidents.filter((i) => i.state !== 'info')
  const cleared = real.filter((i) => i.resolved).map((i) => ms(i.resolved!) - ms(i.opened)).sort((a, b) => a - b)
  const median = cleared.length ? cleared[Math.floor(cleared.length / 2)] : NaN
  const open = snap.alerts.open.length
  return (
    <div>
      <PageHead title="History" sub="Alerts, backup runs, restore drills and failed jobs, newest first. An alert that fires again and again on one day is folded into one row."
        aside={<Seg label="Show" value={f} onChange={setF} options={[['all', 'All'], ['alerts', 'Alerts'], ['backups', 'Backups'], ['jobs', 'Jobs']]} />} />
      <Figures items={[
        { label: 'Open now', value: open || 'None', caption: open ? snap.alerts.open[0].title : 'nothing waiting', level: open ? (snap.alerts.level === 'info' ? undefined : snap.alerts.level) : undefined },
        { label: 'Pushes, 24 h', value: snap.alerts.sent_24h, caption: 'sent to your phone' },
        { label: 'Pushes, 7 days', value: snap.alerts.sent_7d, caption: `${plural(real.length, 'alert')} in 30 days` },
        { label: 'Time to all-clear', ...clearTime(median), caption: 'median, cleared alerts' },
      ]} />
      <Section title="Alerts per day" aside={<span>the last 30 days</span>}>
        <div class="panel">
          <Hist bins={alertHistogram(real, now, 30)} h={56} />
          <div class="chart-lbl"><span>30 days ago</span><span>today</span></div>
        </div>
      </Section>
      {days.length === 0 && <Empty>Nothing in the last 30 days.</Empty>}
      {days.map((d) => (
        <Section key={d.label} title={d.label} aside={plural(d.items.length, 'event')}>
          <div class="rows">
            {d.items.map((e) => {
              const lv = e.level === 'off' ? 'ok' : e.level
              return (
                <a key={e.id} class={`row ${lv}`} href={e.href} style={{ gridTemplateColumns: '44px 16px minmax(0,1fr) auto 14px' }}>
                  <span class="num muted" style={{ fontSize: '12px' }}>{clock(new Date(e.t).toISOString())}</span>
                  <Glyph level={lv} size={14} />
                  <span class="main-col">
                    <span class="ttl"><span>{e.title}</span></span>
                    {e.sub && <span class="sub">{e.sub}</span>}
                  </span>
                  <span class="end">{e.count && e.count > 1 ? `${e.count}×` : e.end ? durationWords(e.end - e.t) : ''}</span>
                  <IconChevron size={14} />
                </a>
              )
            })}
          </div>
        </Section>
      ))}
      {hidden > 0 && <p class="note-line">{plural(hidden, 'older nightly backup')} went fine and {hidden === 1 ? 'is' : 'are'} not listed here. <button type="button" class="linklike" onClick={() => setF('backups')}>Show them</button></p>}
    </div>
  )
}

/** A median duration as a figure: the number and its unit apart. */
function clearTime(d: number): { value: string | number; unit?: string } {
  if (!isFinite(d)) return { value: '—' }
  const m = Math.round(d / 60000)
  if (m < 1) return { value: '<1', unit: 'min' }
  if (m < 60) return { value: m, unit: 'min' }
  const h = Math.round(m / 60)
  return h < 48 ? { value: h, unit: h === 1 ? 'hour' : 'hours' } : { value: Math.round(h / 24), unit: 'days' }
}

function IncidentDetail({ snap, now, k }: ViewProps & { k: string }) {
  const all = snap.alerts.incidents.filter((i) => i.key === k)
  const i: Incident | undefined = all[0]
  if (!i) return <Empty>No alert with the key <code>{k}</code> in the last 30 days. <a class="linklike" href="#/history">History</a></Empty>
  const lv = i.state === 'open' ? prioLevel(i.prio) : 'ok'
  const rb = i.runbook ? snap.runbooks.find((r) => r.id === i.runbook) : undefined
  return (
    <div>
      <a class="back" href="#/history"><IconBack size={14} /> History</a>
      <PageHead title={i.title} sub={i.state === 'open'
        ? <span class={`state ${lv}`}><Glyph level={lv} size={13} />Open for {durationWords(now - ms(i.opened))}</span>
        : i.resolved ? <>Cleared after {durationWords(ms(i.resolved) - ms(i.opened))}.</> : <>{i.state}</>}
        aside={rb && <Btn href={`#/runbooks/${encodeURIComponent(rb.id)}`} primary>Open the checklist</Btn>} />
      <Figures items={[
        { label: 'Fired', value: all.length, unit: all.length === 1 ? 'time' : 'times', caption: 'in the last 30 days' },
        { label: 'Pushes sent', value: i.sends, caption: 'for this alert' },
        { label: 'Repeats held back', value: i.suppressed, caption: 'so you got one push' },
        { label: 'Pushes failed', value: i.failed, caption: i.failed ? 'may not have reached you' : 'all delivered', level: i.failed ? 'warn' : undefined },
      ]} />
      <Section title="Details">
        <dl class="kv">
          <dt>Key</dt><dd><code>{i.key}</code></dd>
          <dt>Priority</dt><dd>{i.prio || 'default'}</dd>
          <dt>Opened</dt><dd>{dateTime(i.opened)}</dd>
          {i.resolved && <><dt>Cleared</dt><dd>{dateTime(i.resolved)}</dd></>}
        </dl>
      </Section>
      {all.length > 1 && (
        <Section title="Every time it fired">
          <div class="rows">
            {all.map((x) => (
              <div key={x.opened} class="row" style={{ gridTemplateColumns: '44px minmax(0,1fr) auto' }}>
                <span class="num muted" style={{ fontSize: '12px' }}>{clock(x.opened)}</span>
                <span class="main-col"><span class="ttl"><span>{dayLabel(x.opened, now)}</span></span><span class="sub">{x.resolved ? `cleared after ${durationWords(ms(x.resolved) - ms(x.opened))}` : x.state}</span></span>
                <span />
              </div>
            ))}
          </div>
        </Section>
      )}
    </div>
  )
}
