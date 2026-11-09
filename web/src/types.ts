// Mirrors internal/snapshot/snapshot.go. Times are RFC 3339 strings.

export type Level = 'ok' | 'info' | 'warn' | 'crit' | 'unknown' | 'off'

export interface Snapshot {
  schema: number
  generated: string
  title: string
  demo?: boolean
  status: { level: Level; headline: string; attention: Attention[]; blind?: Attention[] }
  host: Host
  maintenance?: { since: string }
  services: Service[]
  backups: Backups
  drill: { level: Level; runs: DrillRun[] }
  alerts: Alerts
  timers: Timer[]
  drift: Drift
  heartbeat: Heartbeat
  health: Health
  runbooks: Runbook[]
  sources: Source[]
}

export interface Attention {
  level: Level
  area: string
  title: string
  detail?: string
  ref?: string
  runbook?: string
  evidence?: string
}

export interface Host {
  name: string
  os?: string
  kernel?: string
  cpus: number
  uptime_s: number
  load: [number, number, number]
  cpu_pct?: number
  mem_total: number
  mem_available: number
  swap_total: number
  swap_free: number
  temp_c?: number
  throttled?: string
  disks: { mount: string; size: number; used: number }[]
  writes_gib_day?: number
  level: Level
  history?: { t: string; cpu: number; mem: number }[]
}

export interface Service {
  id: string
  title: string
  note?: string
  group?: string
  kind: 'container' | 'unit' | 'probe'
  state: 'up' | 'degraded' | 'down' | 'off' | 'unknown'
  level: Level
  detail: string
  since?: string
  image?: string
  restarts?: number
  url?: string
  runbook?: string
  probe?: Probe
  beats: string
}

export interface Probe {
  target: string
  ok: boolean
  latency_ms: number
  code?: number
  error?: string
  cert_days?: number
  latencies?: number[]
}

export interface Backups {
  level: Level
  sets: BackupSet[]
  runs: Run[]
  bytes: number
}

export interface BackupSet {
  name: string
  type: string
  keep: number
  max_age_h: number
  last_ok?: string
  bytes: number
  checks?: Record<string, number>
  archives: { time: string; bytes: number }[]
  level: Level
  detail: string
}

export interface Run {
  unit?: string
  start: string
  end: string
  result: 'success' | 'failed' | 'running' | 'unknown'
  summary?: string
}

export interface DrillRun {
  start: string
  end: string
  passed: number
  failed: number
  result: string
  results: { set: string; ok: boolean; detail: string }[]
}

export interface Alerts {
  level: Level
  open: Incident[]
  incidents: Incident[]
  sent_24h: number
  sent_7d: number
}

export interface Incident {
  key: string
  title: string
  prio: string
  opened: string
  resolved?: string
  sends: number
  suppressed: number
  failed: number
  state: 'open' | 'stale' | 'resolved' | 'info' | 'sent'
  runbook?: string
}

export interface Timer {
  unit: string
  activates: string
  description?: string
  next?: string
  last?: string
  result?: string
  enabled?: string
  highlight?: boolean
  level: Level
  runs?: Run[]
}

export interface Drift {
  level: Level
  checked?: string
  result: 'clean' | 'drift' | 'unknown'
  tracked: number
  files: { path: string; state: string; note?: string }[]
  uncommitted: number
  disabled_timers: string[]
  error?: string
}

export interface Heartbeat {
  level: Level
  unit?: string
  last?: string
  ok: boolean
  reason?: string
  pings_24h: number
  runs_24h: number
}

export interface Health {
  level: Level
  last?: string
  result?: string
  categories: { name: string; open: boolean; since?: string; prio?: string }[]
}

export interface Runbook {
  id: string
  title: string
  url?: string
  local?: boolean
  match?: string[]
  bytes?: number
}

export interface Source {
  name: string
  ok: boolean
  error?: string
  at: string
  duration_ms: number
}

export interface Session {
  auth: 'password' | 'none'
  authenticated: boolean
  title: string
  demo: boolean
  version: string
}
