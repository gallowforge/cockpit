// "Since you last looked": the moment the deck was last hidden is kept on this
// device, so the next visit can say what happened in between.
import type { Level, Snapshot } from './types'
import { clock, ms, plural, short } from './format'
import { prioLevel } from './derive'

const KEY = 'vesper-last-look'

/** ?since=9h (or an ISO time) overrides the stored value, for screenshots. */
export function readLastLook(now: number): number | null {
  const q = new URLSearchParams(location.search).get('since')
  if (q) {
    const m = /^(\d+(?:\.\d+)?)([mhd])$/.exec(q)
    if (m) return now - Number(m[1]) * { m: 60e3, h: 3600e3, d: 86400e3 }[m[2] as 'm' | 'h' | 'd']
    const t = Date.parse(q)
    if (!isNaN(t)) return t
  }
  try {
    const v = Number(localStorage.getItem(KEY))
    return v > 0 ? v : null
  } catch {
    return null
  }
}

export function writeLastLook(t: number) {
  try {
    localStorage.setItem(KEY, String(Math.round(t)))
  } catch {
    /* private mode */
  }
}

export interface Part {
  text: string
  href?: string
  level?: Level
}

/** What happened between `since` and now, as parts of one plain sentence. */
export function sinceParts(s: Snapshot, since: number): Part[] {
  const parts: Part[] = []
  const runs = s.backups.runs.filter((r) => ms(r.start) > since)
  if (runs.length) {
    const failed = runs.filter((r) => r.result === 'failed').length
    const last = runs[0]
    if (runs.length === 1) {
      parts.push(failed
        ? { text: `the backup at ${clock(last.start)} failed`, href: '#/backups', level: 'crit' }
        : { text: `the backup ran at ${clock(last.start)} and verified every set`, href: '#/backups', level: 'ok' })
    } else {
      parts.push({ text: `${runs.length} backups ran${failed ? `, ${failed} failed` : ', all verified'}`, href: '#/backups', level: failed ? 'crit' : 'ok' })
    }
  }
  const drills = s.drill.runs.filter((d) => ms(d.end) > since)
  if (drills.length) {
    const d = drills[0]
    parts.push(d.failed
      ? { text: `the restore drill failed ${d.failed} of ${d.passed + d.failed} sets`, href: '#/backups', level: 'crit' }
      : { text: `the restore drill brought back ${d.passed} of ${d.passed} sets`, href: '#/backups', level: 'ok' })
  }
  const opened = s.alerts.incidents.filter((i) => i.state !== 'info' && i.state !== 'sent' && ms(i.opened) > since)
  const closedOld = s.alerts.incidents.filter((i) => i.state === 'resolved' && i.resolved && ms(i.resolved) > since && ms(i.opened) <= since)
  if (opened.length === 1) {
    const i = opened[0]
    parts.push(i.resolved
      ? { text: `"${i.title}" came and went in ${awayFor(ms(i.opened), ms(i.resolved))}`, href: '#/alerts', level: 'ok' }
      : { text: `"${i.title}" opened and is still open`, href: '#/alerts', level: prioLevel(i.prio) })
  } else if (opened.length > 1) {
    const still = opened.filter((i) => !i.resolved).length
    parts.push({ text: `${plural(opened.length, 'alert')} opened${still ? `, ${still} still open` : ', all cleared'}`, href: '#/alerts', level: still ? 'warn' : 'ok' })
  }
  if (closedOld.length) parts.push({ text: `${plural(closedOld.length, 'older alert')} cleared`, href: '#/alerts', level: 'ok' })
  const failedTimers = s.timers.filter((t) => t.highlight && t.result === 'failed' && t.last && ms(t.last) > since)
  if (failedTimers.length) parts.push({ text: `${failedTimers.map((t) => t.activates.replace(/\.service$/, '')).join(', ')} failed`, href: '#/timers', level: 'warn' })
  return parts
}

export function awayFor(since: number, now: number): string {
  const d = now - since
  const s = short(d)
  const unit: Record<string, string> = { s: 'seconds', m: 'minutes', h: 'hours', d: 'days' }
  const n = parseInt(s, 10)
  const u = s.replace(/\d+/, '')
  return n === 1 ? `1 ${unit[u].slice(0, -1)}` : `${n} ${unit[u]}`
}
