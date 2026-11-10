import { describe, expect, it } from 'vitest'
import { normalizeSnap, alertHistogram, areaHref, awayEvents, clearFacts, durationWords, events, foldRepeats, groupServices, heroOf, notableTimers, prioLevel, serverNow, sortTimers, tailRows, telemetry, worst, fullDay, fleetDay, bucket, dayUptime, daySeen, dayRuns, slotStart, latencyStats, DAY_SLOTS, DAY_SLOT_MS } from './derive'
import { clock } from './format'
import type { Incident, Service, Snapshot, Timer } from './types'

const svc = (id: string, group?: string): Service =>
  ({ id, title: id, group, kind: 'container', state: 'up', level: 'ok', detail: '', beats: '' }) as Service
const inc = (opened: string, prio = 'default', state: Incident['state'] = 'resolved'): Incident =>
  ({ key: 'k', title: 't', prio, opened, sends: 1, suppressed: 0, failed: 0, state }) as Incident

describe('derive', () => {
  it('ranks levels', () => {
    expect(worst(['ok', 'info', 'warn'])).toBe('warn')
    expect(worst(['off', 'ok'])).toBe('ok')
    expect(worst(['warn', 'crit', 'unknown'])).toBe('crit')
  })
  it('groups services in first-seen order with Other last', () => {
    const g = groupServices([svc('a'), svc('b', 'Network'), svc('c', 'Apps'), svc('d', 'Network')])
    expect(g.map((x) => x.name)).toEqual(['Network', 'Apps', 'Other'])
    expect(g[0].services.map((s) => s.id)).toEqual(['b', 'd'])
  })
  it('bins alerts per day by severity', () => {
    const now = new Date(2026, 2, 10, 12, 0).getTime()
    const bins = alertHistogram([inc(new Date(2026, 2, 10, 9).toISOString(), 'high'), inc(new Date(2026, 2, 8, 9).toISOString(), 'low'), inc(new Date(2026, 1, 1).toISOString())], now, 14)
    expect(bins).toHaveLength(14)
    expect(bins[13]).toMatchObject({ crit: 1, warn: 0, info: 0 })
    expect(bins[11]).toMatchObject({ info: 1 })
    expect(bins.reduce((n, b) => n + b.crit + b.warn + b.info, 0)).toBe(2)
  })
  it('maps ntfy priorities', () => {
    expect(prioLevel('urgent')).toBe('crit')
    expect(prioLevel('default')).toBe('warn')
    expect(prioLevel('low')).toBe('info')
    expect([prioLevel('5'), prioLevel('4'), prioLevel('3'), prioLevel('2')]).toEqual(['crit', 'crit', 'warn', 'info'])
  })
  it('sorts timers by next run, homelab ones only when asked', () => {
    const t = (unit: string, next: string | undefined, highlight: boolean) => ({ unit, activates: unit, next, highlight, level: 'ok' }) as Timer
    const list = [t('b', '2026-03-10T09:00:00Z', true), t('a', '2026-03-10T08:00:00Z', false), t('c', undefined, true)]
    expect(sortTimers(list, true).map((x) => x.unit)).toEqual(['b', 'c'])
    expect(sortTimers(list, false).map((x) => x.unit)).toEqual(['a', 'b', 'c'])
  })
  it('names only the jobs that run hourly or less often', () => {
    const t = (unit: string, last: string, next: string) => ({ unit, activates: unit, last, next, highlight: true, level: 'ok' }) as Timer
    const list = [t('probe', '2026-03-10T07:41:30Z', '2026-03-10T07:42:30Z'), t('backup', '2026-03-09T05:00:00Z', '2026-03-10T05:00:00Z')]
    expect(notableTimers(list).map((x) => x.unit)).toEqual(['backup'])
  })
  it('carries the server clock forward', () => {
    const snap = { generated: '2026-03-10T07:42:00Z' } as Snapshot
    expect(serverNow(snap, 1000, 4000)).toBe(Date.parse('2026-03-10T07:42:03Z'))
  })
  it('fills null lists from an older collector', () => {
    const raw = JSON.parse('{"status":{"attention":null},"services":null,"host":{"disks":null},"backups":{"sets":[{"archives":null}],"runs":null},"drill":{"runs":null},"alerts":{"open":null,"incidents":null},"timers":null,"drift":{"files":null,"disabled_timers":null},"health":{"categories":null},"runbooks":null,"sources":null}')
    const s = normalizeSnap(raw)
    expect(s.status.attention).toEqual([])
    expect(s.backups.sets[0].archives).toEqual([])
    expect(s.alerts.open).toEqual([])
    expect(s.status.blind).toHaveLength(1)
  })
  it('links attention items to their page', () => {
    expect(areaHref('services', 'vault warden')).toBe('#/services/vault%20warden')
    expect(areaHref('drill')).toBe('#/backups')
    expect(areaHref('heartbeat')).toBe('#/system')
    expect(areaHref('alerts', 'kuma-down')).toBe('#/history')
    expect(areaHref('backups', 'vaultwarden')).toBe('#/backups/vaultwarden')
    expect(areaHref('services', 'unknown')).toBe('#/services')
  })
})

const NOW = Date.parse('2026-03-10T07:42:00Z')
const base = (): Snapshot => normalizeSnap({
  schema: 1, generated: '2026-03-10T07:41:58Z', title: 'pi',
  status: { level: 'ok', headline: 'Nothing needs you.', attention: [], blind: [] },
  host: { name: 'pi', cpus: 4, uptime_s: 1, load: [0, 0, 0], mem_total: 1, mem_available: 1, swap_total: 0, swap_free: 0, disks: [], level: 'ok' },
  services: [svc('vault'), { ...svc('ha'), title: 'Home Assistant', url: 'https://ha.example-tailnet.ts.net' }],
  backups: { level: 'ok', bytes: 0, runs: [{ start: '2026-03-10T05:00:00Z', end: '2026-03-10T05:03:00Z', result: 'success', summary: 'ok' }],
    sets: [{ name: 'vault', type: 'sqlite', keep: 14, max_age_h: 48, last_ok: '2026-03-10T05:03:00Z', bytes: 1, archives: [], level: 'ok', detail: '' }] },
  drill: { level: 'ok', runs: [{ start: '2026-03-08T04:00:00Z', end: '2026-03-08T04:10:00Z', passed: 9, failed: 0, result: 'success', results: [] }] },
  alerts: { level: 'ok', open: [], incidents: [], sent_24h: 0, sent_7d: 0 },
  timers: [], drift: { level: 'ok', result: 'clean', tracked: 1, files: [], uncommitted: 0, disabled_timers: [] },
  heartbeat: { level: 'ok', ok: true, pings_24h: 1, runs_24h: 1 }, health: { level: 'ok', categories: [] }, runbooks: [], sources: [],
} as unknown as Snapshot)

describe('the hero', () => {
  it('says nothing needs you, with its proof', () => {
    const h = heroOf(base(), NOW)
    expect([h.kind, h.light, h.title]).toEqual(['clear', 'calm', 'Nothing needs you.'])
    const facts = clearFacts(base(), NOW).map((p) => p.text)
    expect(facts.slice(0, 2)).toEqual(['2 of 2 services up', '1 backup verified, the oldest 2h ago'])
    expect(facts[2]).toMatch(/^Restore drill passed /)
  })
  it('names a single problem and offers its checklist first', () => {
    const s = base()
    s.status.attention = [{ level: 'crit', area: 'services', ref: 'ha', title: 'Home Assistant is down', detail: 'probe timed out', runbook: 'ha', evidence: 'Uptime Kuma: Home Assistant is DOWN, open since 4m ago' }]
    const h = heroOf(s, NOW)
    expect([h.kind, h.light, h.title]).toEqual(['down', 'down', 'Home Assistant is down.'])
    expect(h.detail[0].text).toBe('Probe timed out. Also: Uptime Kuma: Home Assistant is DOWN, open since 4m ago.')
    expect(h.actions.map((a) => [a.label, a.primary ?? false])).toEqual([['Open the checklist', true], ['Open Home Assistant', false], ['Details', false]])
  })
  it('counts several problems and links the worst', () => {
    const s = base()
    s.status.attention = [{ level: 'warn', area: 'drift', title: 'Config drift: 1 file differs from the repo' }, { level: 'warn', area: 'timers', title: 'x failed' }]
    const h = heroOf(s, NOW)
    expect([h.kind, h.light, h.title]).toEqual(['several', 'attn', '2 things need you.'])
    expect(h.detail[1]).toEqual({ text: 'Config drift: 1 file differs from the repo.', href: '#/system' })
  })
  it('never calls a blind spot all clear', () => {
    const s = base()
    s.status.headline = "Vesper can't read Docker."
    s.status.blind = [{ level: 'unknown', area: 'services', ref: 'source-services', title: "Vesper can't read Docker", detail: '14 services can\'t be confirmed.' }]
    const h = heroOf(s, NOW)
    expect([h.kind, h.light, h.title]).toEqual(['blind', 'blind', "Vesper can't read Docker."])
    expect(h.detail[0].text).toBe("14 services can't be confirmed. Everything it can see is fine.")
  })
  it('turns stale, offline and maintenance into their own states', () => {
    expect(heroOf(base(), NOW + 5 * 60e3).kind).toBe('stale')
    expect(heroOf(base(), NOW, { online: false }).kind).toBe('offline')
    const s = base()
    s.maintenance = { since: '2026-03-10T07:00:00Z' }
    expect(heroOf(s, NOW).title).toBe('Maintenance mode.')
  })
})

describe('events', () => {
  it('merges alerts, backups and drills newest first, and folds a flapping key', () => {
    const s = base()
    const flap = (h: number) => ({ key: 'kuma-dns', title: 'Kuma: DNS flapped', prio: 'low', opened: `2026-03-10T0${h}:10:00Z`, resolved: `2026-03-10T0${h}:12:00Z`, sends: 1, suppressed: 0, failed: 0, state: 'resolved' as const })
    s.alerts.incidents = [flap(4), flap(3), flap(2)]
    const list = events(s)
    expect(list.map((e) => e.kind)).toEqual(['backup', 'alert', 'alert', 'alert', 'drill'])
    expect(list[1].sub).toBe('cleared after 2 minutes')
    const folded = foldRepeats(list, NOW)
    expect(folded.filter((e) => e.kind === 'alert')).toHaveLength(1)
    expect(folded.find((e) => e.kind === 'alert')!.count).toBe(3)
  })
  it('uses the last look, or the last 24 hours, as the away window', () => {
    const s = base()
    expect(awayEvents(s, NOW - 3 * 3600e3, NOW).list.map((e) => e.kind)).toEqual(['backup'])
    expect(awayEvents(s, null, NOW).from).toBe(NOW - 24 * 3600e3)
    expect(durationWords(90 * 60e3)).toBe('2 hours')
  })
})

describe('day line', () => {
  const gen = '2026-03-10T07:42:00Z'
  it('pads a short line with unknown time', () => {
    const d = fullDay('uux')
    expect(d.length).toBe(DAY_SLOTS)
    expect(d.endsWith('?uux')).toBe(true)
  })
  it('takes the worst state per slot and leaves off services out', () => {
    const mk = (day: string, state: Service['state'] = 'up') => ({ id: day, title: day, kind: 'unit', state, level: 'ok', detail: '', beats: '', day }) as Service
    const f = fleetDay([mk('u'.repeat(DAY_SLOTS - 1) + 'x'), mk('d'.repeat(DAY_SLOTS)), mk('x'.repeat(DAY_SLOTS), 'off')])
    expect(f.slice(-2)).toBe('dx')
  })
  it('folds slots into buckets without hiding an outage', () => {
    expect(bucket('uuuxuu', 2)).toBe('ux')
    expect(bucket('??????', 3)).toBe('???')
    expect(bucket('u?????', 3)).toBe('???')
    expect(bucket('x?uuuu', 3)).toBe('xuu')
  })
  it('counts uptime only over the time it saw', () => {
    expect(dayUptime('uuux')).toBe(75)
    expect(dayUptime('??uu')).toBe(100)
    expect(dayUptime('????')).toBeNull()
    expect(daySeen('??uu')).toBe(2)
  })
  it('turns stretches into times', () => {
    const runs = dayRuns('uxxu?', gen)
    expect(runs.map((r) => r.ch)).toEqual(['x', '?'])
    expect(runs[0].to - runs[0].from).toBe(2 * DAY_SLOT_MS)
    expect(slotStart(gen, 4, 5)).toBe(Math.floor(Date.parse(gen) / DAY_SLOT_MS) * DAY_SLOT_MS)
  })
  it('summarises answer times without the failed probes', () => {
    expect(latencyStats([3, 1, -1, 2])).toEqual({ p50: 2, p95: 3 })
    expect(latencyStats(undefined)).toEqual({ p50: null, p95: null })
  })
})

describe('the collector’s last round, as lines', () => {
  const probe = (ok: boolean, latency_ms: number, extra: object = {}) => ({ target: 't', ok, latency_ms, ...extra })
  it('writes one line for each thing it checked, in the order it checked them', () => {
    const s = base()
    s.services = [
      { ...svc('adguard'), probe: probe(true, 1.53) },
      { ...svc('caddy'), probe: probe(true, 26.4, { code: 200 }) },
      { ...svc('ha'), state: 'down', probe: probe(false, 0, { error: 'timeout' }) },
      { ...svc('kuma'), state: 'down', probe: probe(false, 0) },
      svc('vault'),
      { ...svc('dockge'), state: 'degraded' },
      { ...svc('tailscale'), kind: 'unit' },
      { ...svc('fail2ban'), kind: 'unit', state: 'down' },
    ] as Service[]
    s.sources = [{ name: 'docker', ok: true, duration_ms: 41.6 }, { name: 'journal', ok: false, duration_ms: 0 }] as Snapshot['sources']
    s.host = { ...s.host, cpu_pct: 13.6, temp_c: 54.23, load: [0.274, 0, 0] }
    s.heartbeat = { ...s.heartbeat, last: '2026-03-10T07:40:00Z', pings_24h: 287, runs_24h: 288 }
    expect(telemetry(s)).toEqual([
      'probe adguard 1.5 ms ok',
      'probe caddy 26 ms 200',
      'probe ha timeout',
      'probe kuma no answer',
      'container vault running',
      'container dockge degraded',
      'unit tailscale.service active',
      'unit fail2ban.service down',
      'backup vault verified 1 B',
      'drill passed 9/9',
      'drift clean · 1 file',
      'heartbeat 287/288 pings',
      'read docker 42 ms',
      'read journal failed',
      'host cpu 14% · load 0.27',
      'host 54.2 °C',
      `snapshot ${clock('2026-03-10T07:41:58Z')} · schema 1`,
    ])
  })
  it('says only what it knows', () => {
    const s = base()
    s.services = []
    s.backups.sets = [{ ...s.backups.sets[0], last_ok: undefined }]
    s.drill.runs = [{ ...s.drill.runs[0], passed: 7, failed: 2 }]
    s.drift = { ...s.drift, result: 'drift' }
    s.heartbeat = { ...s.heartbeat, last: undefined }
    const lines = telemetry(s)
    expect(lines).toEqual(['drill failed 7/9', `snapshot ${clock('2026-03-10T07:41:58Z')} · schema 1`])
  })
  it('leaves the load out when the host did not report one', () => {
    const s = base()
    s.services = []
    s.host = { ...s.host, cpu_pct: 14.2, load: undefined as unknown as [number, number, number] }
    expect(telemetry(s)).toContain('host cpu 14%')
  })
})

describe('the log on show', () => {
  const log = ['a', 'b', 'c', 'd', 'e', 'f']
  const texts = (at: number, lines = log) => tailRows(lines, at, 3).map((r) => r.text)

  it('opens on the closing lines, with the one before them on its way out', () => {
    expect(texts(0)).toEqual(['c', 'd', 'e', 'f'])
  })
  it('goes round, a line at a time, and never runs dry', () => {
    expect(texts(1)).toEqual(['d', 'e', 'f', 'a'])
    expect(texts(4)).toEqual(['a', 'b', 'c', 'd'])
    expect(texts(6)).toEqual(texts(0))
    for (let at = 0; at < 40; at++) expect(texts(at).every((t) => log.includes(t))).toBe(true)
  })
  it('keeps a line’s key as it rises, so only the new line is new', () => {
    const before = tailRows(log, 7, 3), after = tailRows(log, 8, 3)
    expect(after.slice(0, 3)).toEqual(before.slice(1))
    expect(after[3].key).toBe(before[3].key + 1)
  })
  it('goes round a log only one line longer than the window', () => {
    expect(texts(0, ['a', 'b', 'c', 'd'])).toEqual(['a', 'b', 'c', 'd'])
    expect(texts(1, ['a', 'b', 'c', 'd'])).toEqual(['b', 'c', 'd', 'a'])
  })
  it('shows a log too short to go round whole, and holds it there', () => {
    for (const lines of [[], ['a'], ['a', 'b'], ['a', 'b', 'c']]) {
      expect(texts(0, lines)).toEqual(lines)
      expect(tailRows(lines, 5, 3)).toEqual(tailRows(lines, 0, 3))
    }
  })
})
