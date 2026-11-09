// Derived views of a snapshot that more than one page needs. Pure, tested.
import type { Attention, Incident, Level, Service, Snapshot, Timer } from './types'
import { ago, clock, dayLabel, ms, plural } from './format'

export const levelRank: Record<Level, number> = { ok: 0, off: 0, info: 1, unknown: 2, warn: 3, crit: 4 }

export function worst(levels: Level[]): Level {
  return levels.reduce<Level>((w, l) => (levelRank[l] > levelRank[w] ? l : w), 'ok')
}

export function servicesLevel(s: Service[]): Level {
  return worst(s.map((x) => x.level))
}

export interface ServiceGroup {
  name: string
  services: Service[]
}

/** Groups in first-seen order; services without a group go last. */
export function groupServices(list: Service[]): ServiceGroup[] {
  const order: string[] = []
  const map = new Map<string, Service[]>()
  for (const s of list) {
    const g = s.group || 'Other'
    if (!map.has(g)) {
      map.set(g, [])
      order.push(g)
    }
    map.get(g)!.push(s)
  }
  const other = order.indexOf('Other')
  if (other >= 0) order.push(order.splice(other, 1)[0])
  return order.map((name) => ({ name, services: map.get(name)! }))
}

export interface DayGroup<T> {
  label: string
  items: T[]
}

/** Incidents grouped by local day, newest first (input is newest first). */
export function byDay(list: Incident[], now: number): DayGroup<Incident>[] {
  const out: DayGroup<Incident>[] = []
  for (const i of list) {
    const label = dayLabel(i.opened, now)
    const last = out[out.length - 1]
    if (last && last.label === label) last.items.push(i)
    else out.push({ label, items: [i] })
  }
  return out
}

/** Sends per day for the last n days, split by severity, oldest first. */
export function alertHistogram(list: Incident[], now: number, days = 14) {
  const start = new Date(now)
  start.setHours(0, 0, 0, 0)
  const day0 = start.getTime() - (days - 1) * 86400000
  const bins = Array.from({ length: days }, (_, i) => ({ t: day0 + i * 86400000, crit: 0, warn: 0, info: 0 }))
  for (const i of list) {
    const t = ms(i.opened)
    const idx = Math.floor((t - day0) / 86400000)
    if (idx < 0 || idx >= days) continue
    const sev = prioLevel(i.prio)
    if (sev === 'crit') bins[idx].crit++
    else if (sev === 'warn') bins[idx].warn++
    else bins[idx].info++
  }
  return bins
}

export function prioLevel(p: string): Level {
  if (p === 'urgent' || p === 'high' || p === 'max') return 'crit'
  if (p === 'default' || p === '') return 'warn'
  return 'info'
}

/** Timers to show first: highlighted ones, then the rest, each by next run. */
export function sortTimers(list: Timer[], homelabOnly: boolean): Timer[] {
  const t = homelabOnly ? list.filter((x) => x.highlight) : list.slice()
  const next = (x: Timer) => (x.next ? ms(x.next) : Infinity)
  return t.sort((a, b) => next(a) - next(b))
}

/** Beats string to counts, for the uptime figure. */
export function uptimeOf(beats: string): number | null {
  const counted = beats.replace(/[o?]/g, '')
  if (!counted.length) return null
  const up = (counted.match(/u/g) || []).length
  return (up / counted.length) * 100
}

/** The server's clock, carried forward by the browser's monotonic clock. */
export function serverNow(snap: Snapshot | null, receivedAt: number, perfNow: number): number {
  if (!snap) return Date.now()
  return ms(snap.generated) + (perfNow - receivedAt)
}

export function areaHref(area: string, ref?: string): string {
  switch (area) {
    case 'services':
      return ref && ref !== 'unknown' && !ref.startsWith('source-') ? `#/services/${encodeURIComponent(ref)}` : '#/services'
    case 'backups':
      return ref && ref !== 'run' && !ref.startsWith('source-') ? `#/backups/${encodeURIComponent(ref)}` : '#/backups'
    case 'drill':
      return '#/backups'
    case 'alerts':
      return '#/history'
    case 'timers':
    case 'drift':
    case 'heartbeat':
    case 'health':
    case 'host':
    case 'runbooks':
      return '#/system'
    default:
      return '#/'
  }
}

/* ---------- the hero: one plain answer to "is everything fine?" ---------- */

export type HeroKind = 'clear' | 'attn' | 'down' | 'several' | 'blind' | 'stale' | 'offline' | 'maintenance'

export interface HeroAction {
  label: string
  href: string
  external?: boolean
  primary?: boolean
}

export interface Hero {
  kind: HeroKind
  /** the colour of light behind the pane */
  light: 'calm' | 'attn' | 'down' | 'blind' | 'none'
  title: string
  /** one sentence under the title; parts with an href are links */
  detail: { text: string; href?: string }[]
  actions: HeroAction[]
  attention: Attention[]
  blind: Attention[]
}

const STALE_MS = 90_000

/** Which state the hero is in, and what it says. Pure, so every state is tested. */
export function heroOf(s: Snapshot, now: number, opts: { online?: boolean; streaming?: boolean } = {}): Hero {
  const att = s.status.attention
  const blind = s.status.blind ?? []
  const base = { actions: [] as HeroAction[], attention: att, blind }
  const age = now - ms(s.generated)
  if (opts.online === false) {
    return { ...base, kind: 'offline', light: 'none', title: "You're offline.",
      detail: [{ text: `Showing the state from ${clock(s.generated)}, ${ago(s.generated, now)}. Cockpit reconnects by itself.` }] }
  }
  if (age > STALE_MS) {
    return { ...base, kind: 'stale', light: 'none', title: 'Cockpit lost sight of the house.',
      detail: [{ text: `Last snapshot ${clock(s.generated)}, ${ago(s.generated, now)}. Below is the last known state.` }] }
  }
  if (s.maintenance) {
    return { ...base, kind: 'maintenance', light: 'none', title: 'Maintenance mode.',
      detail: [{ text: `Watchdogs paused since ${clock(s.maintenance.since)}. ${att.length ? `${plural(att.length, 'thing')} would need you.` : 'Nothing would need you.'}` }] }
  }
  if (att.length === 0 && blind.length === 0) {
    return { ...base, kind: 'clear', light: 'calm', title: 'Nothing needs you.', detail: proof(s, now) }
  }
  if (att.length === 0) {
    const b = blind[0]
    return { ...base, kind: 'blind', light: 'blind', title: s.status.headline || `${b.title}.`,
      detail: [{ text: `${blind.length === 1 ? b.detail || '' : blind.map((x) => x.title).join('; ') + '.'} Everything it can see is fine.`.trim() }],
      actions: [{ label: 'Details', href: areaHref(b.area, b.ref), primary: true }] }
  }
  if (att.length === 1) {
    const a = att[0]
    const actions: HeroAction[] = []
    if (a.runbook) actions.push({ label: 'Open the checklist', href: `#/runbooks/${encodeURIComponent(a.runbook)}`, primary: true })
    const svc = a.area === 'services' ? s.services.find((x) => x.id === a.ref) : undefined
    if (svc?.url) actions.push({ label: `Open ${svc.title}`, href: svc.url, external: true, primary: !actions.length })
    actions.push({ label: 'Details', href: areaHref(a.area, a.ref), primary: !actions.length })
    const detail = [a.detail, a.evidence ? `Also: ${a.evidence}.` : ''].filter(Boolean).join('. ').replace(/\.\./g, '.')
    return { ...base, kind: a.level === 'crit' ? 'down' : 'attn', light: a.level === 'crit' ? 'down' : 'attn',
      title: sentence(a.title), detail: [{ text: sentence(detail) }], actions }
  }
  const worstOne = att[0]
  return { ...base, kind: 'several', light: worstOne.level === 'crit' ? 'down' : 'attn', title: `${att.length} things need you.`,
    detail: [{ text: 'The worst: ' }, { text: sentence(worstOne.title), href: areaHref(worstOne.area, worstOne.ref) }] }
}

function sentence(t: string): string {
  const x = t.trim()
  if (!x) return x
  const c = x.charAt(0).toUpperCase() + x.slice(1)
  return /[.?!]$/.test(c) ? c : c + '.'
}

/** Jobs worth naming: the highlighted ones that run hourly or less often (a
 *  probe every minute is never the "next job"). Soonest first. */
export function notableTimers(list: Timer[]): Timer[] {
  return sortTimers(list, true).filter((t) => {
    if (!t.next) return false
    if (!t.last) return true
    return ms(t.next) - ms(t.last) >= 55 * 60e3
  })
}

/** The all-clear's proof: what was actually checked, each part a link. */
export function proof(s: Snapshot, now: number): { text: string; href?: string }[] {
  const parts: { text: string; href?: string }[] = []
  const svcs = s.services.filter((x) => x.state !== 'off')
  if (svcs.length) parts.push({ text: `${svcs.filter((x) => x.state === 'up').length} services up`, href: '#/services' })
  const verified = s.backups.sets.map((b) => ms(b.last_ok)).filter(isFinite)
  if (verified.length) {
    const oldest = Math.min(...verified)
    parts.push({ text: `${plural(s.backups.sets.length, 'backup')} verified, the oldest ${ago(new Date(oldest).toISOString(), now)}`, href: '#/backups' })
  }
  const d = s.drill.runs[0]
  if (d) parts.push({ text: `the drill restored ${d.passed} of ${d.passed + d.failed} ${weekdayOf(d.end, now)}`, href: '#/backups' })
  const out: { text: string; href?: string }[] = []
  parts.forEach((p, i) => {
    out.push(p)
    out.push({ text: i === parts.length - 1 ? '.' : i === parts.length - 2 ? ' and ' : ', ' })
  })
  if (out.length) out[0] = { ...out[0], text: out[0].text.charAt(0).toUpperCase() + out[0].text.slice(1) }
  return out
}

function weekdayOf(iso: string, now: number): string {
  const l = dayLabel(iso, now)
  if (l === 'Today') return 'today'
  if (l === 'Yesterday') return 'yesterday'
  return 'on ' + new Date(ms(iso)).toLocaleDateString([], { weekday: 'long' })
}

/* ---------- events: the away ribbon and the History timeline ---------- */

export type EventKind = 'alert' | 'backup' | 'drill' | 'timer'

export interface Event {
  id: string
  kind: EventKind
  t: number
  /** for alerts: when it cleared */
  end?: number
  level: Level
  title: string
  sub?: string
  href: string
  /** folded repeats of the same alert key within a day */
  count?: number
}

/** Everything that happened, newest first: alerts, backup runs, drills and failed timer runs. */
export function events(s: Snapshot): Event[] {
  const out: Event[] = []
  for (const i of s.alerts.incidents) {
    if (i.state === 'info') continue
    const lv: Level = i.state === 'open' ? prioLevel(i.prio) : i.state === 'sent' ? 'info' : 'off'
    out.push({ id: `a:${i.key}:${i.opened}`, kind: 'alert', t: ms(i.opened), end: i.resolved ? ms(i.resolved) : undefined, level: lv,
      title: i.title, sub: i.state === 'open' ? 'still open' : i.resolved ? `cleared after ${durationWords(ms(i.resolved) - ms(i.opened))}` : i.state,
      href: `#/history/alert/${encodeURIComponent(i.key)}` })
  }
  for (const r of s.backups.runs) {
    out.push({ id: `b:${r.start}`, kind: 'backup', t: ms(r.start), level: r.result === 'failed' ? 'crit' : r.result === 'running' ? 'info' : 'ok',
      title: r.result === 'failed' ? 'Backup failed' : r.result === 'running' ? 'Backup running' : 'Backup verified', sub: r.summary, href: '#/backups' })
  }
  for (const d of s.drill.runs) {
    out.push({ id: `d:${d.end}`, kind: 'drill', t: ms(d.end), level: d.failed ? 'crit' : 'ok',
      title: d.failed ? `Restore drill: ${d.failed} of ${d.passed + d.failed} failed` : `Restore drill passed, ${d.passed} of ${d.passed}`, href: '#/backups' })
  }
  for (const tm of s.timers) {
    if (!tm.highlight) continue
    for (const r of tm.runs ?? []) {
      if (r.result !== 'failed') continue
      out.push({ id: `t:${tm.unit}:${r.start}`, kind: 'timer', t: ms(r.start), level: 'warn', title: `${tm.activates.replace(/\.service$/, '')} failed`, sub: r.summary, href: '#/system' })
    }
  }
  return out.filter((e) => isFinite(e.t)).sort((a, b) => b.t - a.t)
}

/** Alerts with the same key that fire again and again on one day become one row with a count. */
export function foldRepeats(list: Event[], now: number): Event[] {
  const out: Event[] = []
  const seen = new Map<string, Event>()
  for (const e of list) {
    if (e.kind !== 'alert') {
      out.push(e)
      continue
    }
    const key = e.id.split(':')[1] + '|' + dayLabel(new Date(e.t).toISOString(), now)
    const first = seen.get(key)
    if (first && first.level !== 'crit' && first.level !== 'warn') {
      first.count = (first.count ?? 1) + 1
      continue
    }
    const copy = { ...e }
    seen.set(key, copy)
    out.push(copy)
  }
  return out
}

/** Events since the last look (or the last 24 hours), for the away ribbon. */
export function awayEvents(s: Snapshot, since: number | null | undefined, now: number): { from: number; list: Event[] } {
  const from = since && since < now ? since : now - 24 * 3600e3
  return { from, list: events(s).filter((e) => e.t >= from && e.t <= now) }
}

export function durationWords(d: number): string {
  if (!isFinite(d) || d < 0) return '—'
  const m = Math.round(d / 60000)
  if (m < 1) return 'under a minute'
  if (m < 60) return plural(m, 'minute')
  const h = Math.round(m / 60)
  if (h < 48) return plural(h, 'hour')
  return plural(Math.round(h / 24), 'day')
}

/** Fills lists an older collector may have sent as null, so no page can trip on them. */
export function normalizeSnap(s: Snapshot): Snapshot {
  const a = <T,>(v: T[] | null | undefined): T[] => v ?? []
  s.status.attention = a(s.status.attention)
  s.status.blind = a(s.status.blind)
  s.services = a(s.services)
  s.host.disks = a(s.host.disks)
  s.backups.sets = a(s.backups.sets).map((b) => ({ ...b, archives: a(b.archives) }))
  s.backups.runs = a(s.backups.runs)
  s.drill.runs = a(s.drill.runs).map((d) => ({ ...d, results: a(d.results) }))
  s.alerts.open = a(s.alerts.open)
  s.alerts.incidents = a(s.alerts.incidents)
  s.timers = a(s.timers)
  s.drift.files = a(s.drift.files)
  s.drift.disabled_timers = a(s.drift.disabled_timers)
  s.health.categories = a(s.health.categories)
  s.runbooks = a(s.runbooks)
  s.sources = a(s.sources)
  return s
}
