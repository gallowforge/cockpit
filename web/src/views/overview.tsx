import { useEffect, useState } from 'preact/hooks'
import type { ViewProps } from '../app'
import type { Level, Snapshot } from '../types'
import { alertHistogram, areaHref, prioLevel, servicesLevel, sortTimers, worst } from '../derive'
import { ago, bytes, clock, duration, ms, pct, plural, until } from '../format'
import { awayFor, sinceParts } from '../lastlook'
import { Beats, Card, Dot, Gauge, Lamp, Meter, RunStrip, RunbookLink } from '../components/ui'
import { IconAlerts, IconBackups, IconHeart, IconServices, IconShield, IconTimers, IconDrift } from '../components/icons'

function runbookTitle(s: Snapshot, id?: string) {
  return s.runbooks.find((r) => r.id === id)?.title
}

/** The headline in the deck's own words: cautions are amber, warnings are red. */
function deckWords(s: Snapshot) {
  const warnings = s.status.attention.filter((a) => a.level === 'crit').length
  const cautions = s.status.attention.filter((a) => a.level === 'warn').length
  if (!warnings && !cautions) return { title: 'All systems normal', sub: 'Level flight. Nothing needs you.' }
  const parts = []
  if (warnings) parts.push(plural(warnings, 'warning'))
  if (cautions) parts.push(plural(cautions, 'caution'))
  return { title: parts.join(', '), sub: 'Listed below, worst first, each with its checklist.' }
}

/** Press and hold to light every lamp, like the test switch on a real panel. */
function useLampTest() {
  const [on, setOn] = useState(false)
  useEffect(() => {
    if (!on) return
    const t = setTimeout(() => setOn(false), 4000) // never stuck lit
    return () => clearTimeout(t)
  }, [on])
  const props = {
    onPointerDown: () => setOn(true),
    onPointerUp: () => setOn(false),
    onPointerLeave: () => setOn(false),
    onPointerCancel: () => setOn(false),
    onKeyDown: (e: KeyboardEvent) => {
      if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault()
        setOn(true)
      }
    },
    onKeyUp: () => setOn(false),
  }
  return [on, props] as const
}

export function Overview({ snap, now, since }: ViewProps) {
  const h = snap.host
  const mem = pct(h.mem_total - h.mem_available, h.mem_total)
  const disk = h.disks[0]
  const diskPct = disk ? pct(disk.used, disk.size) : 0
  const live = snap.services.filter((s) => s.state !== 'off')
  const up = live.filter((s) => s.state === 'up').length
  const okSets = snap.backups.sets.filter((b) => b.level === 'ok').length
  const lv = snap.status.level
  const words = deckWords(snap)
  const [testing, testProps] = useLampTest()
  const drill = snap.drill.runs[0]
  const hb = snap.heartbeat
  const failedTimers = snap.timers.filter((t) => t.highlight && t.result === 'failed').length
  const quiet = (l: Level) => (l === 'info' ? 'ok' : l)

  const lamps: { legend: string; value: string; level: Level; href: string }[] = [
    { legend: 'Services', value: live.length - up ? `${live.length - up} not up` : `${up}/${live.length} up`, level: servicesLevel(snap.services), href: '#/services' },
    { legend: 'Backups', value: `${okSets}/${snap.backups.sets.length} verified`, level: snap.backups.level, href: '#/backups' },
    { legend: 'Drill', value: drill ? `${drill.passed}/${drill.passed + drill.failed} restored` : 'none yet', level: snap.drill.level, href: '#/backups' },
    { legend: 'Alerts', value: `${snap.alerts.open.length} open`, level: quiet(snap.alerts.level), href: '#/alerts' },
    { legend: 'Timers', value: `${failedTimers} failed`, level: worst(snap.timers.filter((t) => t.highlight).map((t) => t.level)), href: '#/timers' },
    { legend: 'Config drift', value: snap.drift.result === 'clean' ? 'none' : snap.drift.result === 'drift' ? plural(snap.drift.files.length + snap.drift.disabled_timers.length, 'file') : 'unknown', level: quiet(snap.drift.level), href: '#/drift' },
    { legend: 'Heartbeat', value: !hb.unit ? 'not set' : hb.ok ? `${hb.pings_24h}/${hb.runs_24h}` : 'withheld', level: hb.level === 'off' ? 'ok' : hb.level, href: '#/drift' },
    { legend: 'Host', value: h.temp_c ? `${Math.round(h.temp_c)} °C` : `${Math.round(mem)}% mem`, level: h.level, href: '#/' },
  ]

  return (
    <div class="overview">
      <section class={`hero lv-${lv}`}>
        <div class="instrument">
          <div class="plane" style={{ transform: `rotate(${lv === 'crit' ? -5 : lv === 'warn' ? -2.6 : 0}deg)` }} />
          <div class="sky">
            <div class="hero-text">
              <div class="hero-host">
                <b>{h.name}</b>
                {h.os && <span>{h.os.replace(/ \(.*\)$/, '')}</span>}
                <span>up {ago(new Date(now - h.uptime_s * 1000).toISOString(), now).replace(' ago', '')}</span>
              </div>
              <h1 class="hero-title">{words.title}</h1>
              <p class="hero-sub">{words.sub}</p>
            </div>
            <div class="hud">
              <Gauge value={h.cpu_pct ?? 0} readout={`${Math.round(h.cpu_pct ?? 0)}`} unit="%" label="CPU" caution={85} level={(h.cpu_pct ?? 0) > 90 ? 'warn' : 'ok'} />
              <Gauge value={mem} readout={`${Math.round(mem)}`} unit="%" label="Memory" caution={90} level={mem > 95 ? 'crit' : mem > 90 ? 'warn' : 'ok'} />
              <Gauge value={pct((h.temp_c ?? 30) - 30, 60)} readout={h.temp_c ? `${Math.round(h.temp_c)}` : '—'} unit={h.temp_c ? '°' : ''} label="Temp" caution={83.3} level={(h.temp_c ?? 0) >= 85 ? 'crit' : (h.temp_c ?? 0) >= 80 ? 'warn' : 'ok'} />
              <Gauge value={diskPct} readout={`${Math.round(diskPct)}`} unit="%" label="Disk" caution={90} level={diskPct >= 95 ? 'crit' : diskPct >= 90 ? 'warn' : 'ok'} />
            </div>
          </div>
        </div>
        <div class="strip">
          {lamps.map((l) => <Lamp key={l.legend} {...l} test={testing} />)}
          <button type="button" class="lamp-test" aria-pressed={testing} {...testProps} title="Press and hold to test every light">
            Test
          </button>
        </div>
      </section>

      {since !== undefined && <SinceLine snap={snap} now={now} since={since} />}

      {snap.status.attention.length > 0 && (
        <section class="needs" aria-label="What needs you, worst first">
          {snap.status.attention.map((a) => (
            <div class={`need lv-${a.level}`} key={a.area + a.ref + a.title}>
              <span class="need-mark">{a.level === 'crit' ? 'Warning' : 'Caution'}</span>
              <a class="need-msg" href={areaHref(a.area, a.ref)}>
                <span class="need-title">{a.title}</span>
                {a.detail && <span class="need-detail">{a.detail}</span>}
              </a>
              <RunbookLink id={a.runbook} title={runbookTitle(snap, a.runbook)} />
            </div>
          ))}
        </section>
      )}

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

function ServicesCard({ snap }: { snap: Snapshot }) {
  const list = snap.services
  const live = list.filter((s) => s.state !== 'off')
  const up = live.filter((s) => s.state === 'up').length
  return (
    <Card class="span-7" title={<>Services <span class="count">{up}/{live.length} up</span></>} icon={<IconServices size={15} />} href="#/services">
      <div class="svc-list">
        {list.map((s) => (
          <a class="svc-row" key={s.id} href={`#/services/${encodeURIComponent(s.id)}`}>
            <Dot level={s.level} size={8} />
            <span class="svc-name">{s.title}</span>
            <span class="svc-note">{s.note}</span>
            <Beats beats={s.beats} n={36} height={16} />
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
    <Card title={<>Backups <span class="count">{ok}/{b.sets.length} verified</span></>} icon={<IconBackups size={15} />} href="#/backups">
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
    <Card class="span-6" title={<>Alerts <span class="count">{a.open.length} open</span></>} icon={<IconAlerts size={15} />} href="#/alerts">
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
        {recent.length === 0 && <li class="muted">A quiet month. No alerts in the log.</li>}
      </ul>
    </Card>
  )
}

function TimersCard({ snap, now }: { snap: Snapshot; now: number }) {
  const next = sortTimers(snap.timers, true).slice(0, 6)
  return (
    <Card class="span-6" title="Next up" icon={<IconTimers size={15} />} href="#/timers">
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
      <Card title="Restore drill" icon={<IconShield size={15} />} href="#/backups">
        <p class="muted">No drill has run yet.</p>
      </Card>
    )
  }
  const total = r.passed + r.failed
  return (
    <Card title="Restore drill" icon={<IconShield size={15} />} href="#/backups">
      <div class="drill-mini">
        <div class={`readout lv-${r.failed ? 'crit' : 'ok'}`}>
          <span class="readout-num">{r.passed}<i>/{total}</i></span>
          <span class="readout-label">{r.failed ? `${r.failed} failed` : 'restored'}</span>
        </div>
        <div class="drill-facts">
          <div class="drill-big">{r.failed ? 'A set did not come back' : 'Every set came back'}</div>
          <div class="muted">{ago(r.end, now)} · {duration(r.start, r.end)}, unpacked in RAM</div>
          {nextDrill?.next && <div class="muted">next drill {until(nextDrill.next, now)}</div>}
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
        <div class="check-icon"><IconHeart size={17} /></div>
        <div>
          <div class="check-label">Heartbeat</div>
          <div class={`check-value lv-text-${hb.level}`}>
            {hb.unit ? (hb.ok ? `${hb.pings_24h}/${hb.runs_24h} pings` : 'Withheld') : 'Not set up'}
          </div>
          <div class="check-sub">{hb.last ? `last ${ago(hb.last, now)}` : hb.reason}</div>
        </div>
      </a>
      <a class="check" href="#/drift">
        <div class="check-icon"><IconDrift size={17} /></div>
        <div>
          <div class="check-label">Config drift</div>
          <div class={`check-value lv-text-${d.level === 'info' ? 'ok' : d.level}`}>
            {d.result === 'clean' ? 'No drift' : d.result === 'drift' ? plural(d.files.length + d.disabled_timers.length, 'difference') : 'Unknown'}
          </div>
          <div class="check-sub">{d.tracked} files tracked · checked {ago(d.checked, now)}</div>
        </div>
      </a>
      <a class="check check-wide" href="#/alerts">
        <div class="check-icon"><IconShield size={17} /></div>
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

function SinceLine({ snap, now, since }: { snap: Snapshot; now: number; since: number | null }) {
  if (since === null) {
    return <p class="since"><span class="since-label">First look</span>From now on, this line tells you what happened while you were away.</p>
  }
  if (now - since < 60_000) return null
  const parts = sinceParts(snap, since)
  const away = awayFor(since, now)
  if (!parts.length) {
    return <p class="since"><span class="since-label">While you were away</span>Nothing happened in the {away} since you last looked.</p>
  }
  return (
    <p class="since">
      <span class="since-label">While you were away</span>
      In the {away} since you last looked,{' '}
      {parts.map((p, i) => (
        <>
          {i > 0 && (i === parts.length - 1 ? ' and ' : ', ')}
          <a href={p.href} class={`since-part lv-${p.level ?? 'ok'}`}>{p.text}</a>
        </>
      ))}
      .
    </p>
  )
}
