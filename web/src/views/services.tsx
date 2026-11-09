// Services: is each thing up, how has it been, how fast does it answer?
import { useState } from 'preact/hooks'
import type { ViewProps } from '../app'
import type { Service } from '../types'
import { groupServices, levelRank, uptimeOf } from '../derive'
import { ago, dateTime, ms, plural, precise } from '../format'
import { Btn, Empty, Figure, Glyph, PageHead, Section, Spark, Strip } from '../components/ui'
import { IconBack, IconChevron, IconExternal } from '../components/icons'
import { safeHref } from '../markdown'

function median(v: number[]): number | null {
  const x = v.filter((n) => n >= 0).sort((a, b) => a - b)
  if (!x.length) return null
  const m = Math.floor(x.length / 2)
  return x.length % 2 ? x[m] : (x[m - 1] + x[m]) / 2
}
function pctl(v: number[], p: number): number | null {
  const x = v.filter((n) => n >= 0).sort((a, b) => a - b)
  if (!x.length) return null
  return x[Math.min(x.length - 1, Math.floor((p / 100) * x.length))]
}

function stateText(s: Service, now: number): string | null {
  const since = s.since ? ` for ${ago(s.since, now).replace(' ago', '')}` : ''
  switch (s.state) {
    case 'down': return `Down${since}`
    case 'degraded': return `Degraded${since}`
    case 'unknown': return "Can't be confirmed"
    case 'off': return 'Off'
  }
  return null
}

export function Services(p: ViewProps) {
  const { snap, now, route } = p
  const [filter, setFilter] = useState<'all' | 'needs' | 'probed'>('all')
  if (route[1]) return <ServiceDetail {...p} id={route[1]} />
  const problems = snap.services.filter((s) => levelRank[s.level] >= levelRank.unknown)
  const list = snap.services.filter((s) => (filter === 'needs' ? levelRank[s.level] >= levelRank.unknown : filter === 'probed' ? !!s.probe : true))
  const groups = groupServices(list.filter((s) => filter !== 'all' || levelRank[s.level] < levelRank.unknown))
  const up = snap.services.filter((s) => s.state === 'up').length
  const counted = snap.services.filter((s) => s.state !== 'off').length
  return (
    <div>
      <PageHead title="Services" sub={<>{up} of {counted} up{problems.length ? <>, {plural(problems.length, 'needs', 'need')} you</> : ''}. Each strip is the last 30 minutes, one cell every 20 seconds.</>}
        aside={(
          <div class="seg" role="tablist" aria-label="Show">
            {([['all', 'All'], ['needs', 'Needs you'], ['probed', 'Probed']] as const).map(([k, l]) => (
              <button key={k} type="button" role="tab" aria-selected={filter === k} class={filter === k ? 'on' : ''} onClick={() => setFilter(k)}>{l}</button>
            ))}
          </div>
        )} />
      {filter === 'all' && problems.length > 0 && (
        <Section title="Needs you">
          <div class="rows">{problems.map((s) => <ServiceRow key={s.id} s={s} now={now} />)}</div>
        </Section>
      )}
      {groups.map((g) => (
        <Section key={g.name} title={g.name}>
          <div class="rows">{g.services.map((s) => <ServiceRow key={s.id} s={s} now={now} />)}</div>
        </Section>
      ))}
      {list.length === 0 && <Empty>{filter === 'needs' ? 'Nothing needs you. Every service is up.' : 'No probed services.'}</Empty>}
    </div>
  )
}

function ServiceRow({ s, now }: { s: Service; now: number }) {
  const st = stateText(s, now)
  const lat = s.probe?.latencies ? median(s.probe.latencies) : null
  const lit = s.level === 'crit' ? ' lit lit-down' : s.level === 'warn' ? ' lit lit-attn' : s.level === 'unknown' ? ' blind' : ''
  return (
    <a class={`row svc${lit}`} href={`#/services/${encodeURIComponent(s.id)}`}>
      <span class="row-main">
        <span class="row-title">{s.title}{s.level !== 'ok' && s.level !== 'off' && <Glyph level={s.level} size={13} />}</span>
        <span class="row-sub">{st ? <span class={`st-${s.level}`}>{st}</span> : s.note}</span>
      </span>
      <Strip beats={s.beats} />
      <span class="row-num">{lat != null ? <>{lat < 10 ? lat.toFixed(1) : Math.round(lat)}<small> ms</small></> : <small class="muted">{s.kind === 'unit' ? 'unit' : ''}</small>}</span>
      <IconChevron size={16} />
    </a>
  )
}

function ServiceDetail({ snap, now, id }: ViewProps & { id: string }) {
  const s = snap.services.find((x) => x.id === id)
  if (!s) return <Empty>No service called <code>{id}</code>. <a href="#/services">All services</a></Empty>
  const up = uptimeOf(s.beats)
  const lats = s.probe?.latencies ?? []
  const p50 = median(lats)
  const p95 = pctl(lats, 95)
  const rb = s.runbook ? snap.runbooks.find((r) => r.id === s.runbook) : undefined
  const app = s.url ? safeHref(s.url) : null
  const st = stateText(s, now)
  return (
    <div class="detail">
      <a class="back" href="#/services"><IconBack size={16} /> Services</a>
      <PageHead title={s.title} sub={<>{st ? <span class={`st-${s.level}`}>{st}</span> : <>Up{s.since ? ` for ${precise(now - ms(s.since))}` : ''}</>}{s.note ? <span class="muted"> · {s.note}</span> : null}</>}
        aside={app && <Btn href={app} external primary>Open {s.title}<IconExternal size={15} /></Btn>} />
      {s.detail && <p class={`detail-line${s.level !== 'ok' ? ' st-' + s.level : ''}`}>{s.detail}</p>}
      <div class="figs">
        <Figure value={up != null ? `${Math.round(up * 10) / 10}%` : '—'} caption="up, the last 30 minutes" level={up != null && up < 100 ? 'warn' : undefined} />
        {s.probe && <Figure value={p50 != null ? (p50 < 10 ? p50.toFixed(1) : Math.round(p50)) : '—'} unit="ms" caption={`median answer, p95 ${p95 != null ? Math.round(p95) + ' ms' : '—'}`} />}
        {s.probe?.cert_days != null && <Figure value={s.probe.cert_days} unit="days" caption="until the certificate expires" level={s.probe.cert_days < 14 ? 'warn' : undefined} />}
        {s.restarts != null && <Figure value={s.restarts} caption={s.restarts === 1 ? 'restart' : 'restarts'} level={s.restarts > 3 ? 'warn' : undefined} />}
      </div>
      <Section title="The last 30 minutes">
        <div class="pane pad">
          <Strip beats={s.beats} />
          {lats.length > 1 && (<><div class="chart-cap">Answer time</div><Spark values={lats} w={600} h={64} level={s.level} /></>)}
        </div>
      </Section>
      <Section title="Facts">
        <dl class="facts pane">
          <div><dt>Kind</dt><dd>{s.kind === 'container' ? 'Docker container' : s.kind === 'unit' ? 'systemd unit' : 'probe only'}</dd></div>
          {s.image && <div><dt>Image</dt><dd><code>{s.image}</code></dd></div>}
          {s.group && <div><dt>Group</dt><dd>{s.group}</dd></div>}
          {s.since && <div><dt>In this state since</dt><dd>{dateTime(s.since)}</dd></div>}
          {s.probe && <div><dt>Probe</dt><dd><code>{s.probe.target}</code>{s.probe.code ? ` answered ${s.probe.code}` : ''}{s.probe.error ? `, ${s.probe.error}` : ''}</dd></div>}
        </dl>
      </Section>
      {rb && (
        <Section title="If it needs you">
          <a class="row" href={rb.local ? `#/runbooks/${encodeURIComponent(rb.id)}` : safeHref(rb.url ?? '') ?? '#'}>
            <span class="row-main"><span class="row-title">{rb.title}</span><span class="row-sub">Checklist</span></span>
            <IconChevron size={16} />
          </a>
        </Section>
      )}
    </div>
  )
}
