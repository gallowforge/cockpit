// Derived views of a snapshot that more than one page needs. Pure, tested.
import type { Attention, Incident, Level, Service, Snapshot, Timer } from './types'
import { ago, clock, dayLabel, ms, plural } from './format'
import { safeHref } from './markdown'

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

/** ntfy priorities as levels; the same mapping as the collector's PrioLevel. */
export function prioLevel(p: string): Level {
  if (p === 'urgent' || p === 'high' || p === 'max' || p === '5' || p === '4') return 'crit'
  if (p === 'default' || p === '3' || p === '') return 'warn'
  return 'info'
}

/** Timers to show first: highlighted ones, then the rest, each by next run. */
export function sortTimers(list: Timer[], homelabOnly: boolean): Timer[] {
  const t = homelabOnly ? list.filter((x) => x.highlight) : list.slice()
  const next = (x: Timer) => (x.next ? ms(x.next) : Infinity)
  return t.sort((a, b) => next(a) - next(b))
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
      detail: [{ text: `Showing the state from ${clock(s.generated)}, ${ago(s.generated, now)}. Vesper reconnects by itself.` }] }
  }
  if (age > STALE_MS) {
    return { ...base, kind: 'stale', light: 'none', title: 'Vesper lost sight of the server.',
      detail: [{ text: `Last snapshot ${clock(s.generated)}, ${ago(s.generated, now)}. Below is the last known state.` }] }
  }
  if (s.maintenance) {
    return { ...base, kind: 'maintenance', light: 'none', title: 'Maintenance mode.',
      detail: [{ text: `Watchdogs paused since ${clock(s.maintenance.since)}. ${att.length ? `${plural(att.length, 'thing')} would need you.` : 'Nothing would need you.'}` }] }
  }
  if (att.length === 0 && blind.length === 0) {
    return { ...base, kind: 'clear', light: 'calm', title: 'Nothing needs you.', detail: [] }
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
    const app = svc?.url ? safeHref(svc.url) : null
    if (svc && app) actions.push({ label: `Open ${svc.title}`, href: app, external: true, primary: !actions.length })
    actions.push({ label: 'Details', href: areaHref(a.area, a.ref), primary: !actions.length })
    const detail = [a.detail, a.evidence ? `Also: ${a.evidence}` : ''].filter((x): x is string => !!x).map(sentence).join(' ')
    return { ...base, kind: a.level === 'crit' ? 'down' : 'attn', light: a.level === 'crit' ? 'down' : 'attn',
      title: sentence(a.title), detail: [{ text: detail }], actions }
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
  return sortTimers(list, true).filter((t) => !!t.next && !isFrequent(t))
}

/** A job that runs more often than hourly: a probe or a keep-alive. */
export function isFrequent(t: Timer): boolean {
  return !!t.next && !!t.last && ms(t.next) - ms(t.last) < 55 * 60e3
}

/** The all-clear's proof: each part is something Vesper actually checked. */
export function clearFacts(s: Snapshot, now: number): { text: string; href: string }[] {
  const out: { text: string; href: string }[] = []
  const svcs = s.services.filter((x) => x.state !== 'off')
  if (svcs.length) out.push({ text: `${svcs.filter((x) => x.state === 'up').length} of ${svcs.length} services up`, href: '#/services' })
  const verified = s.backups.sets.map((b) => ms(b.last_ok)).filter(isFinite)
  if (s.backups.sets.length) {
    const oldest = verified.length ? ago(new Date(Math.min(...verified)).toISOString(), now) : 'never'
    out.push({ text: `${plural(s.backups.sets.length, 'backup')} verified, the oldest ${oldest}`, href: '#/backups' })
  }
  const d = s.drill.runs[0]
  if (d) out.push({ text: d.failed ? `Restore drill: ${d.failed} failed` : `Restore drill passed ${weekday(d.end, now)}`, href: '#/backups' })
  if (s.heartbeat.level === 'ok') out.push({ text: 'Heartbeat steady', href: '#/system' })
  return out
}

/** "today", "yesterday" or "on Sunday". */
export function weekday(iso: string, now: number): string {
  const l = dayLabel(iso, now)
  if (l === 'Today') return 'today'
  if (l === 'Yesterday') return 'yesterday'
  return 'on ' + new Date(ms(iso)).toLocaleDateString([], { weekday: 'long' })
}

/* ---------- events: the away ribbon and the History timeline ---------- */

export type EventKind = 'alert' | 'backup' | 'drill' | 'timer'

export interface Event {
  id: string
  /** for alerts: the notifier's key, so repeats can be folded */
  key?: string
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
    out.push({ id: `a:${i.key}:${i.opened}`, key: i.key, kind: 'alert', t: ms(i.opened), end: i.resolved ? ms(i.resolved) : undefined, level: lv,
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
    const key = (e.key ?? e.id) + '|' + dayLabel(new Date(e.t).toISOString(), now)
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
  if ((s.schema ?? 1) < 2 && !Array.isArray(s.status.blind)) {
    // a collector older than this page cannot report what it can't see, so its all-clear is not proof
    s.status.blind = [{ level: 'unknown', area: 'services', title: 'The collector is an older version',
      detail: 'Restart vesper-collect so it writes the new state. Until then Vesper cannot tell what it cannot see.' }]
    if (s.status.level === 'ok' || s.status.level === 'info') s.status.level = 'unknown'
  }
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

/* ---------- the day line: 24 hours in five-minute slots ---------- */

export const DAY_SLOT_MS = 5 * 60_000
export const DAY_SLOTS = 288
const dayRank: Record<string, number> = { u: 0, o: 0, '?': 1, d: 2, x: 3 }

/** A service's day line padded to a full day: time before Vesper's first
 *  sample is unknown, never assumed up. */
export function fullDay(day: string | undefined): string {
  const d = (day ?? '').slice(-DAY_SLOTS)
  return '?'.repeat(DAY_SLOTS - d.length) + d
}

/** The worst state in each slot across services; off services are left out. */
export function fleetDay(list: Service[]): string {
  const lines = list.filter((s) => s.state !== 'off').map((s) => fullDay(s.day))
  if (!lines.length) return fullDay('')
  let out = ''
  for (let i = 0; i < DAY_SLOTS; i++) {
    let w = 'u'
    for (const l of lines) if ((dayRank[l[i]] ?? 1) > (dayRank[w] ?? 0)) w = l[i]
    out += w
  }
  return out
}

/** Folds slots into n buckets, the worst state winning, for narrow drawings.
 *  A bucket Vesper did not fully see shows as unknown unless it holds worse. */
export function bucket(day: string, n: number): string {
  if (n >= day.length) return day
  const per = day.length / n
  let out = ''
  for (let b = 0; b < n; b++) {
    let w = 'u'
    for (let i = Math.floor(b * per); i < Math.floor((b + 1) * per); i++) {
      const c = day[i]
      if ((dayRank[c] ?? 1) > (dayRank[w] ?? 0)) w = c
    }
    out += w
  }
  return out
}

/** Share of the seen time that was up (degraded counts as up), or null when
 *  Vesper saw nothing. Off and unknown slots are left out of the count. */
export function dayUptime(day: string): number | null {
  let up = 0
  let down = 0
  for (const c of day) {
    if (c === 'u' || c === 'd') up++
    else if (c === 'x') down++
  }
  return up + down ? (up / (up + down)) * 100 : null
}

/** How many slots of the day Vesper actually watched. */
export function daySeen(day: string): number {
  let n = 0
  for (const c of day) if (c !== '?') n++
  return n
}

/** When slot i (of a line `len` long whose last slot holds `generated`) began. */
export function slotStart(generated: string, i: number, len = DAY_SLOTS): number {
  const end = Math.floor(ms(generated) / DAY_SLOT_MS)
  return (end - (len - 1 - i)) * DAY_SLOT_MS
}

export interface DayRun {
  ch: string
  from: number
  to: number
}

/** Stretches of the day that were not plainly up, oldest first. */
export function dayRuns(day: string, generated: string): DayRun[] {
  const out: DayRun[] = []
  for (let i = 0; i < day.length; i++) {
    const c = day[i]
    if (c === 'u' || c === 'o') continue
    const last = out[out.length - 1]
    const from = slotStart(generated, i, day.length)
    if (last && last.ch === c && last.to === from) last.to = from + DAY_SLOT_MS
    else out.push({ ch: c, from, to: from + DAY_SLOT_MS })
  }
  return out
}

/** Median and 95th percentile of probe answer times; failed probes are left out. */
export function latencyStats(v: number[] | undefined): { p50: number | null; p95: number | null } {
  const x = (v ?? []).filter((n) => n >= 0).sort((a, b) => a - b)
  if (!x.length) return { p50: null, p95: null }
  const m = Math.floor(x.length / 2)
  return { p50: x.length % 2 ? x[m] : (x[m - 1] + x[m]) / 2, p95: x[Math.min(x.length - 1, Math.floor(0.95 * x.length))] }
}
