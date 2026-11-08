import type { ViewProps } from '../app'
import type { Level, Snapshot } from '../types'
import { alertHistogram, areaHref, prioLevel, sortTimers } from '../derive'
import { ago, bytes, clock, duration, ms, pct, plural, precise, until } from '../format'
import { Beats, Card, Dot, Meter, Ring, RunStrip, RunbookLink } from '../components/ui'
import {
  IconAlerts, IconBackups, IconDrift, IconHeart, IconServices, IconShield, IconTimers,
} from '../components/icons'

const statusWord: Record<Level, string> = {
  ok: 'All clear', info: 'All clear', warn: 'Needs attention', crit: 'Problem', unknown: 'Unknown', off: 'Off',
}

function runbookTitle(s: Snapshot, id?: string) {
  return s.runbooks.find((r) => r.id === id)?.title
}

export function Overview({ snap, now }: ViewProps) {
  const h = snap.host
  const mem = pct(h.mem_total - h.mem_available, h.mem_total)
  const disk = h.disks[0]
  const diskPct = disk ? pct(disk.used, disk.size) : 0
  const temp = h.temp_c ?? 0
  const live = snap.services.filter((s) => s.state !== 'off')
  const up = live.filter((s) => s.state === 'up').length
  const okSets = snap.backups.sets.filter((b) => b.level === 'ok').length
  const lv = snap.status.level

  return (
    <div class="overview">
      <section class={`hero lv-${lv}`}>
        <div class="hero-glow" />
        <div class="hero-main">
          <div class="hero-kicker">
            <Dot level={lv} pulse size={9} />
            <span>{statusWord[lv]}</span>
          </div>
          <h1 class="hero-title">{snap.status.headline}</h1>
          <p class="hero-sub">
            <b>{h.name}</b>
            {h.os && <> · {h.os.replace(/ \(.*\)$/, '')}</>} · up {precise(h.uptime_s * 1000).split(' ')[0]} · {up}/{live.length} services up ·{' '}
            {okSets}/{snap.backups.sets.length} backups verified
          </p>
          {snap.status.attention.length > 0 ? (
            <ul class="attention">
              {snap.status.attention.map((a) => (
                <li class={`att lv-${a.level}`} key={a.area + a.ref + a.title}>
                  <span class="att-bar" />
                  <a class="att-body" href={areaHref(a.area, a.ref)}>
                    <span class="att-title">{a.title}</span>
                    {a.detail && <span class="att-detail">{a.detail}</span>}
                  </a>
                  <RunbookLink id={a.runbook} title={runbookTitle(snap, a.runbook)} />
                </li>
              ))}
            </ul>
          ) : (
            <ul class="facts">
              <li><IconBackups size={15} /> Last backup verified {ago(newestBackup(snap), now)}</li>
              {snap.drill.runs[0] && (
                <li><IconShield size={15} /> Restore drill {snap.drill.runs[0].passed}/{snap.drill.runs[0].passed + snap.drill.runs[0].failed} passed</li>
              )}
              <li><IconAlerts size={15} /> {plural(snap.alerts.open.length, 'open alert')}</li>
              <li><IconDrift size={15} /> {snap.drift.result === 'clean' ? 'No config drift' : 'Drift unknown'}</li>
            </ul>
          )}
        </div>
        <div class="hero-gauges">
          <Gauge label="CPU" value={h.cpu_pct ?? 0} text={`${Math.round(h.cpu_pct ?? 0)}%`} level={h.cpu_pct && h.cpu_pct > 90 ? 'warn' : 'ok'}
            sub={`load ${h.load[0].toFixed(2)}`} />
          <Gauge label="Memory" value={mem} text={`${Math.round(mem)}%`} level={mem > 95 ? 'crit' : mem > 90 ? 'warn' : 'ok'}
            sub={`${bytes(h.mem_available)} free`} />
          <Gauge label="Temp" value={pct(temp - 30, 60)} text={h.temp_c ? `${Math.round(temp)}°` : '—'} level={temp >= 85 ? 'crit' : temp >= 80 ? 'warn' : 'ok'}
            sub={h.throttled === '0x0' ? 'not throttled' : h.throttled ? `throttled ${h.throttled}` : 'no sensor'} />
          <Gauge label="Disk" value={diskPct} text={`${Math.round(diskPct)}%`} level={diskPct >= 95 ? 'crit' : diskPct >= 90 ? 'warn' : 'ok'}
            sub={disk ? `${bytes(disk.size - disk.used)} free` : ''} />
        </div>
      </section>

      <div class="ov-grid">
        <ServicesCard snap={snap} />
        <div class="ov-stack span-5">
          <BackupsCard snap={snap} now={now} />
          <DrillCard snap={snap} now={now} />
        </div>
        <AlertsCard snap={snap} now={now} />
        <TimersCard snap={snap} now={now} />
        <ChecksCard snap={snap} now={now} />
      </div>
    </div>
  )
}

function newestBackup(s: Snapshot): string | undefined {
  let best: string | undefined
  for (const b of s.backups.sets) if (b.last_ok && (!best || ms(b.last_ok) > ms(best))) best = b.last_ok
  return best
}

function Gauge(p: { label: string; value: number; text: string; level: Level; sub: string }) {
  return (
    <div class="gauge">
      <Ring value={p.value} level={p.level} size={84} stroke={7} label={`${p.label} ${p.text}`}>
        <span class="gauge-num">{p.text}</span>
      </Ring>
      <div class="gauge-label">{p.label}</div>
      <div class="gauge-sub">{p.sub}</div>
    </div>
  )
}

function ServicesCard({ snap }: { snap: Snapshot }) {
  const list = snap.services
  const live = list.filter((s) => s.state !== 'off')
  const up = live.filter((s) => s.state === 'up').length
  return (
    <Card class="span-7" title={<>Services <span class="count">{up}/{live.length} up</span></>} icon={<IconServices size={16} />} href="#/services">
      <div class="svc-list">
        {list.map((s) => (
          <a class="svc-row" key={s.id} href={`#/services/${encodeURIComponent(s.id)}`}>
            <Dot level={s.level} size={8} />
            <span class="svc-name">{s.title}</span>
            <span class="svc-note">{s.note}</span>
            <Beats beats={s.beats} n={36} height={18} />
            <span class="svc-ms">{s.probe?.ok ? `${Math.round(s.probe.latency_ms)} ms` : s.probe ? s.probe.error : ''}</span>
          </a>
        ))}
      </div>
    </Card>
  )
}

function BackupsCard({ snap, now }: { snap: Snapshot; now: number }) {
  const b = snap.backups
  const ok = b.sets.filter((x) => x.level === 'ok').length
  const run = b.runs[0]
  return (
    <Card title={<>Backups <span class="count">{ok}/{b.sets.length} verified</span></>} icon={<IconBackups size={16} />} href="#/backups">
      <div class="bk-mini">
        {b.sets.map((s) => {
          const age = s.last_ok ? (now - ms(s.last_ok)) / 3600000 : Infinity
          const fill = isFinite(age) ? pct(age, s.max_age_h) : 100
          return (
            <div class="bk-row" key={s.name}>
              <Dot level={s.level} size={7} />
              <span class="bk-name">{s.name}</span>
              <Meter value={100 - fill} level={s.level === 'ok' ? (fill > 75 ? 'warn' : 'ok') : s.level} />
              <span class="bk-age">{s.last_ok ? ago(s.last_ok, now).replace(' ago', '') : 'never'}</span>
              <span class="bk-size">{bytes(s.bytes)}</span>
            </div>
          )
        })}
      </div>
      {run && (
        <div class="card-foot">
          <div>
            <span class={`run-word r-${run.result}`}>{run.result === 'success' ? 'Last run OK' : run.result === 'failed' ? 'Last run failed' : 'Running'}</span>
            <span class="muted"> · {clock(run.start)} · took {duration(run.start, run.end)} · {bytes(b.bytes)} newest</span>
          </div>
          <RunStrip runs={b.runs} n={14} />
        </div>
      )}
    </Card>
  )
}

function AlertsCard({ snap, now }: { snap: Snapshot; now: number }) {
  const a = snap.alerts
  const bins = alertHistogram(a.incidents.filter((i) => i.state !== 'info'), now, 14)
  const peak = Math.max(1, ...bins.map((b) => b.crit + b.warn + b.info))
  const recent = a.incidents.filter((i) => i.state !== 'info').slice(0, 3)
  return (
    <Card class="span-6" title={<>Alerts <span class="count">{a.open.length} open</span></>} icon={<IconAlerts size={16} />} href="#/alerts">
      <div class="hist" aria-label="Alerts per day, last 14 days">
        {bins.map((b) => (
          <div class="hist-col" key={b.t} title={new Date(b.t).toDateString()}>
            <div class="hist-stack" style={{ height: `${((b.crit + b.warn + b.info) / peak) * 100}%` }}>
              {b.crit > 0 && <span class="lv-bg-crit" style={{ flex: b.crit }} />}
              {b.warn > 0 && <span class="lv-bg-warn" style={{ flex: b.warn }} />}
              {b.info > 0 && <span class="lv-bg-info" style={{ flex: b.info }} />}
            </div>
          </div>
        ))}
      </div>
      <div class="hist-axis"><span>14 days ago</span><span>today</span></div>
      <ul class="mini-inc">
        {recent.map((i) => (
          <li key={i.key + i.opened}>
            <Dot level={i.state === 'open' ? prioLevel(i.prio) : 'off'} size={7} />
            <span class="mini-inc-title">{i.title}</span>
            <span class="muted">{i.state === 'open' ? 'open' : ago(i.opened, now)}</span>
          </li>
        ))}
        {recent.length === 0 && <li class="muted">No alerts in the last {snap.alerts.incidents.length ? '30' : 'few'} days.</li>}
      </ul>
    </Card>
  )
}

function TimersCard({ snap, now }: { snap: Snapshot; now: number }) {
  const next = sortTimers(snap.timers, true).slice(0, 6)
  return (
    <Card class="span-6" title="Next up" icon={<IconTimers size={16} />} href="#/timers">
      <ul class="next-list">
        {next.map((t) => (
          <li key={t.unit}>
            <Dot level={t.result === 'failed' ? 'warn' : t.result === 'running' ? 'info' : 'ok'} size={7} />
            <span class="next-name">{t.activates.replace(/\.service$/, '')}</span>
            <span class="next-when mono">{until(t.next, now)}</span>
          </li>
        ))}
      </ul>
    </Card>
  )
}

function DrillCard({ snap, now }: { snap: Snapshot; now: number }) {
  const r = snap.drill.runs[0]
  const nextDrill = snap.timers.find((t) => /restore/.test(t.unit))
  if (!r) {
    return (
      <Card title="Restore drill" icon={<IconShield size={16} />} href="#/backups">
        <p class="muted">No drill has run yet.</p>
      </Card>
    )
  }
  const total = r.passed + r.failed
  return (
    <Card title="Restore drill" icon={<IconShield size={16} />} href="#/backups">
      <div class="drill-mini">
        <Ring value={pct(r.passed, total)} level={r.failed ? 'crit' : 'ok'} size={96} stroke={8}>
          <span class="drill-num">{r.passed}<span>/{total}</span></span>
        </Ring>
        <div class="drill-facts">
          <div class="drill-big">{r.failed ? `${r.failed} failed` : 'Every set restored'}</div>
          <div class="muted">{ago(r.end, now)} · {duration(r.start, r.end)} in RAM</div>
          {nextDrill?.next && <div class="muted">next {until(nextDrill.next, now)}</div>}
          <div class="drill-weeks">
            {snap.drill.runs.slice(0, 8).reverse().map((d) => (
              <span key={d.start} class={`wk ${d.failed ? 'wk-bad' : 'wk-ok'}`} title={`${new Date(d.start).toDateString()}: ${d.passed} passed, ${d.failed} failed`} />
            ))}
          </div>
        </div>
      </div>
    </Card>
  )
}

function ChecksCard({ snap, now }: { snap: Snapshot; now: number }) {
  const hb = snap.heartbeat
  const d = snap.drift
  const h = snap.health
  return (
    <section class="checks span-12">
      <a class="check" href="#/drift">
        <div class="check-icon"><IconHeart size={18} /></div>
        <div>
          <div class="check-label">Heartbeat</div>
          <div class={`check-value lv-text-${hb.level}`}>
            {hb.unit ? (hb.ok ? `${hb.pings_24h}/${hb.runs_24h} pings` : 'Withheld') : 'Not set up'}
          </div>
          <div class="check-sub">{hb.last ? `last ${ago(hb.last, now)}` : hb.reason}</div>
        </div>
      </a>
      <a class="check" href="#/drift">
        <div class="check-icon"><IconDrift size={18} /></div>
        <div>
          <div class="check-label">Config drift</div>
          <div class={`check-value lv-text-${d.level === 'info' ? 'ok' : d.level}`}>
            {d.result === 'clean' ? 'No drift' : d.result === 'drift' ? plural(d.files.length + d.disabled_timers.length, 'difference') : 'Unknown'}
          </div>
          <div class="check-sub">{d.tracked} files tracked · checked {ago(d.checked, now)}</div>
        </div>
      </a>
      <a class="check check-wide" href="#/alerts">
        <div class="check-icon"><IconShield size={18} /></div>
        <div class="check-grow">
          <div class="check-label">Daily health check <span class="muted">· {h.last ? `${clock(h.last)}, ${ago(h.last, now)}` : 'not run yet'}</span></div>
          <div class="cats">
            {h.categories.map((c) => (
              <span key={c.name} class={`cat ${c.open ? 'lv-' + prioLevel(c.prio ?? '') : ''}`} title={c.open ? `open since ${c.since}` : 'clear'}>
                {c.name}
              </span>
            ))}
          </div>
        </div>
      </a>
    </section>
  )
}
