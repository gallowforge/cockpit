// System: is the machine itself healthy, and is it still what the repo says?
import { useEffect } from 'preact/hooks'
import type { ViewProps } from '../app'
import type { Snapshot } from '../types'
import { sortTimers } from '../derive'
import { ago, bytes, clock, dateTime, humanize, pct, plural, precise, until } from '../format'
import { Empty, Figure, Glyph, Meter, PageHead, Section, Spark, StateWord } from '../components/ui'

function throttleWords(hex?: string): string | null {
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
  return (
    <div>
      <PageHead title="System" sub={<>{h.name}{h.os ? `, ${h.os}` : ''}{h.kernel ? `, kernel ${h.kernel}` : ''}. Up {precise(h.uptime_s * 1000)}.</>} />

      <Section title="Host" id="sys-host">
        <div class="figs">
          <Figure value={h.temp_c != null ? Math.round(h.temp_c) : '—'} unit="°C" caption="CPU temperature" level={h.temp_c != null && h.temp_c >= 80 ? 'warn' : undefined} />
          <Figure value={h.cpu_pct != null ? Math.round(h.cpu_pct) : '—'} unit="%" caption={`CPU, ${h.cpus} cores, load ${h.load.map((x) => x.toFixed(2)).join(' ')}`} />
          <Figure value={Math.round(mem)} unit="%" caption={`memory used of ${bytes(h.mem_total)}`} level={mem > 90 ? 'warn' : undefined} />
          {h.writes_gib_day != null && <Figure value={h.writes_gib_day.toFixed(1)} unit="GiB/day" caption="written to the boot disk" />}
        </div>
        <div class="pane pad">
          <div class="chart-row"><span>CPU, the last 30 minutes</span><Spark values={hist.map((x) => x.cpu)} w={520} h={44} /></div>
          <div class="chart-row"><span>Memory, the last 30 minutes</span><Spark values={hist.map((x) => x.mem)} w={520} h={44} /></div>
        </div>
        <dl class="facts pane">
          {h.disks.map((d) => (
            <div key={d.mount}><dt>Disk {d.mount}</dt><dd class="dd-meter"><Meter pct={pct(d.used, d.size)} level={pct(d.used, d.size) >= 90 ? 'warn' : 'ok'} />{Math.round(pct(d.used, d.size))}% of {bytes(d.size)}</dd></div>
          ))}
          {h.swap_total > 0 && <div><dt>Swap</dt><dd>{Math.round(swap)}% of {bytes(h.swap_total)}</dd></div>}
          {thr && <div><dt>Power and heat</dt><dd>{thr}</dd></div>}
          {snap.maintenance && <div><dt>Maintenance mode</dt><dd>on since {dateTime(snap.maintenance.since)}</dd></div>}
        </dl>
      </Section>

      <Section title="The next 24 hours" id="sys-timers">
        <TimerLane snap={snap} now={now} />
      </Section>
      <Section title="Scheduled jobs">
        <div class="rows">
          {sortTimers(snap.timers, false).map((t) => (
            <div key={t.unit} class={`row static${t.level === 'warn' ? ' lit lit-attn' : ''}`}>
              <span class="row-main">
                <span class="row-title">{t.description || t.activates.replace(/\.service$/, '')}{t.level !== 'ok' && <Glyph level={t.level} size={13} />}</span>
                <span class="row-sub"><code>{t.unit}</code>{t.last ? ` · last ${ago(t.last, now)}${t.result && t.result !== 'success' ? `, ${t.result}` : ''}` : ''}{t.enabled && t.enabled !== 'enabled' && t.enabled !== 'static' ? ` · ${t.enabled}` : ''}</span>
              </span>
              <span class="row-num">{t.next ? <>{clock(t.next)}<small>{until(t.next, now)}</small></> : <small class="muted">not scheduled</small>}</span>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Config drift" id="sys-drift">
        <DriftPane snap={snap} now={now} />
      </Section>

      <Section title="Checks" id="sys-checks">
        <div class="rows">
          <div class={`row static${snap.heartbeat.level === 'crit' ? ' lit lit-down' : snap.heartbeat.level === 'warn' ? ' lit lit-attn' : snap.heartbeat.level === 'unknown' ? ' blind' : ''}`}>
            <Glyph level={snap.heartbeat.level} size={14} />
            <span class="row-main">
              <span class="row-title">Heartbeat to the dead-man switch</span>
              <span class="row-sub">{snap.heartbeat.level === 'off' ? 'not set up' : snap.heartbeat.ok
                ? `${snap.heartbeat.pings_24h} of ${snap.heartbeat.runs_24h} pings in 24 hours, the last ${ago(snap.heartbeat.last, now)}`
                : `withheld: ${snap.heartbeat.reason ?? 'no reason given'}`}</span>
            </span>
          </div>
          <div class={`row static${snap.health.level === 'crit' ? ' lit lit-down' : snap.health.level === 'warn' ? ' lit lit-attn' : ''}`}>
            <Glyph level={snap.health.level} size={14} />
            <span class="row-main">
              <span class="row-title">Daily health check</span>
              <span class="row-sub">{snap.health.last ? `ran ${ago(snap.health.last, now)}${snap.health.result ? `: ${snap.health.result}` : ''}` : 'no run in the journal'}</span>
            </span>
          </div>
        </div>
        {snap.health.categories.length > 0 && (
          <ul class="chips">
            {snap.health.categories.map((c) => (
              <li key={c.name} class={c.open ? 'open' : ''}>{c.open ? <Glyph level="warn" size={12} /> : null}{humanize(c.name)}{c.open && c.since ? <small>since {dateTime(c.since)}</small> : null}</li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="What Cockpit reads" id="sys-sources">
        <div class="rows">
          {snap.sources.map((s) => (
            <div key={s.name} class={`row static${s.ok ? '' : ' blind'}`}>
              <Glyph level={s.ok ? 'ok' : 'unknown'} size={14} />
              <span class="row-main"><span class="row-title">{s.name}</span><span class="row-sub">{s.ok ? `read ${ago(s.at, now)} in ${s.duration_ms.toFixed(0)} ms` : s.error}</span></span>
            </div>
          ))}
        </div>
      </Section>
    </div>
  )
}

/** Every scheduled job on one line for the next 24 hours, so collisions show. */
function TimerLane({ snap, now }: { snap: Snapshot; now: number }) {
  const span = 24 * 3600e3
  const soon = sortTimers(snap.timers, false).filter((t) => t.next && Date.parse(t.next) - now <= span)
  const frequent = (t: (typeof soon)[number]) => !!t.last && Date.parse(t.next!) - Date.parse(t.last) < 55 * 60e3
  const jobs = soon.filter((t) => !frequent(t))
  const many = soon.length - jobs.length
  const hours = Array.from({ length: 5 }, (_, i) => now + (i * span) / 4)
  if (!jobs.length) return <Empty>Nothing is scheduled in the next 24 hours.</Empty>
  return (
    <div class="pane pad lane">
      <div class="lane-line">
        {jobs.map((t, i) => {
          const x = ((Date.parse(t.next!) - now) / span) * 100
          return (
            <span key={t.unit} class={`lane-job${t.highlight ? ' hl' : ''}${x > 62 ? ' flip' : ''}`} style={{ left: `${x}%`, top: `${(i % 4) * 22}px` }}>
              <i /><span>{(t.description || t.activates.replace(/\.service$/, '')).slice(0, 28)} <b>{clock(t.next)}</b></span>
            </span>
          )
        })}
      </div>
      <div class="axis">{hours.map((h, i) => <span key={i}>{i === 0 ? 'now' : clock(new Date(h).toISOString())}</span>)}</div>
      {many > 0 && <p class="lane-note">Plus {plural(many, 'job')} that run{many === 1 ? 's' : ''} more often than hourly.</p>}
    </div>
  )
}

function DriftPane({ snap, now }: { snap: Snapshot; now: number }) {
  const d = snap.drift
  if (d.result === 'unknown') {
    return <div class="pane pad blind"><p><StateWord level="unknown">Can't be checked</StateWord> {d.error ?? 'The MANIFEST could not be read.'}</p></div>
  }
  return (
    <div class={`pane pad${d.result === 'drift' ? ' lit lit-attn' : ''}`}>
      <p class="drift-sum">
        {d.result === 'clean' ? <>All {d.tracked} tracked files match the repo.</> : <span class="st-warn">{plural(d.files.length + d.disabled_timers.length, 'difference')} from the repo.</span>}
        {' '}<span class="muted">Checked {ago(d.checked, now)}.{d.uncommitted ? ` ${plural(d.uncommitted, 'uncommitted change')} in the repo.` : ''}</span>
      </p>
      {d.files.length > 0 && (
        <ul class="drift-files">
          {d.files.map((f) => <li key={f.path}><code>{f.path}</code><span>{f.state}{f.note ? `, ${f.note}` : ''}</span></li>)}
          {d.disabled_timers.map((t) => <li key={t}><code>{t}</code><span>disabled, but the MANIFEST says enabled</span></li>)}
        </ul>
      )}
    </div>
  )
}
