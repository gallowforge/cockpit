import { describe, expect, it } from 'vitest'
import { paletteItems, search, PAGES } from './palette'
import type { Snapshot } from '../types'

const snap = (): Snapshot => ({
  services: [
    { id: 'vaultwarden', title: 'Vaultwarden', detail: 'passwords', level: 'ok', url: 'https://vault.example-tailnet.ts.net' },
    { id: 'homeassistant', title: 'Home Assistant', detail: 'smart home', level: 'crit' },
  ],
  runbooks: [{ id: 'dns', title: 'When DNS stops', local: true }],
  backups: { level: 'ok', sets: [{ name: 'vaultwarden', detail: 'verified 5h ago', level: 'ok' }] },
  alerts: { incidents: [{ key: 'kuma-down', title: 'Uptime Kuma: Home Assistant is DOWN', prio: 'high', opened: '2026-03-10T06:39:00Z', state: 'open' }] },
  timers: [{ unit: 'homelab-backup.timer', activates: 'homelab-backup.service', description: 'Nightly backup', result: 'success' }],
} as unknown as Snapshot)

describe('command bar', () => {
  it('lists every page, service, app, checklist, backup set, alert and timer', () => {
    const groups = new Set(paletteItems(snap()).map((i) => i.group))
    expect([...groups]).toEqual(['Go to', 'Services', 'Open an app', 'Checklists', 'Backup sets', 'Alerts', 'Timers'])
  })
  it('opens on the pages and whatever needs you', () => {
    const r = search(paletteItems(snap()), '  ')
    expect(r.filter((i) => i.group === 'Go to')).toHaveLength(PAGES.length)
    expect(r.map((i) => i.title)).toContain('Home Assistant')
    expect(r.map((i) => i.title)).not.toContain('Vaultwarden')
  })
  it('ranks a match at the start of a title first', () => {
    const r = search(paletteItems(snap()), 'vau')
    expect(r[0]).toMatchObject({ group: 'Services', title: 'Vaultwarden', href: '#/services/vaultwarden' })
    expect(r.map((i) => i.group)).toEqual(expect.arrayContaining(['Backup sets', 'Open an app']))
  })
  it('needs every word to match', () => {
    expect(search(paletteItems(snap()), 'home down').map((i) => i.group)).toEqual(['Alerts'])
    expect(search(paletteItems(snap()), 'home nothing')).toEqual([])
  })
  it('links a local checklist inside the deck and an app outside it', () => {
    const items = paletteItems(snap())
    expect(items.find((i) => i.id === 'rb:dns')).toMatchObject({ href: '#/runbooks/dns', external: false })
    expect(items.find((i) => i.id === 'app:vaultwarden')).toMatchObject({ external: true, sub: 'vault.example-tailnet.ts.net' })
  })
})
