import { describe, expect, it } from 'vitest'
import { figureNumber } from './ui'

describe('a figure that can ease', () => {
  it('takes a plain number at the decimals it has, two at most', () => {
    expect(figureNumber(12)).toEqual({ n: 12, dec: 0 })
    expect(figureNumber(99.9)).toEqual({ n: 99.9, dec: 1 })
    expect(figureNumber(3.14159)).toEqual({ n: 3.14159, dec: 2 })
  })
  it('takes a string of digits at the decimals it is written with', () => {
    expect(figureNumber('161')).toEqual({ n: 161, dec: 0 })
    expect(figureNumber('99.94')).toEqual({ n: 99.94, dec: 2 })
    expect(figureNumber('100.0')).toEqual({ n: 100, dec: 1 })
  })
  it('leaves everything else as it is written', () => {
    for (const v of ['05:00', '—', 'None', '1,204', '-3', '', ' 12', NaN, Infinity, null, undefined]) expect(figureNumber(v)).toBeNull()
  })
})
