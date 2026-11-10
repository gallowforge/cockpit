// System: is the machine itself healthy, is it still what the repo says, and
// can Cockpit see everything it needs to?
import { Fragment } from 'preact'
import { useEffect } from 'preact/hooks'
import type { ViewProps } from '../app'
import type { Snapshot } from '../types'
import { ago, bytes, dateTime, humanize, pct, plural, precise, sourceName } from '../format'
import { Empty, Figures, Glyph, Meter, PageHead, Section, Spark, State } from '../components/ui'
import { IconChevron } from '../components/icons'

export function throttleWords(hex?: string): string | null {
  if (!hex) return null
  const v = parseInt(hex.replace(/^0x/, ''), 16)
  if (!v) return 'No under-voltage or throttling this boot'
  const now: string[] = []
  const before: string[] = []
  if (v & 0x1) now.push('under-voltage')
  if (v & 0x2) now.push('the ARM frequency capped')
  if (v & 0x4) now.push('throttling')
  if (v & 0x8) now.push('the soft temperature limit')
  if (v & 0x10000) before.push('under-voltage')
  if (v & 0x40000) before.push('throttling')
  if (v & 0x80000) before.push('the soft temperature limit')
  if (now.length) return `Right now: ${now.join(', ')}`
  if (before.length) return `Earlier this boot: ${before.join(', ')}`
  return `Flags ${hex}`
}

export function SystemView({ snap, now, route }: ViewProps) {
  useEffect(() => {
    if (route[1]) document.getElementById('sys-' + route[1])?.scrollIntoView({ block: 'start' })
  }, [route[1]])
  const h = snap.host
  const mem = h.mem_total ? 100 - pct(h.mem_available, h.mem_total) : 0
  const swap = h.swap_total ? 100 - pct(h.swap_free, h.swap_total) : 0
  const hist = h.history ?? []
  const thr = throttleWords(h.throttled)
  const jobsBad = snap.timers.filter((t) => t.highlight && (t.level === 'warn' || t.level === 'crit')).length
  return (
    <div>
      <PageHead title="System" sub={<>{h.name}{h.os ? ` · ${h.os}` : ''}{h.kernel ? ` · kernel ${h.kernel}` : ''} · up {precise(h.uptime_s * 1000)}</>} />
      <Figures items={[
        { label: 'Temperature', value: h.temp_c != null ? Math.round(h.temp_c) : '—', unit: h.temp_c != null ? '°C' : undefined, caption: thr ? (h.throttled === '0x0' ? 'not throttled' : thr) : 'CPU', level: h.temp_c != null && h.temp_c >= 80 ? 'warn' : undefined },
        { label: 'CPU', value: h.cpu_pct != null ? Math.round(h.cpu_pct) : '—', unit: '%', caption: `${h.cpus} cores · load ${h.load.map((x) => x.toFixed(2)).join(' ')}` },
        { label: 'Memory', value: Math.round(mem), unit: '%', caption: `${bytes(h.mem_total - h.mem_available)} of ${bytes(h.mem_total)}`, level: mem > 90 ? 'warn' : undefined },
        { label: 'Writes', value: h.writes_gib_day != null ? h.writes_gib_day.toFixed(1) : '—', unit: h.writes_gib_day != null ? 'GiB/day' : undefined, caption: 'to the boot disk' },
      ]} />

      <Section title="Last 30 minutes" id="sys-host">
        <div class="panel" style={{ display: 'grid', gap: '22px' }}>
          <div>
            <div class="chart-head"><span>CPU</span><b>{h.cpu_pct != null ? `${Math.round(h.cpu_pct)}%` : '—'}</b></div>
            <Spark values={hist.map((x) => x.cpu)} w={720} h={64} fluid grid />
          </div>
          <div>
            <div class="chart-head"><span>Memory used</span><b>{Math.round(mem)}%</b></div>
            <Spark values={hist.map((x) => x.mem)} w={720} h={64} fluid grid />
            <div class="chart-lbl"><span>30 min ago</span><span>now</span></div>
          </div>
        </div>
      </Section>

      <Section title="Machine">
        <dl class="kv">
          {h.disks.map((d) => (
            <Fragment key={d.mount}><dt>Disk {d.mount}</dt><dd>{bytes(d.used)} of {bytes(d.size)} <span class="muted">({Math.round(pct(d.used, d.size))}%)</span><Meter pct={pct(d.used, d.size)} level={pct(d.used, d.size) >= 90 ? 'warn' : 'plain'} label={`Disk ${d.mount}`} /></dd></Fragment>
          ))}
          {h.swap_total > 0 && <><dt>Swap</dt><dd>{bytes(h.swap_total - h.swap_free)} of {bytes(h.swap_total)} <span class="muted">({Math.round(swap)}%)</span></dd></>}
          {thr && <><dt>Power and heat</dt><dd>{thr}</dd></>}
          {h.os && <><dt>Operating system</dt><dd>{h.os}</dd></>}
          {h.kernel && <><dt>Kernel</dt><dd><code>{h.kernel}</code></dd></>}
          {snap.maintenance && <><dt>Maintenance mode</dt><dd>on since {dateTime(snap.maintenance.since)}</dd></>}
        </dl>
      </Section>

      <Section title="Checks" id="sys-checks">
        <div class="rows">
          <div class="row" style={{ gridTemplateColumns: '16px minmax(0,1fr) auto' }}>
            <Glyph level={snap.heartbeat.level === 'info' ? 'ok' : snap.heartbeat.level} size={14} />
            <span class="main-col">
              <span class="ttl"><span>Heartbeat to the dead-man switch</span></span>
              <span class="sub wrap">{snap.heartbeat.level === 'off' ? 'Not set up.'
                : snap.heartbeat.level === 'unknown' && !snap.heartbeat.last ? 'No ping seen in the journal yet.'
                  : snap.heartbeat.ok ? `${snap.heartbeat.pings_24h} of ${snap.heartbeat.runs_24h} pings in 24 hours, the last ${ago(snap.heartbeat.last, now)}.`
                    : `Withheld: ${snap.heartbeat.reason ?? 'no reason given'}.`}</span>
            </span>
            <span />
          </div>
          <div class="row" style={{ gridTemplateColumns: '16px minmax(0,1fr) auto' }}>
            <Glyph level={snap.health.level === 'info' ? 'ok' : snap.health.level} size={14} />
            <span class="main-col">
              <span class="ttl"><span>Daily health check</span></span>
              <span class="sub wrap">{snap.health.level === 'off' ? 'Not set up.' : snap.health.last ? `Ran ${ago(snap.health.last, now)}${snap.health.result ? `: ${snap.health.result}` : ''}.` : 'No run in the journal yet.'}</span>
            </span>
            <span />
          </div>
          <a class="row" href="#/jobs" style={{ gridTemplateColumns: '16px minmax(0,1fr) auto' }}>
            <Glyph level={jobsBad ? 'warn' : 'ok'} size={14} />
            <span class="main-col">
              <span class="ttl"><span>Scheduled jobs</span></span>
              <span class="sub">{jobsBad ? `${plural(jobsBad, 'homelab job')} failed or disabled` : `${plural(snap.timers.filter((t) => t.highlight).length, 'homelab job')}, every last run fine`}</span>
            </span>
            <IconChevron size={14} />
          </a>
        </div>
        {snap.health.categories.length > 0 && (
          <ul class="cats" aria-label="Health check categories">
            {snap.health.categories.map((c) => (
              <li key={c.name} class={c.open ? 'open' : ''}><Glyph level={c.open ? 'warn' : 'ok'} size={12} />{humanize(c.name)}{c.open && c.since ? <small> since {dateTime(c.since)}</small> : null}</li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Config drift" id="sys-drift">
        <Drift snap={snap} now={now} />
      </Section>

      <Section title="What Cockpit can see" id="sys-sources" aside={`${snap.sources.filter((s) => s.ok).length} of ${snap.sources.length} sources`}>
        <div class="rows">
          {snap.sources.map((s) => (
            <div key={s.name} class="row" style={{ gridTemplateColumns: '16px minmax(0,1fr) auto' }}>
              <Glyph level={s.ok ? 'ok' : 'unknown'} size={14} />
              <span class="main-col">
                <span class="ttl"><span>{sourceName(s.name)}</span></span>
                <span class={`sub${s.ok ? '' : ' wrap'}`}>{s.ok ? `read in ${s.duration_ms.toFixed(0)} ms` : <code style={{ color: 'var(--down-ink)' }}>{s.error}</code>}</span>
              </span>
              <span class="end">{s.ok ? ago(s.at, now) : 'failed'}</span>
            </div>
          ))}
        </div>
        <p class="sec-note">If a source cannot be read, Cockpit says so instead of showing an all-clear.</p>
      </Section>
    </div>
  )
}

function Drift({ snap, now }: { snap: Snapshot; now: number }) {
  const d = snap.drift
  if (d.result !== 'clean' && d.result !== 'drift') return <div class="panel"><State level="unknown">Can't be checked</State> <span class="muted">{d.error ?? 'The MANIFEST could not be read.'}</span></div>
  return (
    <div class="panel">
      <p>
        {d.result === 'clean' ? <span class="strong">All {d.tracked} tracked files match the repo.</span> : <State level="warn">{plural(d.files.length + d.disabled_timers.length, 'difference')} from the repo</State>}
        <span class="muted"> Checked {ago(d.checked, now)}.{d.uncommitted ? ` ${plural(d.uncommitted, 'uncommitted change')} in the repo.` : ''}</span>
      </p>
      {(d.files.length > 0 || d.disabled_timers.length > 0) ? (
        <ul class="drift-files" style={{ marginTop: '10px', borderTop: '1px solid var(--line)' }}>
          {d.files.map((f) => <li key={f.path}><code>{f.path}</code><span>{f.state}{f.note ? `, ${f.note}` : ''}</span></li>)}
          {d.disabled_timers.map((t) => <li key={t}><code>{t}</code><span>disabled, but the MANIFEST says enabled</span></li>)}
        </ul>
      ) : d.result === 'clean' ? null : <Empty left>No file details.</Empty>}
    </div>
  )
}
