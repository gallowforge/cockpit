import { describe, expect, it } from 'vitest'
import { plainCount } from './system'

describe('plainCount', () => {
  it('turns "(s)" into the right word', () => {
    expect(plainCount('1 problem(s) found')).toBe('1 problem found')
    expect(plainCount('3 problem(s) found, 2 file(s) differ')).toBe('3 problems found, 2 files differ')
    expect(plainCount('all healthy - staying quiet')).toBe('all healthy - staying quiet')
  })
})
