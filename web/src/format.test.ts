import { describe, expect, it } from 'vitest'
import { ago, bytes, dayLabel, dayWord, duration, inAbout, pct, plural, precise, short, until } from './format'

const now = Date.parse('2026-03-10T07:42:00Z')

describe('format', () => {
  it('says durations like the CLI', () => {
    expect(short(30_000)).toBe('30s')
    expect(short(5 * 60_000)).toBe('5m')
    expect(short(30 * 3600_000)).toBe('30h')
    expect(short(72 * 3600_000)).toBe('3d')
    expect(short(NaN)).toBe('—')
  })
  it('keeps countdowns precise', () => {
    expect(precise(65_000)).toBe('1m 05s')
    expect(precise(3 * 3600_000 + 7 * 60_000)).toBe('3h 07m')
    expect(precise(50 * 3600_000)).toBe('2d 2h')
  })
  it('ago and until use the given clock', () => {
    expect(ago('2026-03-10T07:41:58Z', now)).toBe('just now')
    expect(ago('2026-03-10T04:42:00Z', now)).toBe('3h ago')
    expect(ago(undefined, now)).toBe('never')
    expect(until('2026-03-10T07:42:39Z', now)).toBe('in 39s')
    expect(until('2026-03-10T07:40:00Z', now)).toBe('now')
    // inside a sentence a relative day loses its capital and a date keeps its own
    expect(dayWord('2026-03-10T07:00:00Z', now)).toBe('today')
    expect(dayWord('2026-03-09T07:42:00Z', now)).toBe('yesterday')
    expect(dayWord('2026-03-05T07:42:00Z', now)).toBe(dayLabel('2026-03-05T07:42:00Z', now))
  })
  it('uses decimal byte units', () => {
    expect(bytes(999)).toBe('999 B')
    expect(bytes(224_853)).toBe('225 KB')
    expect(bytes(23_700_000)).toBe('23.7 MB')
    expect(bytes(161_400_000)).toBe('161 MB')
  })
  it('handles edge cases', () => {
    expect(pct(5, 0)).toBe(0)
    expect(pct(150, 100)).toBe(100)
    expect(plural(1, 'set')).toBe('1 set')
    expect(plural(2, 'set')).toBe('2 sets')
    expect(duration('2026-03-10T05:00:01Z', '2026-03-10T05:02:28Z')).toBe('2m 27s')
    expect(duration('2026-03-10T05:00:01.000Z', '2026-03-10T05:00:01.250Z')).toBe('250 ms')
  })
})

describe('inAbout', () => {
  const now = Date.parse('2026-03-10T07:42:00Z')
  it('counts down in minutes and hours', () => {
    expect(inAbout('2026-03-10T08:00:30Z', now)).toBe('in 19 min')
    expect(inAbout('2026-03-11T02:00:00Z', now)).toBe('in 18 h 18 min')
    expect(inAbout('2026-03-10T07:00:00Z', now)).toBe('now')
  })
})
