// Derived views of a snapshot that more than one page needs. Pure, tested.
import type { Incident, Level, Service, Snapshot, Timer } from './types'
import { dayLabel, ms } from './format'

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
      return ref ? `#/services/${encodeURIComponent(ref)}` : '#/services'
    case 'backups':
    case 'drill':
      return '#/backups'
    case 'alerts':
      return '#/alerts'
    case 'timers':
      return '#/timers'
    case 'drift':
    case 'heartbeat':
    case 'health':
      return '#/drift'
    default:
      return '#/'
  }
}

/** Fills lists an older collector may have sent as null, so no page can trip on them. */
export function normalizeSnap(s: Snapshot): Snapshot {
  const a = <T,>(v: T[] | null | undefined): T[] => v ?? []
  s.status.attention = a(s.status.attention)
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
