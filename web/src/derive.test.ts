import { describe, expect, it } from 'vitest'
import { normalizeSnap, alertHistogram, areaHref, awayEvents, byDay, durationWords, events, foldRepeats, groupServices, heroOf, notableTimers, prioLevel, proof, serverNow, sortTimers, uptimeOf, worst, fullDay, fleetDay, bucket, dayUptime, daySeen, dayRuns, slotStart, latencyStats, DAY_SLOTS, DAY_SLOT_MS } from './derive'
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
  it('groups incidents by local day', () => {
    const now = new Date(2026, 2, 10, 12, 0).getTime()
    const d = byDay([inc(new Date(2026, 2, 10, 9).toISOString()), inc(new Date(2026, 2, 10, 1).toISOString()), inc(new Date(2026, 2, 9, 23).toISOString())], now)
    expect(d.map((x) => [x.label, x.items.length])).toEqual([['Today', 2], ['Yesterday', 1]])
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
  })
  it('sorts timers by next run, homelab ones only when asked', () => {
    const t = (unit: string, next: string | undefined, highlight: boolean) => ({ unit, activates: unit, next, highlight, level: 'ok' }) as Timer
    const list = [t('b', '2026-03-10T09:00:00Z', true), t('a', '2026-03-10T08:00:00Z', false), t('c', undefined, true)]
    expect(sortTimers(list, true).map((x) => x.unit)).toEqual(['b', 'c'])
    expect(sortTimers(list, false).map((x) => x.unit)).toEqual(['a', 'b', 'c'])
  })
  it('computes uptime from beats, ignoring off and unknown', () => {
    expect(uptimeOf('uuuux')).toBe(80)
    expect(uptimeOf('uuoo??')).toBe(100)
    expect(uptimeOf('oo')).toBeNull()
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
    const text = proof(base(), NOW).map((p) => p.text).join('')
    expect(text).toMatch(/^2 services up, 1 backup verified, the oldest 2h ago and the drill restored 9 of 9 on /)
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
    s.status.headline = "Cockpit can't read Docker."
    s.status.blind = [{ level: 'unknown', area: 'services', ref: 'source-services', title: "Cockpit can't read Docker", detail: '14 services can\'t be confirmed.' }]
    const h = heroOf(s, NOW)
    expect([h.kind, h.light, h.title]).toEqual(['blind', 'blind', "Cockpit can't read Docker."])
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
