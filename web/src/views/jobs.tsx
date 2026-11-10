// Jobs: what the server does by itself, when it runs next, and whether the
// last run went well.
import { useState } from 'preact/hooks'
import type { ViewProps } from '../app'
import type { Snapshot, Timer } from '../types'
import { isFrequent, notableTimers, sortTimers } from '../derive'
import { ago, clock, inAbout, plural } from '../format'
import { Empty, Figures, Glyph, PageHead, Section, Seg, useTip } from '../components/ui'

type F = 'homelab' | 'all'

export function JobsView({ snap, now }: ViewProps) {
  const [f, setF] = useState<F>('homelab')
  const homelab = snap.timers.filter((t) => t.highlight)
  const list = sortTimers(snap.timers, f === 'homelab')
  const failed = homelab.filter((t) => t.result === 'failed')
  const disabled = homelab.filter((t) => t.enabled && t.enabled !== 'enabled' && t.enabled !== 'static')
  const next = notableTimers(snap.timers)[0]
  return (
    <div>
      <PageHead title="Jobs" sub="Scheduled jobs from systemd timers. The homelab's own jobs are the ones Vesper watches; the rest come with the system."
        aside={<Seg label="Show" value={f} onChange={setF} options={[['homelab', `Homelab (${homelab.length})`], ['all', `All timers (${snap.timers.length})`]]} />} />
      <Figures items={[
        { label: 'Homelab jobs', value: homelab.length, caption: `${plural(snap.timers.length - homelab.length, 'system timer')} besides` },
        { label: 'Last runs failed', value: failed.length, caption: failed.length ? failed.map(name).join(', ') : 'every last run fine', level: failed.length ? 'warn' : undefined },
        { label: 'Disabled', value: disabled.length, caption: disabled.length ? disabled.map(name).join(', ') : 'all enabled', level: disabled.length ? 'warn' : undefined },
        { label: 'Next', value: next?.next ? clock(next.next) : '—', caption: next ? name(next) : 'nothing scheduled' },
      ]} />
      <Section title="The next 24 hours">
        <Lane snap={snap} now={now} />
      </Section>
      {list.length === 0 && <Empty left>No timers found.</Empty>}
      {list.some((t) => !frequent(t)) && (
        <Section title="Daily and weekly" aside={<span>soonest first</span>}>
          <div class="rows">{list.filter((t) => !frequent(t)).map((t) => <JobRow key={t.unit} t={t} now={now} />)}</div>
        </Section>
      )}
      {list.some(frequent) && (
        <Section title="Every few minutes">
          <div class="rows">{list.filter(frequent).map((t) => <JobRow key={t.unit} t={t} now={now} />)}</div>
        </Section>
      )}
    </div>
  )
}

const name = (t: Timer) => t.description || t.activates.replace(/\.service$/, '')
const frequent = isFrequent

function JobRow({ t, now }: { t: Timer; now: number }) {
  const lv = t.level === 'info' ? 'ok' : t.level
  const off = t.enabled && t.enabled !== 'enabled' && t.enabled !== 'static'
  return (
    <div class={`row ${lv}`} style={{ gridTemplateColumns: '16px minmax(0,1fr) auto' }}>
      <Glyph level={lv} size={14} />
      <span class="main-col">
        <span class="ttl"><span>{name(t)}</span></span>
        <span class="sub"><code>{t.unit}</code> · <span class="nb">{t.last ? `last ${ago(t.last, now)}${t.result && t.result !== 'success' ? `, ${t.result}` : ''}` : 'has not run yet'}</span>{off ? <> · <span class="nb">{t.enabled}</span></> : ''}</span>
      </span>
      <span class="end stack">{t.next ? <>{clock(t.next)}<small>{inAbout(t.next, now)}</small></> : <small>not scheduled</small>}</span>
    </div>
  )
}

/** Every job in the next 24 hours on one line, so collisions show: tall
 *  marks are the homelab's jobs, short ones the system's. */
function Lane({ snap, now }: { snap: Snapshot; now: number }) {
  const [tip, setTip] = useTip()
  const span = 24 * 3600e3
  const soon = sortTimers(snap.timers, false).filter((t) => { const d = t.next ? Date.parse(t.next) - now : NaN; return d >= 0 && d <= span })
  const jobs = soon.filter((t) => !frequent(t))
  const many = soon.length - jobs.length
  if (!jobs.length) return <Empty left>Nothing is scheduled in the next 24 hours.</Empty>
  return (
    <div class="lane">
      <div class="lane-line">
        {jobs.map((t) => (
          <i key={t.unit} role="img" aria-label={`${clock(t.next)} ${name(t)}`} class={`lane-job${t.highlight ? ' hl' : ''}${t.level === 'warn' ? ' warn' : ''}`} style={{ left: `${((Date.parse(t.next!) - now) / span) * 100}%` }}
            tabIndex={0} onFocus={(e) => setTip(<><b>{clock(t.next)}</b> · {name(t)}</>, e as unknown as FocusEvent)} onBlur={() => setTip(null)}
            onMouseMove={(e) => setTip(<><b>{clock(t.next)}</b> · {name(t)}</>, e as unknown as MouseEvent)} onClick={(e) => setTip(<><b>{clock(t.next)}</b> · {name(t)}</>, e as unknown as MouseEvent)} onMouseLeave={() => setTip(null)} />
        ))}
      </div>
      <div class="axis">
        {[0, 6, 12, 18, 24].map((h) => (
          <span key={h} class={h === 0 ? 'l' : h === 24 ? 'r' : h % 12 ? 'opt' : ''} style={{ left: `${(h / 24) * 100}%` }}>{h === 0 ? 'now' : clock(new Date(now + h * 3600e3).toISOString())}</span>
        ))}
      </div>
      {tip}
      <p class="lane-note">{plural(jobs.length, 'run')} in the next 24 hours; tall marks are homelab jobs.{many > 0 ? ` Not drawn: ${plural(many, 'job')} that run${many === 1 ? 's' : ''} every few minutes.` : ''}</p>
    </div>
  )
}
