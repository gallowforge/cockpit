// The ribbon: the fleet drawn as light, as plain arithmetic.
//
// On the Overview a sheaf of fine threads pours out of the glow in the sky and
// thins to nothing before it reaches the words. Every service owns a lane of
// it, so the picture is the fleet itself: a lane that answers is cool light,
// one that is struggling runs amber, one that is down runs red, and one nobody
// can see is a grey ghost. This file says what the ribbon is: whose thread is
// whose, the line it hangs along, and how a thread lies across that line at
// any moment. It knows nothing of the canvas (stage.ts draws it), which is
// what makes it easy to test.
import type { Service } from './types'

const TAU = Math.PI * 2

export type Stops = readonly (readonly [number, number])[]

/** Reads a curve given as [position, value] stops, straight between them. */
export function ramp(stops: Stops, t: number): number {
  if (t <= stops[0][0]) return stops[0][1]
  for (let i = 1; i < stops.length; i++) {
    const [at, v] = stops[i]
    if (t <= at) {
      const [at0, v0] = stops[i - 1]
      return v0 + ((v - v0) * (t - at0)) / (at - at0)
    }
  }
  return stops[stops.length - 1][1]
}

/** 0 below `a`, 1 above `b`, and an eased step between them. */
export const smooth = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

// ---- which light is whose ----

/** A lane is lit the way its service is: the state, word for word. */
export type Tone = Service['state']

/** A thread: where it sits across the ribbon (-1 and 1 are the edges), whose
 *  it is (an index into the services, or -1 when there are none), and two
 *  numbers of its own, 0 to 1, so that no two threads are quite alike. */
export interface Strand { u: number; owner: number; seed: number; weight: number }

/** A fixed scatter of 0..1 values: the same ribbon on every load, with no generator to carry around. */
const scatter = (i: number, salt: number) => {
  const x = Math.sin(i * 127.1 + salt * 311.7) * 43758.5453
  return x - Math.floor(x)
}

/** Lays the threads out for `services` services. Each gets the same small
 *  bundle, about `aim` threads in all, with a little more air between two
 *  bundles than inside one: so a service is a lane of the ribbon, and a lane
 *  that changes colour can be seen. With no services, `aim` even threads. */
export function weave(services: number, aim = 48): Strand[] {
  const per = services > 0 ? Math.max(1, Math.min(4, Math.round(aim / services))) : 1
  const lanes = services > 0 ? services : aim
  const gap = per > 1 ? 1.9 : 1 // the air between two bundles, in thread spacings
  const span = lanes * (per - 1) + (lanes - 1) * gap
  const out: Strand[] = []
  let at = 0
  for (let lane = 0; lane < lanes; lane++) {
    for (let k = 0; k < per; k++) {
      const i = out.length
      out.push({ u: span > 0 ? (at / span) * 2 - 1 : 0, owner: services > 0 ? lane : -1, seed: scatter(i, 1), weight: 0.72 + 0.28 * scatter(i, 2) })
      at += k < per - 1 ? 1 : gap
    }
  }
  return out
}

// ---- where it hangs ----

/** Where the light comes from, measured from the stage's top right corner. The
 *  glow in the sky (styles.css, atmosphere) is centred on the same point. */
export const SOURCE = { x: 40, y: -60 }

/** The line the ribbon follows, sampled: points, the unit normal at each, and
 *  half the ribbon's width there. */
export interface Spine { n: number; x: Float32Array; y: Float32Array; nx: Float32Array; ny: Float32Array; half: Float32Array }

/** The spine for a stage of `w` by `h` css pixels: out of the source narrow as
 *  a beam, down across the stage as it opens, and level again above the
 *  horizon, where it ends just inside the stage's left edge: short of the
 *  words, which are set to the left of it. The lower right of the stage is
 *  left clear: that is where the collector's lines are set. */
export function spine(w: number, h: number, n = 96): Spine {
  const px = [w + SOURCE.x, w * 0.62, w * 0.54, w * 0.08]
  const py = [SOURCE.y, h * 0.02, h * 0.94, h * 0.78]
  const wide = Math.max(26, Math.min(44, h * 0.15))
  const out: Spine = { n, x: new Float32Array(n), y: new Float32Array(n), nx: new Float32Array(n), ny: new Float32Array(n), half: new Float32Array(n) }
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1), m = 1 - t
    const b = [m * m * m, 3 * m * m * t, 3 * m * t * t, t * t * t] // the cubic curve
    const d = [-3 * m * m, 3 * m * m - 6 * m * t, 6 * m * t - 3 * t * t, 3 * t * t] // and its slope
    const dx = d[0] * px[0] + d[1] * px[1] + d[2] * px[2] + d[3] * px[3]
    const dy = d[0] * py[0] + d[1] * py[1] + d[2] * py[2] + d[3] * py[3]
    const len = Math.hypot(dx, dy) || 1
    out.x[i] = b[0] * px[0] + b[1] * px[1] + b[2] * px[2] + b[3] * px[3]
    out.y[i] = b[0] * py[0] + b[1] * py[1] + b[2] * py[2] + b[3] * py[3]
    out.nx[i] = -dy / len
    out.ny[i] = dx / len
    out.half[i] = 2 + (wide - 2) * smooth(0, 0.5, t) ** 0.9
  }
  return out
}

// ---- how it lies ----

/** Where a thread lies across the ribbon, in half-widths from its middle, at
 *  `s` along it (0 is the source, 1 the far end) and `t` seconds.
 *
 *  Three slow waves, none in step with another, so the ribbon never repeats:
 *  it opens and narrows along its length; one long fold crosses it at a slant,
 *  which is where threads pass over one another and the light gathers into a
 *  bright edge; and a finer fold runs back the other way. `seed` gives a
 *  thread a slight wander of its own, so it reads as thread and not as ruling. */
export function across(u: number, s: number, t: number, seed = 0): number {
  const open = 0.6 + 0.4 * Math.sin(TAU * 1.05 * s - 0.08 * t)
  const fold = 0.46 * Math.sin(TAU * (0.7 * s + 0.3 * u) - 0.11 * t + 1.3)
  const back = 0.16 * Math.sin(TAU * (1.9 * s - 0.45 * u) + 0.17 * t)
  const wander = 0.04 * Math.sin(TAU * (2.6 * s + seed) + (0.14 + 0.12 * seed) * t)
  return u * open + fold + back + wander
}

/** The furthest `across` can ever put a thread, in half-widths. */
export const REACH = 1 + 0.46 + 0.16 + 0.04

/** One thread's path at `t` seconds, as x, y pairs written into `out` (two
 *  numbers for each point of the spine). */
export function trace(sp: Spine, strand: Strand, t: number, out: Float32Array): Float32Array {
  for (let i = 0; i < sp.n; i++) {
    const off = sp.half[i] * across(strand.u, i / (sp.n - 1), t, strand.seed)
    out[2 * i] = sp.x[i] + sp.nx[i] * off
    out[2 * i + 1] = sp.y[i] + sp.ny[i] * off
  }
  return out
}
