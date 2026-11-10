// The stage: the ribbon of ribbon.ts, drawn on a canvas and kept alive.
//
// One canvas in the Overview's masthead, on a desktop only. It draws nothing
// but the threads and the glints that run down them when a snapshot arrives,
// at thirty frames a second, and it stops while the tab is hidden. A
// screenshot or a reader who asked for less motion gets one still frame, the
// same one every time.
import { ramp, SOURCE, spine, trace, weave, type Spine, type Stops, type Strand, type Tone } from './ribbon'
import { onTheme, theme, type Theme } from './theme'

export interface Ribbon {
  /** The fleet as it stands: one state for each service, in the snapshot's order. */
  set(tones: readonly Tone[]): void
  /** A snapshot has just arrived: a few glints run down the threads. */
  pulse(): void
  stop(): void
}

type Rgb = readonly [number, number, number]

/** The ribbon's colours in one theme: the state colours of styles.css, the two
 *  glints, how overlapping threads combine and how strongly they are drawn. At
 *  night the threads are light and add up where they cross. By day they are
 *  ink: deeper, and darker where they cross. */
interface Look { cyan: Rgb; green: Rgb; tail: Rgb; amber: Rgb; red: Rgb; sage: Rgb; glint: Rgb; glintWarn: Rgb; blend: GlobalCompositeOperation; gain: number }
const LOOK: Record<Theme, Look> = {
  dark: { cyan: [95, 225, 234], green: [88, 222, 134], tail: [190, 214, 96], amber: [247, 171, 62], red: [255, 106, 92], sage: [147, 165, 154], glint: [214, 250, 244], glintWarn: [255, 224, 170], blend: 'lighter', gain: 1 },
  light: { cyan: [8, 136, 150], green: [22, 138, 78], tail: [148, 146, 22], amber: [186, 112, 0], red: [208, 57, 44], sage: [102, 122, 110], glint: [3, 84, 96], glintWarn: [122, 70, 0], blend: 'multiply', gain: 1.7 },
}

/** How a lane is lit: its colour along the thread ([position, colour] from the
 *  source outward), how bright it is beside the others, and whether a glint
 *  ever runs down it. A lane that answers runs cool: the cyan of the source,
 *  through the green of "up", to a chartreuse tail. */
interface Light { hue: readonly (readonly [number, Rgb])[]; gain: number; glint: Rgb | null }
const lights = (k: Look): Record<Tone, Light> => ({
  up: { hue: [[0, k.cyan], [0.34, k.cyan], [0.62, k.green], [1, k.tail]], gain: 1, glint: k.glint },
  degraded: { hue: [[0, k.amber], [1, k.amber]], gain: 1.25, glint: k.glintWarn },
  down: { hue: [[0, k.red], [1, k.red]], gain: 1.5, glint: null },
  unknown: { hue: [[0, k.sage], [1, k.sage]], gain: 0.4, glint: null },
  off: { hue: [[0, k.sage], [1, k.sage]], gain: 0.14, glint: null },
})
const TONES: readonly Tone[] = ['up', 'degraded', 'down', 'unknown', 'off']

/** How bright a thread is along its length: full where it leaves the source,
 *  nothing where it ends. Eased, so it has no visible end. */
const FADE: Stops = [[0, 1], [0.1, 0.96], [0.24, 0.8], [0.4, 0.56], [0.56, 0.33], [0.7, 0.17], [0.82, 0.07], [0.92, 0.02], [1, 0]]

/** A thread is three strokes laid over one another: a wide breath of glow, a
 *  soft body, and the fine core. [width in css pixels, strength] */
const PASSES: readonly (readonly [number, number])[] = [[9, 0.022], [3, 0.07], [1, 0.42]]

const FRAME = 1000 / 30
const STILL_AT = 31 // the moment the still frame shows, in seconds
const LOST_MS = 90_000 // no snapshot for this long and the ribbon dims
const TURN_S = 1.6 // a lane changing colour
const GLINT_S = 2.6 // a glint's run down its thread
const GLINT_LEN = 0.1 // its length, as a share of the thread
/** A glint is two strokes: its glow and its core. [width in css pixels, strength] */
const GLINT: readonly (readonly [number, number])[] = [[5, 0.14], [1.25, 0.9]]

interface Lane { from: Tone; to: Tone; k: number }
interface Glint { strand: number; born: number }

/** Starts the ribbon on `canvas`, which the page sizes and places. `still`
 *  asks for the one fixed frame. */
export function startRibbon(canvas: HTMLCanvasElement, opts: { still?: boolean } = {}): Ribbon {
  const ctx = canvas.getContext('2d')
  const calm = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null
  if (!ctx) return { set() {}, pulse() {}, stop() {} }

  let w = 0, h = 0, dpr = 1
  let sp: Spine = spine(1, 1)
  let path = new Float32Array(2 * sp.n)
  let strands: Strand[] = weave(0)
  let lanes: Lane[] = []
  let glints: Glint[] = []
  const paint = new Map<Tone, CanvasGradient>()
  let look = LOOK[theme()]
  let LIGHT = lights(look)

  let t = STILL_AT
  let vigor = 1
  let heard = performance.now()
  let raf = 0, last = 0, running = false

  const frozen = () => !!opts.still || !!calm?.matches

  /** A lane's light as a gradient centred on the source, so every thread of it
   *  fades the same way however it wanders. */
  const gradient = (tone: Tone): CanvasGradient => {
    const sx = w + SOURCE.x, sy = SOURCE.y
    const reach = Math.hypot(sx - sp.x[sp.n - 1], sy - sp.y[sp.n - 1])
    const g = ctx.createRadialGradient(sx, sy, 0, sx, sy, reach)
    const { hue } = LIGHT[tone]
    for (let i = 0; i <= 24; i++) {
      const at = i / 24
      const c = [0, 1, 2].map((k) => Math.round(ramp(hue.map(([p, rgb]) => [p, rgb[k]] as const), at)))
      g.addColorStop(at, `rgba(${c[0]}, ${c[1]}, ${c[2]}, ${ramp(FADE, at).toFixed(3)})`)
    }
    return g
  }

  const resize = () => {
    const box = canvas.getBoundingClientRect()
    w = Math.round(box.width)
    h = Math.round(box.height)
    if (!w || !h) return
    dpr = Math.min(2, devicePixelRatio || 1, Math.sqrt(6e6 / (w * h)))
    canvas.width = Math.round(w * dpr)
    canvas.height = Math.round(h * dpr)
    sp = spine(w, h)
    path = new Float32Array(2 * sp.n)
    tint()
    draw()
  }

  /** Mixes every lane's gradient again: the canvas changed size, or the theme changed. */
  const tint = () => {
    paint.clear()
    for (const tone of TONES) paint.set(tone, gradient(tone))
  }

  /** Where the thread held in `path` is at point `p`, which may fall between two of its points. */
  const point = (p: number): [number, number] => {
    const i = Math.max(0, Math.min(sp.n - 2, Math.floor(p))), k = p - i
    return [path[2 * i] + (path[2 * i + 2] - path[2 * i]) * k, path[2 * i + 1] + (path[2 * i + 3] - path[2 * i + 1]) * k]
  }

  /** Strokes the thread held in `path` from point `a` to point `b`. */
  const stroke = (a: number, b: number) => {
    ctx.beginPath()
    ctx.moveTo(...point(a))
    for (let i = Math.floor(a) + 1; i < b; i++) ctx.lineTo(path[2 * i], path[2 * i + 1])
    ctx.lineTo(...point(b))
    ctx.stroke()
  }

  const draw = () => {
    if (!w || !h) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, w, h)
    ctx.globalCompositeOperation = look.blend
    ctx.lineJoin = 'round'
    ctx.lineCap = 'round'
    const end = sp.n - 1
    const hair = dpr >= 2 ? 0.75 : 1

    strands.forEach((strand, i) => {
      const lane: Lane = lanes[strand.owner] ?? { from: 'up', to: 'up', k: 1 }
      trace(sp, strand, t, path)
      for (const [tone, share] of [[lane.from, 1 - lane.k], [lane.to, lane.k]] as const) {
        if (share <= 0.004) continue
        ctx.strokeStyle = paint.get(tone)!
        for (const [width, strength] of PASSES) {
          ctx.lineWidth = width === 1 ? hair : width
          ctx.globalAlpha = Math.min(1, strength * look.gain * LIGHT[tone].gain * strand.weight * vigor * share)
          stroke(0, end)
        }
      }
      // a glint on this thread: a short run of light, bright at its head and gone behind it
      for (const g of glints) {
        if (g.strand !== i) continue
        const tint = LIGHT[lane.to].glint
        if (!tint) continue
        const life = (t - g.born) / GLINT_S
        if (life < 0) continue // not set off yet
        const head = 0.03 + 0.82 * life
        const a = Math.max(0, head - GLINT_LEN) * end, b = Math.min(1, head) * end
        const shine = ramp(FADE, head) * Math.sin(Math.PI * Math.min(1, life)) ** 0.6 * vigor
        const streak = ctx.createLinearGradient(...point(a), ...point(b))
        streak.addColorStop(0, `rgba(${tint}, 0)`)
        streak.addColorStop(0.55, `rgba(${tint}, 0.22)`)
        streak.addColorStop(1, `rgb(${tint})`)
        ctx.strokeStyle = streak
        for (const [width, strength] of GLINT) {
          ctx.lineWidth = width
          ctx.globalAlpha = Math.min(1, shine * strength)
          stroke(a, b)
        }
      }
    })
    ctx.globalAlpha = 1
    ctx.globalCompositeOperation = 'source-over'
  }

  const step = (dt: number, now: number) => {
    t += dt
    for (const lane of lanes) if (lane.k < 1) lane.k = Math.min(1, lane.k + dt / TURN_S)
    vigor += ((now - heard > LOST_MS ? 0.4 : 1) - vigor) * Math.min(1, dt * 0.8)
    glints = glints.filter((g) => t - g.born < GLINT_S)
  }

  const frame = (now: number) => {
    raf = requestAnimationFrame(frame)
    if (now - last < FRAME - 2) return
    step(Math.min(0.1, (now - last) / 1000), now)
    last = now
    draw()
  }
  const run = () => {
    if (running || document.hidden || frozen()) return
    running = true
    last = performance.now()
    raf = requestAnimationFrame(frame)
  }
  const halt = () => {
    running = false
    cancelAnimationFrame(raf)
  }
  /** Runs or rests as the tab and the reader's motion setting ask. */
  const apply = () => {
    halt()
    if (frozen()) {
      t = STILL_AT
      // the still frame shows three glints mid-run, on the same threads every time
      glints = [0.19, 0.5, 0.78].map((u, k) => ({ strand: Math.floor(u * strands.length), born: t - GLINT_S * [0.2, 0.46, 0.33][k] }))
      for (const lane of lanes) lane.k = 1
      vigor = 1
      draw()
    } else run()
  }

  const unthemed = onTheme(() => {
    if (look === LOOK[theme()]) return
    look = LOOK[theme()]
    LIGHT = lights(look)
    if (!w || !h) return
    tint()
    draw()
  })
  const sized = typeof ResizeObserver === 'function' ? new ResizeObserver(resize) : null
  sized?.observe(canvas)
  document.addEventListener('visibilitychange', apply)
  calm?.addEventListener('change', apply)
  resize()
  apply()

  return {
    set(tones) {
      heard = performance.now()
      if (tones.length !== lanes.length) {
        // a different fleet: lay the threads out again, already in their colours
        strands = weave(tones.length)
        lanes = tones.map((tone) => ({ from: tone, to: tone, k: 1 }))
        if (frozen()) apply()
        return
      }
      tones.forEach((tone, i) => {
        const lane = lanes[i]
        if (lane.to === tone) return
        lanes[i] = frozen() ? { from: tone, to: tone, k: 1 } : { from: lane.k >= 0.5 ? lane.to : lane.from, to: tone, k: 0 }
      })
      if (frozen()) draw()
    },
    pulse() {
      if (!running || !strands.length) return // at rest or out of sight: nothing would draw them
      for (let k = 0; k < 5; k++) glints.push({ strand: Math.floor(Math.random() * strands.length), born: t + k * 0.22 + Math.random() * 0.3 })
    },
    stop() {
      halt()
      unthemed()
      sized?.disconnect()
      document.removeEventListener('visibilitychange', apply)
      calm?.removeEventListener('change', apply)
    },
  }
}
