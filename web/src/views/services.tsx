// Services: is each thing up, how has the day been, how fast does it answer?
import { useState } from 'preact/hooks'
import type { ViewProps } from '../app'
import type { Service } from '../types'
import { bucket, dayRuns, daySeen, dayUptime, durationWords, fullDay, groupServices, latencyStats, levelRank, slotStart } from '../derive'
import { ago, clock, dateTime, ms, plural, precise, short } from '../format'
import { Beats, Btn, Day, Dot, Empty, Figures, PageHead, Section, Seg, Spark, State, useTip } from '../components/ui'
import { IconBack, IconChevron, IconExternal } from '../components/icons'
import { safeHref } from '../markdown'

export function stateText(s: Service, now: number): string {
  const since = s.since ? ` · ${short(now - ms(s.since))}` : ''
  switch (s.state) {
    case 'down': return `Down${since}`
    case 'degraded': return `Degraded${since}`
    case 'unknown': return "Can't confirm"
    case 'off': return 'Off'
  }
  return 'Up'
}

export function fmtMs(v: number | null): string {
  if (v == null) return '—'
  return `${v < 10 ? v.toFixed(1) : Math.round(v)} ms`
}

export function fmtPct(v: number | null): string {
  if (v == null) return '—'
  if (v >= 99.995) return '100%'
  return `${v.toFixed(v >= 99 ? 2 : 1)}%`
}

/** The services table: one row per service, grouped as the config groups them. */
export function ServiceTable({ list, now, grouped = true }: { list: Service[]; now: number; grouped?: boolean }) {
  const groups = grouped ? groupServices(list) : [{ name: '', services: list }]
  return (
    <div aria-label="Services">
      <div class="svc-head" aria-hidden="true">
        <span /><span>Service</span><span>Status</span><span>Last 24 hours</span><span>Response</span><span>24 h</span><span />
      </div>
      {groups.map((g) => (
        <div key={g.name}>
          {g.name && <div class="grp-h">{g.name}</div>}
          {g.services.map((s) => <ServiceRow key={s.id} s={s} now={now} />)}
        </div>
      ))}
    </div>
  )
}

function ServiceRow({ s, now }: { s: Service; now: number }) {
  const day = fullDay(s.day)
  const lat = latencyStats(s.probe?.latencies)
  const lv = s.level === 'info' ? 'ok' : s.level
  const failing = s.probe && !s.probe.ok
  return (
    <a class={`svc ${lv}`} href={`#/services/${encodeURIComponent(s.id)}`}>
      <Dot level={lv} live={lv === 'crit'} />
      <span class="n"><b>{s.title}</b><span>{s.note || s.detail}</span></span>
      <span class={`stt ${lv}`}>{stateText(s, now)}</span>
      <Day day={day} n={48} label={`${s.title}, last 24 hours: ${fmtPct(dayUptime(day))} up`} />
      <span class="resp">
        {s.probe?.latencies && !failing && <Spark values={s.probe.latencies} w={56} h={18} />}
        {s.probe ? (failing ? (s.probe.error || 'failing') : fmtMs(lat.p50)) : <span class="muted">no check</span>}
      </span>
      <span class="upt">{daySeen(day) >= 12 ? fmtPct(dayUptime(day)) : '—'}</span>
      <span class="chev"><IconChevron size={14} /></span>
    </a>
  )
}

type Filter = 'all' | 'needs' | 'containers' | 'units'

export function Services(p: ViewProps) {
  const { snap, now, route } = p
  const [filter, setFilter] = useState<Filter>('all')
  if (route[1]) return <ServiceDetail {...p} id={route[1]} />
  const bad = snap.services.filter((s) => levelRank[s.level] >= levelRank.unknown)
  const list = snap.services.filter((s) =>
    filter === 'needs' ? levelRank[s.level] >= levelRank.unknown : filter === 'containers' ? s.kind === 'container' : filter === 'units' ? s.kind !== 'container' : true)
  const counted = snap.services.filter((s) => s.state !== 'off')
  const up = counted.filter((s) => s.state === 'up').length
  const ups = counted.map((s) => dayUptime(fullDay(s.day))).filter((v): v is number => v != null)
  const probed = snap.services.filter((s) => s.probe?.latencies?.length)
  const slowest = probed.map((s) => ({ s, p: latencyStats(s.probe!.latencies).p50 ?? 0 })).sort((a, b) => b.p - a.p)[0]
  const seen = Math.max(0, ...snap.services.map((s) => daySeen(fullDay(s.day))))
  return (
    <div>
      <PageHead title="Services" sub={<>Each line is the last 24 hours in half-hour cells; a cell shows the worst moment in it. Response is the last 30 minutes of probe answers.</>}
        aside={<Seg label="Show" value={filter} onChange={setFilter} options={[['all', 'All'], ['needs', `Needs you${bad.length ? ` (${bad.length})` : ''}`], ['containers', 'Containers'], ['units', 'Units']]} />} />
      <Figures items={[
        { label: 'Up now', value: up, unit: `/ ${counted.length}`, caption: bad.length ? `${plural(bad.length, 'needs', 'need')} you` : 'every check answering', level: bad.some((s) => s.level === 'crit') ? 'crit' : bad.length ? 'unknown' : undefined },
        { label: 'Availability, 24 h', value: fmtPct(ups.length ? ups.reduce((a, b) => a + b, 0) / ups.length : null).replace('%', ''), unit: '%', caption: seen === 0 ? 'no history yet' : seen < 276 ? `over the ${Math.max(1, Math.round(seen / 12))} h Cockpit watched` : 'average across services' },
        { label: 'Probed', value: probed.length, unit: `/ ${snap.services.length}`, caption: 'answer HTTP, TCP or DNS checks' },
        { label: 'Slowest answer', value: slowest ? fmtMs(slowest.p).replace(' ms', '') : '—', unit: slowest ? 'ms' : undefined, caption: slowest ? `${slowest.s.title}, median` : 'no probes' },
      ]} />
      <div style={{ marginTop: '22px' }}>
        {list.length ? <ServiceTable list={list} now={now} grouped={filter !== 'needs'} /> : <Empty>{filter === 'needs' ? 'Nothing needs you. Every service is up.' : 'No services of this kind.'}</Empty>}
      </div>
    </div>
  )
}

function ServiceDetail({ snap, now, id }: ViewProps & { id: string }) {
  const s = snap.services.find((x) => x.id === id)
  const [tip, setTip] = useTip()
  if (!s) return <Empty>No service called <code>{id}</code>. <a class="linklike" href="#/services">All services</a></Empty>
  const day = fullDay(s.day)
  const up = dayUptime(day)
  const lats = s.probe?.latencies ?? []
  const { p50, p95 } = latencyStats(lats)
  const rb = s.runbook ? snap.runbooks.find((r) => r.id === s.runbook) : undefined
  const app = s.url ? safeHref(s.url) : null
  const lv = s.level === 'info' ? 'ok' : s.level
  const outages = dayRuns(day, snap.generated).filter((r) => r.ch === 'x')
  const cell = (i: number | null, e?: MouseEvent) => {
    if (i == null) return setTip(null)
    const from = slotStart(snap.generated, i * 3, 288)
    const c = bucket(day, 96)[i]
    setTip(<><b>{clock(new Date(from).toISOString())}–{clock(new Date(from + 15 * 60e3).toISOString())}</b> · {c === 'u' ? 'up' : c === 'x' ? 'down' : c === 'd' ? 'degraded' : c === 'o' ? 'off' : 'not seen'}</>, e)
  }
  return (
    <div>
      <a class="back" href="#/services"><IconBack size={14} /> Services</a>
      <PageHead title={s.title}
        sub={<>{lv === 'ok' ? <>Up{s.since ? ` for ${precise(now - ms(s.since))}` : ''}</> : <State level={lv}>{stateText(s, now)}</State>}{s.note ? <span class="muted"> · {s.note}</span> : null}</>}
        aside={<>
          {rb && <Btn href={rb.local ? `#/runbooks/${encodeURIComponent(rb.id)}` : safeHref(rb.url ?? '') ?? '#'}>Checklist</Btn>}
          {app && <Btn href={app} external primary>Open {s.title}<IconExternal size={13} /></Btn>}
        </>} />
      {s.detail && <p class={`detail-line ${lv}`}>{s.detail}</p>}
      <Figures items={[
        { label: 'Availability, 24 h', value: fmtPct(up).replace('%', ''), unit: up != null ? '%' : undefined, caption: outages.length ? `${plural(outages.length, 'outage')} in 24 h` : 'no outage seen', level: up != null && up < 99.9 ? 'warn' : undefined },
        { label: 'Median answer', value: s.probe ? fmtMs(p50).replace(' ms', '') : '—', unit: s.probe && p50 != null ? 'ms' : undefined, caption: s.probe ? `p95 ${fmtMs(p95)}` : 'not probed' },
        { label: 'Certificate', value: s.probe?.cert_days ?? '—', unit: s.probe?.cert_days != null ? 'days' : undefined, caption: s.probe?.cert_days != null ? 'until it expires' : 'no TLS check', level: s.probe?.cert_days != null && s.probe.cert_days < 14 ? 'warn' : undefined },
        { label: 'Restarts', value: s.restarts ?? '—', caption: s.kind === 'container' ? 'since the container was created' : 'not tracked for units', level: (s.restarts ?? 0) > 3 ? 'warn' : undefined },
      ]} />
      <Section title="Last 24 hours" aside={<span class="num">{daySeen(day) < 276 ? `seen ${Math.round(daySeen(day) / 12)} of 24 h` : 'five-minute resolution'}</span>}>
        <div class="panel">
          <Day day={day} n={96} size="tall" label={`${s.title}, last 24 hours`} onCell={cell} />
          <DayAxis generated={snap.generated} />
          {tip}
          {outages.length > 0 && (
            <ul class="rows" style={{ marginTop: '14px' }}>
              {outages.slice(-5).reverse().map((r) => {
                const current = r.to >= ms(snap.generated) && s.state === 'down'
                return (
                  <li key={r.from} class="row">
                    <Dot level={current ? 'crit' : 'off'} live={current} />
                    <span class="main-col">
                      <span class="ttl"><span>{current ? 'Down now' : 'Down, then recovered'}</span></span>
                      <span class="sub">{current && s.since ? `since ${clock(s.since)}` : `within ${clock(new Date(r.from).toISOString())}–${clock(new Date(r.to).toISOString())}`}</span>
                    </span>
                    <span class="end">{current && s.since ? durationWords(now - ms(s.since)) : `up to ${durationWords(r.to - r.from)}`}</span>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </Section>
      <Section title="Last 30 minutes" aside={<span class="num">one sample every 20 s</span>}>
        <div class="panel">
          <Beats beats={s.beats} label={`${s.title}, last ${s.beats.length} samples`} />
          {lats.length > 1 && (
            <div style={{ marginTop: '20px' }}>
              <div class="chart-head"><span>Answer time</span><b>{lats[lats.length - 1] >= 0 ? fmtMs(lats[lats.length - 1]) : s.probe?.error ?? 'failed'}</b></div>
              <Spark values={lats} w={720} h={88} fluid level={lv} grid />
              <div class="chart-lbl"><span>30 min ago</span><span>now</span></div>
            </div>
          )}
        </div>
      </Section>
      <Section title="Details">
        <dl class="kv">
          <dt>Kind</dt><dd>{s.kind === 'container' ? 'Docker container' : s.kind === 'unit' ? 'systemd unit' : 'Probe only'}</dd>
          {s.image && <><dt>Image</dt><dd><code>{s.image}</code></dd></>}
          {s.group && <><dt>Group</dt><dd>{s.group}</dd></>}
          {s.since && <><dt>In this state since</dt><dd>{dateTime(s.since)} <span class="muted">({ago(s.since, now)})</span></dd></>}
          {s.probe && <><dt>Probe</dt><dd><code>{s.probe.target}</code>{s.probe.code ? <span class="muted"> · answered {s.probe.code}</span> : ''}{s.probe.error ? <span class="muted"> · {s.probe.error}</span> : ''}</dd></>}
          {app && <><dt>Address</dt><dd><code>{app.replace(/^https?:\/\//, '')}</code></dd></>}
        </dl>
      </Section>
    </div>
  )
}

/** Clock times under a day line: the start, quarter marks and now. */
export function DayAxis({ generated }: { generated: string }) {
  const at = (i: number) => clock(new Date(slotStart(generated, i, 288)).toISOString())
  return (
    <div class="axis" aria-hidden="true">
      <span class="l" style={{ left: '0%' }}>{at(0)}</span>
      <span class="opt" style={{ left: '25%' }}>{at(72)}</span>
      <span style={{ left: '50%' }}>{at(144)}</span>
      <span class="opt" style={{ left: '75%' }}>{at(216)}</span>
      <span class="r" style={{ left: '100%' }}>now</span>
    </div>
  )
}

