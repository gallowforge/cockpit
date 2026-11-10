import { describe, expect, it } from 'vitest'
import { across, ramp, REACH, smooth, SOURCE, spine, trace, weave } from './ribbon'

describe('the ribbon’s arithmetic', () => {
  it('reads a curve straight between its stops and holds its ends', () => {
    const stops = [[0, 1], [0.5, 0.4], [1, 0]] as const
    expect(ramp(stops, -1)).toBe(1)
    expect(ramp(stops, 0)).toBe(1)
    expect(ramp(stops, 0.25)).toBeCloseTo(0.7)
    expect(ramp(stops, 0.5)).toBeCloseTo(0.4)
    expect(ramp(stops, 0.75)).toBeCloseTo(0.2)
    expect(ramp(stops, 2)).toBe(0)
  })
  it('eases a step between two edges', () => {
    expect(smooth(0.2, 0.8, 0)).toBe(0)
    expect(smooth(0.2, 0.8, 0.5)).toBeCloseTo(0.5)
    expect(smooth(0.2, 0.8, 1)).toBe(1)
    const steps = Array.from({ length: 21 }, (_, i) => smooth(0, 1, i / 20))
    expect(steps.every((v, i) => i === 0 || v >= steps[i - 1])).toBe(true)
  })
})

describe('the weave', () => {
  it('gives every service the same bundle of threads, side by side', () => {
    const w = weave(12)
    expect(w).toHaveLength(48)
    for (let lane = 0; lane < 12; lane++) expect(w.filter((s) => s.owner === lane)).toHaveLength(4)
    expect(w.map((s) => s.owner)).toEqual([...w.map((s) => s.owner)].sort((a, b) => a - b))
    expect(w[0].u).toBe(-1)
    expect(w[w.length - 1].u).toBeCloseTo(1)
    expect(w.every((s, i) => i === 0 || s.u > w[i - 1].u)).toBe(true)
  })
  it('leaves more air between two services than inside one', () => {
    const w = weave(12)
    const inside = w[1].u - w[0].u
    const between = w[4].u - w[3].u
    expect(w[3].owner).not.toBe(w[4].owner)
    expect(between / inside).toBeCloseTo(1.9)
  })
  it('thins the bundles for a large fleet and never drops a service', () => {
    expect(weave(24)).toHaveLength(48)
    const big = weave(100)
    expect(big).toHaveLength(100)
    expect(new Set(big.map((s) => s.owner)).size).toBe(100)
    expect(big[1].u - big[0].u).toBeCloseTo(big[51].u - big[50].u)
  })
  it('hangs one service across the whole ribbon', () => {
    const one = weave(1)
    expect(one.map((s) => s.owner)).toEqual([0, 0, 0, 0])
    expect([one[0].u, one[3].u]).toEqual([-1, 1])
  })
  it('lays even, ownerless threads when there are no services', () => {
    const none = weave(0, 10)
    expect(none).toHaveLength(10)
    expect(none.every((s) => s.owner === -1)).toBe(true)
    expect(none[1].u - none[0].u).toBeCloseTo(2 / 9)
  })
  it('is the same ribbon on every load', () => {
    expect(weave(12)).toEqual(weave(12))
    for (const s of weave(12)) {
      expect(s.seed).toBeGreaterThanOrEqual(0)
      expect(s.seed).toBeLessThan(1)
      expect(s.weight).toBeGreaterThanOrEqual(0.72)
      expect(s.weight).toBeLessThanOrEqual(1)
    }
  })
})

describe('the spine', () => {
  const w = 760, h = 280
  const sp = spine(w, h)
  const end = sp.n - 1
  it('runs from the source to just inside the stage’s left edge', () => {
    expect(sp.x[0]).toBeCloseTo(w + SOURCE.x)
    expect(sp.y[0]).toBeCloseTo(SOURCE.y)
    expect(sp.x[end]).toBeCloseTo(w * 0.08, 3)
    expect(sp.y[end]).toBeCloseTo(h * 0.78, 3)
    expect(Math.min(...sp.x)).toBeGreaterThan(0)
  })
  it('carries a unit normal at every point', () => {
    for (let i = 0; i < sp.n; i++) expect(Math.hypot(sp.nx[i], sp.ny[i])).toBeCloseTo(1, 5)
  })
  it('leaves the source narrow as a beam and opens to its full width', () => {
    expect(sp.half[0]).toBe(2)
    expect(sp.half[end]).toBeCloseTo(h * 0.15, 4)
    expect(Array.from(sp.half).every((v, i) => i === 0 || v >= sp.half[i - 1])).toBe(true)
  })
  it('keeps its width inside sensible bounds on a short or a tall stage', () => {
    expect(spine(800, 100).half[95]).toBeCloseTo(26, 4)
    expect(spine(800, 600).half[95]).toBeCloseTo(44, 4)
  })
  it('samples as many points as it is asked for', () => {
    expect(spine(w, h, 32).x).toHaveLength(32)
  })
})

describe('a thread', () => {
  it('never strays further across the ribbon than REACH', () => {
    let far = 0
    for (let u = -1; u <= 1; u += 0.1) for (let s = 0; s <= 1; s += 0.02) for (let t = 0; t < 400; t += 3.7) far = Math.max(far, Math.abs(across(u, s, t, 0.5)))
    expect(far).toBeLessThanOrEqual(REACH)
    expect(far).toBeGreaterThan(1) // and the folds do carry it past the plain edge
  })
  it('moves with time, slowly', () => {
    expect(across(0.3, 0.5, 0)).not.toBe(across(0.3, 0.5, 5))
    expect(Math.abs(across(0.3, 0.5, 0) - across(0.3, 0.5, 1 / 30))).toBeLessThan(0.01)
  })
  it('is traced as one point for each point of the spine, within the ribbon', () => {
    const sp = spine(760, 280)
    const [first, last] = [weave(12)[0], weave(12)[47]]
    const out = new Float32Array(2 * sp.n)
    for (const strand of [first, last]) {
      expect(trace(sp, strand, 31, out)).toBe(out)
      for (let i = 0; i < sp.n; i++) {
        const away = Math.hypot(out[2 * i] - sp.x[i], out[2 * i + 1] - sp.y[i])
        expect(away).toBeLessThanOrEqual(sp.half[i] * REACH + 1e-3)
      }
    }
    // at the source every thread is inside the beam
    expect(Math.hypot(out[0] - sp.x[0], out[1] - sp.y[0])).toBeLessThanOrEqual(2 * REACH + 1e-3)
  })
})
