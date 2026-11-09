// Now: is everything fine? If not, what, and what do I do? What happened while I was away?
import { useMemo, useState } from 'preact/hooks'
import type { ViewProps } from '../app'
import type { Attention, Level, Snapshot } from '../types'
import { alertHistogram, areaHref, awayEvents, heroOf, notableTimers, servicesLevel, worst, type Hero } from '../derive'
import { ago, bytes, clock, ms, pct, plural, until } from '../format'
import { sinceParts } from '../lastlook'
import { Bars, Btn, Dots, Glyph, Spark, Strip, mergeBeats } from '../components/ui'
import { IconChevron, IconClose, IconExternal, IconInfo } from '../components/icons'

export function Now({ snap, now, since, online }: ViewProps) {
  const hero = heroOf(snap, now, { online })
  const [how, setHow] = useState(false)
  const many = snap.status.attention.length > 1
  return (
    <div class={`now k-${hero.kind}`}>
      <div class="now-top">
        <HeroPane hero={hero} snap={snap} now={now} since={since} onHow={() => setHow(true)} />
        <aside class="now-side">
          <NextUp snap={snap} now={now} />
          <HostCard snap={snap} />
        </aside>
      </div>
      {many && (
        <section class="needs" aria-label="Needs you">
          {snap.status.attention.map((a, i) => <NeedCard key={i} a={a} snap={snap} />)}
        </section>
      )}
      {snap.status.attention.length > 0 && (snap.status.blind ?? []).length > 0 && (
        <section class="needs" aria-label="Can't see">
          {(snap.status.blind ?? []).map((b, i) => <NeedCard key={i} a={b} snap={snap} />)}
        </section>
      )}
      <Tiles snap={snap} now={now} />
      <p class="foot-line">Read-only. Cockpit cannot change the server.{snap.demo ? ' Demo data.' : ''}</p>
      {how && <HowSheet snap={snap} now={now} onClose={() => setHow(false)} />}
    </div>
  )
}

function HeroPane({ hero, snap, now, since, onHow }: { hero: Hero; snap: Snapshot; now: number; since?: number | null; onHow: () => void }) {
  return (
    <section class={`hero lit lit-${hero.light}`} aria-live="polite">
      <div class="hero-top">
        <span class="hero-host">{snap.title}</span>
        <button type="button" class="hero-how" onClick={onHow}><IconInfo size={15} /> How Cockpit decides</button>
      </div>
      <h1 class="hero-title">{hero.title}</h1>
      <p class="hero-detail">
        {hero.detail.map((p, i) => (p.href ? <a key={i} href={p.href}>{p.text}</a> : <span key={i}>{p.text}</span>))}
      </p>
      {hero.actions.length > 0 && (
        <div class="hero-actions">
          {hero.actions.map((a) => (
            <Btn key={a.label} href={a.href} primary={a.primary} external={a.external}>
              {a.label}{a.external ? <IconExternal size={15} /> : <IconChevron size={15} />}
            </Btn>
          ))}
        </div>
      )}
      <AwayRibbon snap={snap} now={now} since={since} />
    </section>
  )
}

/** A line of light from the last look to now, one mark per thing that happened. */
function AwayRibbon({ snap, now, since }: { snap: Snapshot; now: number; since?: number | null }) {
  const { from, list } = useMemo(() => awayEvents(snap, since, now), [snap, since, Math.floor(now / 60000)])
  const span = Math.max(1, now - from)
  const parts = sinceParts(snap, from)
  const first = since && since < now
  return (
    <a class="ribbon" href="#/history" aria-label="What happened while you were away">
      <span class="ribbon-line">
        {list.map((e) => (
          <i key={e.id} class={`mk mk-${e.level}`} style={{ left: `${((e.t - from) / span) * 100}%` }}
            title={`${clock(new Date(e.t).toISOString())} ${e.title}`} />
        ))}
      </span>
      <span class="ribbon-ends"><span>{first ? `Last look ${ago(new Date(from).toISOString(), now)}` : 'The last 24 hours'}</span><span>now</span></span>
      <span class="ribbon-words">
        {parts.length === 0
          ? first ? 'Nothing happened while you were away.' : 'A quiet day.'
          : (<>{first ? 'While you were away: ' : 'In the last 24 hours: '}{parts.map((p, i) => <span key={i}>{i ? '; ' : ''}{p.text}</span>)}.</>)}
      </span>
    </a>
  )
}

function NeedCard({ a, snap }: { a: Attention; snap: Snapshot }) {
  const svc = a.area === 'services' ? snap.services.find((x) => x.id === a.ref) : undefined
  const light = a.level === 'crit' ? 'down' : a.level === 'warn' ? 'attn' : 'blind'
  return (
    <article class={`need lit lit-${light}`}>
      <a class="need-main" href={areaHref(a.area, a.ref)}>
        <Glyph level={a.level} size={16} />
        <div>
          <h3>{a.title}</h3>
          {a.detail && <p>{a.detail}</p>}
          {a.evidence && (a.level === 'unknown'
            ? <p class="need-ev need-err"><span>Error</span> <code>{a.evidence}</code></p>
            : <p class="need-ev">Also: {a.evidence}</p>)}
        </div>
      </a>
      <div class="need-act">
        {a.runbook && <Btn href={`#/runbooks/${encodeURIComponent(a.runbook)}`} primary>Checklist</Btn>}
        {svc?.url && <Btn href={svc.url} external>Open<IconExternal size={14} /></Btn>}
      </div>
    </article>
  )
}

function tileLevel(l: Level): string {
  return l === 'crit' ? ' lit lit-down' : l === 'warn' ? ' lit lit-attn' : l === 'unknown' ? ' blind' : ''
}

function Tiles({ snap, now }: { snap: Snapshot; now: number }) {
  const svcs = snap.services.filter((x) => x.state !== 'off')
  const up = svcs.filter((x) => x.state === 'up').length
  const sLevel = servicesLevel(snap.services)
  const verified = snap.backups.sets.map((b) => ms(b.last_ok)).filter(isFinite)
  const oldest = verified.length ? new Date(Math.min(...verified)).toISOString() : undefined
  const backupTimer = snap.timers.find((t) => /backup\.service$/.test(t.activates) && !/restore|drill/.test(t.activates))
  const runs = snap.backups.runs.slice(0, 14).reverse()
  const drill = snap.drill.runs[0]
  const drills = snap.drill.runs.slice(0, 8).reverse()
  const open = snap.alerts.open.length
  const next = notableTimers(snap.timers)
  const disk = snap.host.disks[0]
  const sysLevel = worst([snap.host.level, snap.drift.level === 'info' ? 'ok' : snap.drift.level, snap.heartbeat.level === 'off' ? 'ok' : snap.heartbeat.level, snap.health.level])
  return (
    <div class="tiles">
      <a class={`tile${tileLevel(sLevel)}`} href="#/services">
        <span class="tile-name">Services</span>
        <span class="tile-fig">{up}<span class="tile-of"> of {svcs.length}</span></span>
        <Strip beats={mergeBeats(snap.services.filter((x) => x.state !== 'off').map((x) => x.beats))} />
        <span class="tile-cap">{up === svcs.length ? 'All up' : `${svcs.length - up} not up`} · the last 30 minutes</span>
      </a>
      <a class={`tile${tileLevel(snap.backups.level)}`} href="#/backups">
        <span class="tile-name">Backups</span>
        <span class="tile-fig">{oldest ? ago(oldest, now).replace(' ago', '') : '—'}<span class="tile-of">{oldest ? ' oldest' : ''}</span></span>
        <Dots items={runs.map((r) => ({ level: r.result === 'failed' ? 'crit' : r.result === 'success' ? 'ok' : 'info', label: `${clock(r.start)} ${r.result}` }))} />
        <span class="tile-cap">{plural(snap.backups.sets.length, 'set')} verified · next {backupTimer?.next ? until(backupTimer.next, now) : 'not scheduled'}</span>
      </a>
      <a class={`tile${tileLevel(snap.drill.level)}`} href="#/backups">
        <span class="tile-name">Restore drill</span>
        <span class="tile-fig">{drill ? <>{drill.passed}<span class="tile-of"> of {drill.passed + drill.failed}</span></> : '—'}</span>
        <Dots items={drills.map((d) => ({ level: d.failed ? 'crit' : 'ok', label: `${clock(d.end)} ${d.passed} of ${d.passed + d.failed}` }))} />
        <span class="tile-cap">{drill ? `restored ${ago(drill.end, now)}` : 'No drill in the journal yet'}</span>
      </a>
      <a class={`tile${tileLevel(snap.alerts.level)}`} href="#/history">
        <span class="tile-name">Alerts</span>
        <span class="tile-fig">{open ? open : 'None'}<span class="tile-of"> open</span></span>
        <Bars bins={alertHistogram(snap.alerts.incidents.filter((i) => i.state !== 'info'), now, 14)} h={28} mono={snap.alerts.level === 'ok' || snap.alerts.level === 'info'} />
        <span class="tile-cap">{plural(snap.alerts.sent_7d, 'push', 'pushes')} this week</span>
      </a>
      <a class={`tile${tileLevel(worst(snap.timers.filter((t) => t.highlight).map((t) => t.level)))}`} href="#/system">
        <span class="tile-name">Next job</span>
        <span class="tile-fig tile-fig-s">{next[0] ? until(next[0].next, now).replace('in ', '') : '—'}</span>
        <span class="tile-list">{next.slice(0, 2).map((t) => <span key={t.unit}>{t.activates.replace(/\.service$/, '').replace(/^homelab-/, '')} <b>{clock(t.next)}</b></span>)}</span>
        <span class="tile-cap">{plural(snap.timers.filter((t) => t.highlight).length, 'scheduled job')}</span>
      </a>
      <a class={`tile${tileLevel(sysLevel)}`} href="#/system">
        <span class="tile-name">System</span>
        <span class="tile-fig tile-fig-s">{snap.host.temp_c != null ? `${Math.round(snap.host.temp_c)} °C` : '—'}</span>
        <span class="tile-list">
          {disk && <span>disk {Math.round(pct(disk.used, disk.size))}% of {bytes(disk.size)}</span>}
          <span>{snap.drift.result === 'clean' ? 'no drift' : snap.drift.result === 'drift' ? `${plural(snap.drift.files.length, 'file')} drifted` : "drift can't be checked"}</span>
        </span>
        <span class="tile-cap">heartbeat {snap.heartbeat.level === 'ok' ? `${snap.heartbeat.pings_24h} pings today` : snap.heartbeat.level === 'off' ? 'not set up' : 'needs a look'}</span>
      </a>
    </div>
  )
}

function NextUp({ snap, now }: { snap: Snapshot; now: number }) {
  const next = notableTimers(snap.timers).slice(0, 4)
  return (
    <a class="side-card" href="#/system">
      <span class="side-h">Next up</span>
      {next.length === 0 && <span class="muted">Nothing scheduled.</span>}
      {next.map((t) => (
        <span class="next-row" key={t.unit}>
          <span class="next-name">{t.description || t.activates.replace(/\.service$/, '')}</span>
          <span class="next-at"><b>{clock(t.next)}</b> {until(t.next, now)}</span>
        </span>
      ))}
    </a>
  )
}

function HostCard({ snap }: { snap: Snapshot }) {
  const h = snap.host
  const mem = h.mem_total ? 100 - pct(h.mem_available, h.mem_total) : 0
  const disk = h.disks[0]
  const hist = h.history ?? []
  return (
    <a class={`side-card${tileLevel(h.level)}`} href="#/system">
      <span class="side-h">Host</span>
      <span class="host-row"><span>Temperature</span><b>{h.temp_c != null ? `${Math.round(h.temp_c)} °C` : '—'}</b></span>
      <span class="host-row"><span>CPU</span><Spark values={hist.map((x) => x.cpu)} w={90} h={20} /><b>{h.cpu_pct != null ? `${Math.round(h.cpu_pct)}%` : '—'}</b></span>
      <span class="host-row"><span>Memory</span><Spark values={hist.map((x) => x.mem)} w={90} h={20} /><b>{Math.round(mem)}%</b></span>
      {disk && <span class="host-row"><span>Disk {disk.mount}</span><b>{Math.round(pct(disk.used, disk.size))}%</b></span>}
      {h.writes_gib_day != null && <span class="host-row"><span>Writes to the boot disk</span><b>{h.writes_gib_day.toFixed(1)} GiB/day</b></span>}
    </a>
  )
}

/** Every check behind the headline and its result, so the all-clear is earned. */
function HowSheet({ snap, now, onClose }: { snap: Snapshot; now: number; onClose: () => void }) {
  const svcs = snap.services.filter((x) => x.state !== 'off')
  const rows: { level: Level; name: string; text: string; href: string }[] = [
    { level: servicesLevel(snap.services), name: 'Services', text: `${svcs.filter((x) => x.state === 'up').length} of ${svcs.length} up; any down or degraded counts`, href: '#/services' },
    { level: snap.backups.level, name: 'Backups', text: `every set verified within its own limit (${snap.backups.sets.map((b) => b.max_age_h).filter((v, i, a) => a.indexOf(v) === i).join(' or ')} hours)`, href: '#/backups' },
    { level: snap.drill.level, name: 'Restore drill', text: snap.drill.runs[0] ? `the last drill passed and ran within 8 days (${ago(snap.drill.runs[0].end, now)})` : 'no drill has run yet', href: '#/backups' },
    { level: snap.alerts.level, name: 'Alerts', text: `no open alert at normal or high priority, and every push delivered`, href: '#/history' },
    { level: worst(snap.timers.filter((t) => t.highlight).map((t) => t.level)), name: 'Scheduled jobs', text: 'every homelab job enabled and its last run fine', href: '#/system' },
    { level: snap.drift.level === 'info' ? 'ok' : snap.drift.level, name: 'Config drift', text: 'the live files match the repo', href: '#/system' },
    { level: snap.heartbeat.level, name: 'Heartbeat', text: 'the dead-man switch pinged in the last 30 minutes', href: '#/system' },
    { level: snap.health.level, name: 'Daily health check', text: 'ran in the last 29 hours with no open category', href: '#/system' },
    { level: snap.host.level, name: 'Host', text: 'temperature, power, memory and disks inside their limits', href: '#/system' },
    { level: snap.sources.every((s) => s.ok) ? 'ok' : 'unknown', name: 'What Cockpit reads', text: `${snap.sources.filter((s) => s.ok).length} of ${snap.sources.length} sources read on the last pass`, href: '#/system' },
  ]
  return (
    <div class="sheet-back" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div class="sheet" role="dialog" aria-modal="true" aria-label="How Cockpit decides">
        <div class="sheet-head">
          <h2>How Cockpit decides</h2>
          <button type="button" class="icon-btn" aria-label="Close" onClick={onClose}><IconClose size={18} /></button>
        </div>
        <p class="sheet-sub">"Nothing needs you" only when every check below is fine. A check Cockpit cannot make is never counted as fine.</p>
        <ul class="how">
          {rows.map((r) => (
            <li key={r.name}>
              <a href={r.href} onClick={onClose}>
                <Glyph level={r.level === 'off' ? 'off' : r.level} size={16} />
                <span><b>{r.name}</b><span>{r.text}</span></span>
              </a>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
