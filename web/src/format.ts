// Pure formatting helpers. Everything takes "now" explicitly so the UI can use
// the server's clock and the tests can pin it.

export const ms = (iso?: string) => (iso ? Date.parse(iso) : NaN)

/** "45s", "12m", "3h", "2d" (the same wording as the CLI). */
export function short(d: number): string {
  if (!isFinite(d)) return '—'
  const s = Math.max(0, Math.round(d / 1000))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  if (h < 48) return `${h}h`
  return `${Math.floor(h / 24)}d`
}

/** "3h 12m" style, for durations people read closely (countdowns, uptime). */
export function precise(d: number): string {
  if (!isFinite(d)) return '—'
  const s = Math.max(0, Math.round(d / 1000))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, '0')}s`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ${String(m % 60).padStart(2, '0')}m`
  const days = Math.floor(h / 24)
  return `${days}d ${h % 24}h`
}

export function ago(iso: string | undefined, now: number): string {
  const t = ms(iso)
  if (!isFinite(t)) return 'never'
  const d = now - t
  if (d < 5000) return 'just now'
  return `${short(d)} ago`
}

export function until(iso: string | undefined, now: number): string {
  const t = ms(iso)
  if (!isFinite(t)) return '—'
  const d = t - now
  if (d <= 0) return 'now'
  return `in ${precise(d)}`
}

export function duration(a: string, b: string): string {
  const d = ms(b) - ms(a)
  if (!isFinite(d) || d < 0) return '—'
  if (d < 1000) return `${d} ms`
  return precise(d)
}

/** Decimal units, like the CLI and `ls -h --si`. */
export function bytes(n: number): string {
  if (!isFinite(n) || n < 0) return '—'
  if (n < 1000) return `${n} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let v = n / 1000
  let i = 0
  while (v >= 1000 && i < units.length - 1) {
    v /= 1000
    i++
  }
  return `${v >= 100 ? v.toFixed(0) : v.toFixed(1)} ${units[i]}`
}

export function pct(part: number, whole: number): number {
  if (!whole) return 0
  return Math.max(0, Math.min(100, (part / whole) * 100))
}

/** Clock time in the browser's zone: "05:00". */
export function clock(iso: string | undefined): string {
  const t = ms(iso)
  if (!isFinite(t)) return '—'
  return new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })
}

/** "Today", "Yesterday", or "Mon 3 Mar". */
export function dayLabel(iso: string, now: number): string {
  const d = new Date(ms(iso))
  const n = new Date(now)
  const start = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime()
  const diff = Math.round((start(n) - start(d)) / 86400000)
  if (diff === 0) return 'Today'
  if (diff === 1) return 'Yesterday'
  return d.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' })
}

/** A day label in the middle of a sentence: "today" and "yesterday" lose their
 *  capital, a date keeps its own ("Sun, Mar 8"). */
export function dayWord(iso: string, now: number): string {
  const s = dayLabel(iso, now)
  return s === 'Today' || s === 'Yesterday' ? s.toLowerCase() : s
}

export function dateTime(iso: string | undefined): string {
  const t = ms(iso)
  if (!isFinite(t)) return '—'
  return new Date(t).toLocaleString([], {
    weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false,
  })
}

export function plural(n: number, one: string, many = one + 's'): string {
  return `${n} ${n === 1 ? one : many}`
}

/** "health-config-drift" → "config drift" for chips. */
export function humanize(s: string): string {
  return s.replace(/[-_]+/g, ' ')
}

/** "in 18 min", "in 4 h 18 min": a countdown without the noise of seconds. */
export function inAbout(iso: string | undefined, now: number): string {
  const t = ms(iso)
  if (!isFinite(t)) return '—'
  const m = Math.round((t - now) / 60000)
  if (m <= 0) return t > now ? 'in under a minute' : 'now'
  if (m < 60) return `in ${m} min`
  const h = Math.floor(m / 60)
  if (h < 24) return `in ${h} h${m % 60 ? ` ${m % 60} min` : ''}`
  return `in ${Math.floor(h / 24)} d ${h % 24} h`
}

const SOURCE: Record<string, string> = { services: 'Service states', timers: 'Scheduled jobs', journal: 'System journal', backups: 'Backup status', alerts: 'Alert history', drift: 'Config drift', host: 'Host health', runbooks: 'Checklists' }

/** A collector source by what it tells you: "journal" is "System journal". */
export const sourceName = (n: string) => SOURCE[n] ?? n
