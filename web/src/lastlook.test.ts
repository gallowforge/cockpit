import { describe, expect, it } from 'vitest'
import { awayFor, sinceParts } from './lastlook'
import type { Snapshot } from './types'

const base = (): Snapshot => ({
  backups: { level: 'ok', sets: [], bytes: 0, runs: [{ start: '2026-03-10T02:00:01Z', end: '2026-03-10T02:02:28Z', result: 'success' }] },
  drill: { level: 'ok', runs: [] },
  alerts: { level: 'ok', open: [], sent_24h: 0, sent_7d: 0, incidents: [
    { key: 'kuma-down', title: 'Home Assistant is DOWN', prio: 'high', opened: '2026-03-10T06:39:00Z', resolved: '2026-03-10T06:43:00Z', sends: 1, suppressed: 0, failed: 0, state: 'resolved' },
    { key: 'caretaker-morning', title: 'note', prio: 'low', opened: '2026-03-10T05:00:00Z', sends: 1, suppressed: 0, failed: 0, state: 'info' },
  ] },
  timers: [],
} as unknown as Snapshot)

describe('since you last looked', () => {
  it('tells the story of the night', () => {
    const p = sinceParts(base(), Date.parse('2026-03-09T22:00:00Z'))
    expect(p.map((x) => x.text)).toEqual([
      expect.stringMatching(/^the backup ran at \d\d:\d\d and verified every set$/),
      '"Home Assistant is DOWN" came and went in 4 minutes',
    ])
  })
  it('says nothing when nothing happened', () => {
    expect(sinceParts(base(), Date.parse('2026-03-10T07:00:00Z'))).toEqual([])
  })
  it('names the time away in words', () => {
    expect(awayFor(0, 9 * 3600e3)).toBe('9 hours')
    expect(awayFor(0, 60e3)).toBe('1 minute')
  })
})
