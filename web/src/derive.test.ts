import { describe, expect, it } from 'vitest'
import { normalizeSnap, alertHistogram, areaHref, byDay, groupServices, prioLevel, serverNow, sortTimers, uptimeOf, worst } from './derive'
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
    expect(areaHref('heartbeat')).toBe('#/drift')
  })
})
