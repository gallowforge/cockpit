// Overview: is everything fine? If not, what, and what do I do? How has the
// day been, and what happened since I last looked?
import { useEffect, useMemo, useRef, useState } from 'preact/hooks'
import type { ViewProps } from '../app'
import type { Attention, Level, Snapshot } from '../types'
import { areaHref, awayEvents, bucket, clearFacts, dayUptime, daySeen, durationWords, fleetDay, fullDay, heroOf, notableTimers, prioLevel, servicesLevel, slotStart, weekday, worst, type Event, type Hero } from '../derive'
import { ago, bytes, clock, inAbout, ms, pct, plural, precise, sourceName } from '../format'
import { safeHref } from '../markdown'
import { Btn, Day, Empty, Figures, Glyph, Meter, type FigProps, useTip } from '../components/ui'
import { IconAlert, IconBackups, IconCheck, IconChevron, IconClose, IconDrill, IconExternal, IconEyeOff, IconInfo, IconPulse, IconX } from '../components/icons'
import { DayAxis, fmtPct, ServiceTable } from './services'

export function Overview({ snap, now, since, online }: ViewProps) {
  const hero = heroOf(snap, now, { online })
  const [how, setHow] = useState(false)
  const att = snap.status.attention
  const blind = snap.status.blind ?? []
  return (
    <div class="ov">
      <div class="ov-main">
        <header class="page-head">
          <div><h1>Overview</h1></div>
          <div class="aside"><button type="button" class="btn" onClick={() => setHow(true)}><IconInfo size={14} />How Cockpit decides</button></div>
        </header>
        <Status hero={hero} snap={snap} now={now} />
        {att.length > 1 && <Needs list={att} snap={snap} label="Needs you" />}
        {att.length > 0 && blind.length > 0 && <Needs list={blind} snap={snap} label="Can't see" />}
        <DayStrip snap={snap} />
        <Figures items={figures(snap, now)} />
        <div class="only-phone"><SinceLooked snap={snap} now={now} since={since} /></div>
        <section class="sec" aria-label="Services">
          <div class="sec-h"><h2>Services</h2><a class="more" href="#/services">All services</a></div>
          <ServiceTable list={snap.services} now={now} />
        </section>
      </div>
      <aside class="ov-rail" aria-label="Details">
        <div class="only-desk"><SinceLooked snap={snap} now={now} since={since} /></div>
        <BackupsMini snap={snap} now={now} />
        <NextUp snap={snap} now={now} />
        <HostMini snap={snap} />
        <Coverage snap={snap} now={now} />
      </aside>
      {how && <HowSheet snap={snap} now={now} onClose={() => setHow(false)} />}
    </div>
  )
}

const LIGHT_LEVEL: Record<Hero['light'], Level> = { calm: 'ok', attn: 'warn', down: 'crit', blind: 'unknown', none: 'off' }

function StatusIcon({ level }: { level: Level }) {
  const tone = { ok: ['#163a2b', '#3ecf8e'], warn: ['#3d2b14', '#f0a33a'], crit: ['#3d191b', '#f15b5b'], unknown: ['transparent', '#8a92a3'], off: ['#1b1d22', '#787e8a'], info: ['#1b1d22', '#787e8a'] }[level]
  return (
    <svg class="status-glyph" width="28" height="28" viewBox="0 0 28 28" aria-hidden="true">
      <circle cx="14" cy="14" r={level === 'unknown' ? 12.2 : 13} fill={tone[0]} stroke={level === 'unknown' ? tone[1] : 'none'} stroke-width="1.6" stroke-dasharray={level === 'unknown' ? '3 3' : undefined} />
      {level === 'ok' && <path d="M8.6 14.4l3.6 3.6 7.2-8" fill="none" stroke={tone[1]} stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />}
      {(level === 'crit' || level === 'warn') && <path d="M14 8.6v6.4M14 19h.01" fill="none" stroke={tone[1]} stroke-width="2.2" stroke-linecap="round" />}
      {level === 'unknown' && <path d="M11.5 11.2a2.6 2.6 0 1 1 3.7 2.4c-.75.37-1.2.95-1.2 1.75M14 18.6h.01" fill="none" stroke="#c2c8d2" stroke-width="1.8" stroke-linecap="round" />}
      {(level === 'off' || level === 'info') && <path d="M14 9v5l3 2" fill="none" stroke={tone[1]} stroke-width="1.8" stroke-linecap="round" />}
    </svg>
  )
}

/** The answer, then the proof or the facts behind it, then what to do. */
function Status({ hero, snap, now }: { hero: Hero; snap: Snapshot; now: number }) {
  const err = hero.kind === 'blind' && hero.blind.length === 1 ? hero.blind[0].evidence : undefined
  return (
    <section class="status" aria-live="polite">
      <div class="status-row">
        <StatusIcon level={LIGHT_LEVEL[hero.light]} />
        <div style={{ minWidth: 0, flex: 1 }}>
          <h2>{hero.title}</h2>
          {hero.kind === 'clear'
            ? <ul class="proof" aria-label="What was checked">{clearFacts(snap, now).map((f) => <li key={f.text}><a href={f.href}><IconCheck size={14} />{f.text}</a></li>)}</ul>
            : (hero.kind === 'down' || hero.kind === 'attn') && hero.detail.length === 1
              ? <ul class="proof plain">{attnFacts(hero, snap, now).map((f) => <li key={f}>{f}</li>)}</ul>
              : <p class="detail">{hero.detail.map((p, i) => (p.href ? <a key={i} href={p.href}>{p.text}</a> : <span key={i}>{p.text}</span>))}</p>}
          {err && <p class="evidence"><b>Error</b>{err}</p>}
          {hero.actions.length > 0 && (
            <div class="acts">
              {hero.actions.map((a) => (
                <Btn key={a.label} href={a.href} primary={a.primary} external={a.external}>{a.label}{a.external ? <IconExternal size={13} /> : <IconChevron size={13} />}</Btn>
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  )
}

/** The facts behind one problem. A service that is down is told in plain
 *  words from its own data; anything else keeps the collector's wording,
 *  split at its separators. */
function attnFacts(hero: Hero, s: Snapshot, now: number): string[] {
  const a = hero.attention[0]
  const svc = a?.area === 'services' ? s.services.find((x) => x.id === a.ref) : undefined
  if (svc) {
    const out: string[] = []
    if (svc.since) out.push(`${svc.state === 'down' ? 'Down' : svc.state === 'degraded' ? 'Degraded' : 'In this state'} for ${durationWords(now - ms(svc.since))}`)
    if (svc.probe && !svc.probe.ok) out.push(`Its check on ${svc.probe.target.replace(/^https?:\/\/(127\.0\.0\.1|localhost)/, '')} ${svc.probe.error === 'timeout' ? 'timed out' : `failed: ${svc.probe.error ?? 'no answer'}`}`)
    const alert = s.alerts.open.find((i) => i.title.toLowerCase().includes(svc.title.toLowerCase()))
    if (alert) out.push(`Alert sent to your phone at ${clock(alert.opened)}`)
    const others = s.services.filter((x) => x.id !== svc.id && x.state !== 'off')
    const othersUp = others.filter((x) => x.state === 'up').length
    out.push(othersUp === others.length ? `The other ${others.length} services are up` : `${othersUp} of the other ${others.length} services up`)
    return out
  }
  return hero.detail[0].text.replace(/\.$/, '').split(/\s·\s|\.\s+(?=Also:)/).map((t) => t.trim()).filter(Boolean)
    .map((t) => (/^[a-z][a-z ]/.test(t) ? t.charAt(0).toUpperCase() + t.slice(1) : t))
}

function Needs({ list, snap, label }: { list: Attention[]; snap: Snapshot; label: string }) {
  return (
    <section class="needs" aria-label={label}>
      {list.map((a, i) => {
        const svc = a.area === 'services' ? snap.services.find((x) => x.id === a.ref) : undefined
        const app = svc?.url ? safeHref(svc.url) : null
        return (
          <div key={i} class="need">
            <Glyph level={a.level} size={16} />
            <a href={areaHref(a.area, a.ref)} style={{ minWidth: 0 }}>
              <h3>{a.title}</h3>
              {a.detail && <p>{a.detail}</p>}
              {a.evidence && (a.level === 'unknown' ? <p class="evidence"><b>Error</b>{a.evidence}</p> : <p>Also: {a.evidence}</p>)}
            </a>
            <div class="need-acts">
              {a.runbook && <Btn href={`#/runbooks/${encodeURIComponent(a.runbook)}`}>Checklist</Btn>}
              {svc && app && <Btn href={app} external label={`Open ${svc.title}`}><IconExternal size={13} /></Btn>}
            </div>
          </div>
        )
      })}
    </section>
  )
}

/** The day at a glance: every service together, in quarter hours. */
function DayStrip({ snap }: { snap: Snapshot }) {
  const day = useMemo(() => fleetDay(snap.services), [snap])
  const [tip, setTip] = useTip()
  const cells = bucket(day, 96)
  const seen = daySeen(day)
  const lines = snap.services.filter((s) => s.state !== 'off').map((s) => ({ s, b: bucket(fullDay(s.day), 96) }))
  const downNow = cells[95] === 'x'
  const past = cells.slice(0, 95).split('').filter((c, i, a) => c === 'x' && a[i - 1] !== 'x').length
  const summary = seen === 0 ? 'no history yet' : downNow ? 'down now' : cells[95] === '?' ? "can't see now" : past ? plural(past, 'outage') + ', recovered' : 'no outage'
  const cell = (i: number | null, e?: MouseEvent) => {
    if (i == null) return setTip(null)
    const from = slotStart(snap.generated, i * 3, 288)
    const names = (ch: string) => lines.filter((l) => l.b[i] === ch).map((l) => l.s.title)
    const down = names('x')
    const unk = names('?')
    const deg = names('d')
    const what = cells[i] === '?' && unk.length === lines.length ? "Cockpit wasn't watching"
      : down.length ? `${down.join(', ')} down`
        : deg.length ? `${deg.join(', ')} degraded`
          : unk.length ? `${plural(unk.length, 'service')} not seen`
            : `all ${lines.length} up`
    setTip(<><b>{clock(new Date(from).toISOString())}–{clock(new Date(from + 15 * 60e3).toISOString())}</b> · {what}</>, e)
  }
  return (
    <section class="daystrip" aria-label="The last 24 hours">
      <div class="strip-h"><span><b>Last 24 hours</b><span class="opt"> · every service, in quarter hours</span></span><span class="num">{seen && seen < 276 ? `watched ${Math.round(seen / 12)} of 24 h · ` : ''}{summary}</span></div>
      <Day day={day} n={96} size="tall" label={`All services, last 24 hours: ${summary}`} onCell={cell} />
      <DayAxis generated={snap.generated} />
      {tip}
    </section>
  )
}

function figures(s: Snapshot, now: number): FigProps[] {
  const svcs = s.services.filter((x) => x.state !== 'off')
  const up = svcs.filter((x) => x.state === 'up').length
  const ups = svcs.map((x) => dayUptime(fullDay(x.day))).filter((v): v is number => v != null)
  const avail = ups.length ? ups.reduce((a, b) => a + b, 0) / ups.length : null
  const seen = Math.max(0, ...svcs.map((x) => daySeen(fullDay(x.day))))
  const bad = s.backups.sets.filter((b) => b.level !== 'ok').length
  const verified = s.backups.sets.map((b) => ms(b.last_ok)).filter(isFinite)
  const newest = verified.length ? Math.max(...verified) : NaN
  const sLevel = servicesLevel(s.services)
  const out: FigProps[] = [
    { label: 'Services up', value: up, unit: `/ ${svcs.length}`, caption: up === svcs.length ? 'every check answering' : sLevel === 'unknown' ? `${svcs.length - up} can't be confirmed` : svcs.filter((x) => x.state !== 'up').map((x) => x.title).slice(0, 2).join(', ') + (svcs.length - up > 2 ? ` and ${svcs.length - up - 2} more` : '') + ' not up', level: sLevel === 'info' ? undefined : sLevel },
    { label: 'Availability', value: avail == null ? '—' : fmtPct(avail).replace('%', ''), unit: avail == null ? undefined : '%', caption: seen === 0 ? 'no history yet' : seen < 276 ? `over the ${Math.max(1, Math.round(seen / 12))} h Cockpit watched` : 'last 24 hours, all services' },
    { label: 'Backups verified', value: s.backups.sets.length - bad, unit: `/ ${s.backups.sets.length}`, caption: isFinite(newest) ? `last at ${clock(new Date(newest).toISOString())}` : 'none yet', level: s.backups.level === 'info' ? undefined : s.backups.level },
  ]
  const open = s.alerts.open.length
  const d = s.drill.runs[0]
  if (open) out.push({ label: 'Open alerts', value: open, caption: `opened ${clock(s.alerts.open[0].opened)}`, level: worst(s.alerts.open.map((i) => prioLevel(i.prio))) })
  else out.push({ label: 'Restore drill', value: d ? d.passed : '—', unit: d ? `/ ${d.passed + d.failed}` : undefined, caption: d ? `${d.failed ? 'failed' : 'passed'} ${weekday(d.end, now)}` : 'none has run yet', level: s.drill.level === 'info' || s.drill.level === 'ok' ? undefined : s.drill.level })
  return out
}

/* ---------- the rail ---------- */

const EV_ICON: Record<Event['kind'], (p: { size?: number }) => preact.JSX.Element> = { alert: IconAlert, backup: IconBackups, drill: IconDrill, timer: IconX }

function SinceLooked({ snap, now, since }: { snap: Snapshot; now: number; since?: number | null }) {
  const { from, list } = useMemo(() => awayEvents(snap, since, now), [snap, since, Math.floor(now / 60000)])
  const first = !!since && since < now
  const shown = list.slice(0, 6)
  return (
    <section class="rail-sec" aria-label="Since you last looked">
      <div class="sec-h"><h2>{first ? 'Since you last looked' : 'Last 24 hours'}</h2><span class="aside num">{first ? `${clock(new Date(from).toISOString())} · ${ago(new Date(from).toISOString(), now)}` : ''}</span></div>
      {shown.length === 0 && <div class="ev ok"><span /><IconCheck size={15} /><div><b>Nothing happened</b><span>No alert, failed job or backup problem.</span></div></div>}
      {shown.map((e) => {
        const Icon = e.kind === 'alert' && e.level !== 'crit' && e.level !== 'warn' ? IconPulse : EV_ICON[e.kind]
        const lv = e.level === 'info' ? 'off' : e.level
        return (
          <a key={e.id} class={`ev ${e.kind === 'alert' && lv === 'off' ? 'warn' : lv}`} href={e.href}>
            <time>{clock(new Date(e.t).toISOString())}</time>
            <Icon size={15} />
            <div><b>{e.title}{e.count && e.count > 1 ? ` · ${e.count}×` : ''}</b>{e.sub && <span>{e.sub}</span>}</div>
          </a>
        )
      })}
      {list.length > shown.length && <a class="more" href="#/history" style={{ display: 'block', paddingTop: '8px' }}>{plural(list.length - shown.length, 'more event')} in History</a>}
    </section>
  )
}

function BackupsMini({ snap, now }: { snap: Snapshot; now: number }) {
  const sets = snap.backups.sets
    .map((b) => ({ b, used: b.last_ok && b.max_age_h ? pct(now - ms(b.last_ok), b.max_age_h * 3600e3) : 100 }))
    .sort((x, y) => Number(y.b.level !== 'ok') - Number(x.b.level !== 'ok') || y.b.bytes - x.b.bytes)
  if (!sets.length) return null
  const shown = sets.slice(0, 5)
  const rest = sets.slice(5)
  return (
    <section class="rail-sec" aria-label="Backups">
      <div class="sec-h"><h2>Backups</h2><a class="more" href="#/backups">{plural(sets.length, 'set')} · {bytes(snap.backups.bytes)}</a></div>
      {shown.map(({ b, used }) => (
        <a key={b.name} class="mini" href={`#/backups/${encodeURIComponent(b.name)}`}>
          <span style={{ minWidth: 0 }}><b>{b.name}</b><small>{b.level === 'ok' ? `verified ${b.last_ok ? ago(b.last_ok, now) : 'never'}` : b.detail}</small></span>
          <Meter pct={used} level={b.level !== 'ok' ? b.level : used > 80 ? 'warn' : 'ok'} label={`${b.name}: age against its ${b.max_age_h}-hour limit`} />
          <span class="r">{bytes(b.bytes)}</span>
        </a>
      ))}
      {rest.length > 0 && <a class="mini" href="#/backups"><span class="muted">{plural(rest.length, 'more set')}</span><span /><span class="r">{bytes(rest.reduce((a, x) => a + x.b.bytes, 0))}</span></a>}
    </section>
  )
}

function NextUp({ snap, now }: { snap: Snapshot; now: number }) {
  const next = notableTimers(snap.timers).slice(0, 4)
  return (
    <section class="rail-sec" aria-label="Next up">
      <div class="sec-h"><h2>Next up</h2><a class="more" href="#/jobs">All jobs</a></div>
      {next.length === 0 && <Empty left>Nothing scheduled.</Empty>}
      {next.map((t) => {
        const far = ms(t.next) - now > 20 * 3600e3
        return (
          <a key={t.unit} class="job" href="#/jobs">
            <time>{clock(t.next)}{far ? ` ${new Date(ms(t.next)).toLocaleDateString([], { weekday: 'short' })}` : ''}</time>
            <span><b>{t.description || t.activates.replace(/\.service$/, '')}</b><span>{inAbout(t.next, now)}</span></span>
          </a>
        )
      })}
    </section>
  )
}

function HostMini({ snap }: { snap: Snapshot }) {
  const h = snap.host
  const mem = h.mem_total ? 100 - pct(h.mem_available, h.mem_total) : 0
  const disk = h.disks[0]
  const temp = h.temp_c
  return (
    <section class="rail-sec" aria-label="System">
      <div class="sec-h"><h2>System</h2><a class="more" href="#/system">{h.cpus} cores · up {precise(h.uptime_s * 1000).replace(/ \d+[hm]$/, '')}</a></div>
      <div class="gauge"><span class="k">CPU</span><span class="v">{h.cpu_pct != null ? `${Math.round(h.cpu_pct)}%` : '—'} · load {h.load[0].toFixed(2)}</span><Meter pct={h.cpu_pct ?? 0} level="plain" label="CPU" /></div>
      {temp != null && <div class="gauge"><span class="k">Temperature</span><span class="v">{Math.round(temp)} °C{h.throttled === '0x0' ? ' · not throttled' : ''}</span><Meter pct={pct(temp, 85)} level={temp >= 80 ? 'warn' : 'plain'} label="Temperature against 85 °C" /></div>}
      <div class="gauge"><span class="k">Memory</span><span class="v">{bytes(h.mem_total - h.mem_available)} of {bytes(h.mem_total)}</span><Meter pct={mem} level={mem > 90 ? 'warn' : 'plain'} label="Memory" /></div>
      {disk && <div class="gauge"><span class="k">Disk {disk.mount}</span><span class="v">{bytes(disk.used)} of {bytes(disk.size)}</span><Meter pct={pct(disk.used, disk.size)} level={pct(disk.used, disk.size) >= 90 ? 'warn' : 'plain'} label={`Disk ${disk.mount}`} /></div>}
    </section>
  )
}

function Coverage({ snap, now }: { snap: Snapshot; now: number }) {
  const ok = snap.sources.filter((s) => s.ok).length
  return (
    <section class="rail-sec" aria-label="What Cockpit can see">
      <div class="sec-h"><h2>What Cockpit can see</h2><span class="aside">{ok} of {snap.sources.length} sources</span></div>
      {snap.sources.map((s) => (
        <div key={s.name} class={`src${s.ok ? '' : ' bad'}`}>
          {s.ok ? <IconCheck size={14} /> : <IconEyeOff size={14} />}
          <span class="n">{sourceName(s.name)}</span>
          <span class="v">{s.ok ? ago(s.at, now) : 'failed'}</span>
          {!s.ok && s.error && <span class="err">{s.error}</span>}
        </div>
      ))}
    </section>
  )
}

/** Every check behind the headline and its result, so the all-clear is earned. */
function HowSheet({ snap, now, onClose }: { snap: Snapshot; now: number; onClose: () => void }) {
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const back = document.activeElement as HTMLElement | null
    box.current?.focus()
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    addEventListener('keydown', onKey)
    return () => {
      removeEventListener('keydown', onKey)
      back?.focus()
    }
  }, [])
  const svcs = snap.services.filter((x) => x.state !== 'off')
  const rows: { level: Level; name: string; text: string; href: string }[] = [
    { level: servicesLevel(snap.services), name: 'Services', text: `${svcs.filter((x) => x.state === 'up').length} of ${svcs.length} up; any down or degraded counts`, href: '#/services' },
    { level: snap.backups.level, name: 'Backups', text: `every set verified within its own limit (${[...new Set(snap.backups.sets.map((b) => b.max_age_h))].join(' or ')} hours)`, href: '#/backups' },
    { level: snap.drill.level, name: 'Restore drill', text: snap.drill.runs[0] ? `the last drill passed and ran within 8 days (${ago(snap.drill.runs[0].end, now)})` : 'no drill has run yet', href: '#/backups' },
    { level: snap.alerts.level, name: 'Alerts', text: 'no open alert at normal or high priority, and every push delivered', href: '#/history' },
    { level: worst(snap.timers.filter((t) => t.highlight).map((t) => t.level)), name: 'Scheduled jobs', text: 'every homelab job enabled and its last run fine', href: '#/jobs' },
    { level: snap.drift.level === 'info' ? 'ok' : snap.drift.level, name: 'Config drift', text: 'the live files match the repo', href: '#/system' },
    { level: snap.heartbeat.level, name: 'Heartbeat', text: 'the dead-man switch pinged in the last 30 minutes', href: '#/system' },
    { level: snap.health.level, name: 'Daily health check', text: 'ran in the last 29 hours with no open category', href: '#/system' },
    { level: snap.host.level, name: 'Host', text: 'temperature, power, memory and disks inside their limits', href: '#/system' },
    { level: snap.sources.every((s) => s.ok) ? 'ok' : 'unknown', name: 'What Cockpit reads', text: `${snap.sources.filter((s) => s.ok).length} of ${snap.sources.length} sources read on the last pass`, href: '#/system' },
  ]
  return (
    <div class="backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div class="sheet" role="dialog" aria-modal="true" aria-label="How Cockpit decides" tabIndex={-1} ref={box}>
        <div class="sheet-head">
          <h2>How Cockpit decides</h2>
          <button type="button" class="icon-btn" aria-label="Close" onClick={onClose}><IconClose size={16} /></button>
        </div>
        <p class="sub">"Nothing needs you" only when every check below is fine. A check Cockpit cannot make is never counted as fine.</p>
        <ul class="how">
          {rows.map((r) => (
            <li key={r.name}>
              <a href={r.href} onClick={onClose}>
                <Glyph level={r.level === 'info' ? 'ok' : r.level} size={16} />
                <span><b>{r.name}</b><span>{r.text}</span></span>
              </a>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
