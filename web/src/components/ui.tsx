// The building blocks every page is made of. Two rules: healthy things carry
// no colour beyond a quiet green, and a state is never shown by colour alone:
// it always has a shape and, where there is room, a word.
import type { ComponentChildren } from 'preact'
import { useEffect, useId, useRef, useState } from 'preact/hooks'
import type { Level } from '../types'
import { bucket } from '../derive'
import { IconBack, IconDevice, IconMoon, IconSun } from './icons'
import { MODES, setMode, useMode } from '../theme'

export const WORD: Record<Level, string> = { ok: 'Fine', info: 'Note', warn: 'Needs you', crit: 'Down', unknown: "Can't see", off: 'Off' }

/** The status shape: a check when fine, a ring with a mark when it needs you,
 *  a disc with a bar when down, a dashed ring when Vesper can't see, a faint
 *  ring when off. */
export function Glyph({ level, size = 14, title }: { level: Level; size?: number; title?: string }) {
  const c = size / 2
  const r = c - 1.25
  return (
    <svg class={`glyph g-${level}`} width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={title ?? WORD[level]}>
      {level === 'crit' && (<><circle cx={c} cy={c} r={r} class="fill" /><rect x={c - r * 0.5} y={c - 0.85} width={r} height={1.7} rx={0.85} class="cut" /></>)}
      {level === 'warn' && (<><circle cx={c} cy={c} r={r - 0.4} class="ring" /><rect x={c - 0.75} y={c - r * 0.5} width={1.5} height={r * 0.6} rx={0.75} class="mark" /><circle cx={c} cy={c + r * 0.42} r={0.9} class="mark" /></>)}
      {level === 'unknown' && <circle cx={c} cy={c} r={r - 0.4} class="ring dashed" />}
      {level === 'off' && <circle cx={c} cy={c} r={r - 0.6} class="ring" />}
      {level === 'info' && <circle cx={c} cy={c} r={r * 0.4} class="fill" />}
      {level === 'ok' && <path d={`M${c - r * 0.6} ${c + 0.1} l${r * 0.4} ${r * 0.4} l${r * 0.78} ${-r * 0.86}`} class="check" />}
    </svg>
  )
}

/** A small status dot: filled when up, dashed when unknown, hollow when off. */
export function Dot({ level, live }: { level: Level; live?: boolean }) {
  const cls = level === 'ok' ? '' : level
  return <span class={`dot ${cls}${live ? ' live-dot' : ''}`} role="img" aria-label={WORD[level]} />
}

/** A status word with its shape, shown when something is not fine. */
export function State({ level, children }: { level: Level; children?: ComponentChildren }) {
  return <span class={`state ${level}`}><Glyph level={level} size={13} />{children ?? WORD[level]}</span>
}

export function PageHead({ title, sub, aside }: { title: ComponentChildren; sub?: ComponentChildren; aside?: ComponentChildren }) {
  return (
    <header class="page-head">
      <div>
        <h1>{title}</h1>
        {sub && <p class="sub">{sub}</p>}
      </div>
      {aside && <div class="aside">{aside}</div>}
    </header>
  )
}

export function Section({ title, aside, children, id, class: cls }: { title: ComponentChildren; aside?: ComponentChildren; children: ComponentChildren; id?: string; class?: string }) {
  return (
    <section class={`sec${cls ? ' ' + cls : ''}`} id={id} aria-label={typeof title === 'string' ? title : undefined}>
      <div class="sec-h"><h2>{title}</h2>{aside && <div class="aside">{aside}</div>}</div>
      {children}
    </section>
  )
}

export interface FigProps { label: string; value: ComponentChildren; unit?: string; caption?: ComponentChildren; level?: Level }

export function Figures({ items, four = true }: { items: FigProps[]; four?: boolean }) {
  return (
    <div class={`figs${four ? ' four' : ''}`}>
      {items.map((f) => (
        <div key={f.label} class={`fig${f.level && f.level !== 'ok' ? ' ' + f.level : ''}`}>
          <div class="k">{f.label}</div>
          <div class="v"><Tween value={f.value} />{f.unit && <small>{f.unit}</small>}</div>
          {f.caption && <div class="c">{f.caption}</div>}
        </div>
      ))}
    </div>
  )
}

/** A figure that can ease: a plain number, or a string that is only digits
 *  with an optional decimal part ("99.94"), with the decimals it is shown at. */
export function figureNumber(v: unknown): { n: number; dec: number } | null {
  if (typeof v === 'number') return isFinite(v) ? { n: v, dec: Number.isInteger(v) ? 0 : Math.min(2, String(v).split('.')[1]?.length ?? 0) } : null
  if (typeof v === 'string' && /^\d+(\.\d+)?$/.test(v)) return { n: Number(v), dec: v.split('.')[1]?.length ?? 0 }
  return null
}

const DESK = '(hover: hover) and (min-width: 1100px)'

/** True on a desktop: a pointer that hovers and room for the sidebar. The
 *  layout turns at the same width (styles.css, wider screens). */
export function useDesk(): boolean {
  const [desk, setDesk] = useState(() => typeof matchMedia === 'function' && matchMedia(DESK).matches)
  useEffect(() => {
    if (typeof matchMedia !== 'function') return
    const m = matchMedia(DESK)
    const on = () => setDesk(m.matches)
    m.addEventListener('change', on)
    on()
    return () => m.removeEventListener('change', on)
  }, [])
  return desk
}

/** Motion is off for reduced motion and for screenshots (?shot). */
export function still(): boolean {
  return (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches) ||
    (typeof document !== 'undefined' && document.documentElement.classList.contains('shot'))
}

/** True while the page may move: the tab is on show, and neither the reader
 *  nor a screenshot asked for stillness. Follows both as they change. */
export function useMotion(): boolean {
  const read = () => !still() && !document.hidden
  const [on, setOn] = useState(read)
  useEffect(() => {
    const set = () => setOn(read())
    const calm = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null
    document.addEventListener('visibilitychange', set)
    calm?.addEventListener('change', set)
    set()
    return () => {
      document.removeEventListener('visibilitychange', set)
      calm?.removeEventListener('change', set)
    }
  }, [])
  return on
}

/** Shows a figure; when a live update changes it, the number eases to its new
 *  value instead of jumping. The first paint never animates, and anything that
 *  is not a plain number (a time, a dash, "None") is shown as it is. */
function Tween({ value }: { value: ComponentChildren }) {
  const fig = figureNumber(value)
  const [shown, setShown] = useState(fig?.n ?? 0)
  const at = useRef<number | null>(fig?.n ?? null)
  useEffect(() => {
    if (!fig) {
      at.current = null
      return
    }
    const from = at.current
    const to = fig.n
    if (from == null || from === to || still()) {
      at.current = to
      setShown(to)
      return
    }
    let raf = 0
    const t0 = performance.now()
    const step = (t: number) => {
      const p = Math.min(1, (t - t0) / 700)
      const v = from + (to - from) * (1 - Math.pow(1 - p, 3))
      at.current = v // an update that lands mid-way starts from here, so the number never jumps back
      setShown(v)
      if (p < 1) raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [fig?.n])
  if (!fig) return <>{value}</>
  return <>{(at.current === fig.n ? fig.n : shown).toFixed(fig.dec)}</>
}

export function Btn({ href, children, primary, external, onClick, label }: { href?: string; children: ComponentChildren; primary?: boolean; external?: boolean; onClick?: () => void; label?: string }) {
  const cls = `btn${primary ? ' primary' : ''}`
  if (href) {
    return <a class={cls} href={href} aria-label={label} {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}>{children}</a>
  }
  return <button type="button" class={cls} aria-label={label} onClick={onClick}>{children}</button>
}

/** A segmented control: one of a few views of the same list. */
const MODE_ICON = { system: IconDevice, light: IconSun, dark: IconMoon }

/** The theme control: follow the device, or hold day or night. Where room is
 *  short it shows the three icons alone; each still carries its word for a
 *  screen reader and on hover. */
export function ThemeSwitch({ compact }: { compact?: boolean }) {
  const mode = useMode()
  return (
    <div class={`seg seg-theme${compact ? '' : ' wide'}`} role="group" aria-label="Theme">
      {MODES.map(([k, word]) => {
        const Icon = MODE_ICON[k]
        const say = k === 'system' ? 'Follow this device' : `${word} theme`
        return (
          <button key={k} type="button" aria-pressed={mode === k} aria-label={compact ? say : undefined} title={compact ? say : undefined} onClick={() => setMode(k)}>
            <Icon size={compact ? 14 : 15} />{!compact && <span>{word}</span>}
          </button>
        )
      })}
    </div>
  )
}

export function Seg<T extends string>({ options, value, onChange, label }: { options: readonly (readonly [T, string])[]; value: T; onChange: (v: T) => void; label: string }) {
  return (
    <div class="seg" role="group" aria-label={label}>
      {options.map(([k, l]) => <button key={k} type="button" aria-pressed={value === k} onClick={() => onChange(k)}>{l}</button>)}
    </div>
  )
}

export function Empty({ children, left }: { children: ComponentChildren; left?: boolean }) {
  return <div class={`empty${left ? ' left' : ''}`}>{children}</div>
}

/** A detail page whose thing is gone: the way back, a heading, and why. */
export function NotFound({ back, backLabel, title, children }: { back: string; backLabel: string; title: string; children: ComponentChildren }) {
  return (
    <div>
      <a class="back" href={back}><IconBack size={14} /> {backLabel}</a>
      <PageHead title={title} />
      <Empty>{children}</Empty>
    </div>
  )
}

const CELL: Record<string, string> = { u: '', d: 'd', x: 'x', '?': 'q', o: 'o' }

// the strip rises in once per page load, never again when a page is opened or a snapshot lands
let revealed = false

/** A day line drawn as `n` cells (the worst state in each). A down cell that
 *  is over turns a quieter red, so only what is down now is loud. With
 *  `reveal`, the first one drawn after the page loads rises in once. */
export function Day({ day, n, size, label, onCell, reveal }: { day: string; n: number; size?: 'mid' | 'tall'; label: string; onCell?: (i: number | null, e?: MouseEvent) => void; reveal?: boolean }) {
  const [rise] = useState(() => {
    if (!reveal || revealed) return false
    revealed = true
    return true
  })
  const cells = bucket(day, n)
  const last = cells.length - 1
  // the cell under the pointer comes from its position along the line, not from the element
  // it lands on: on a phone the gaps between 96 cells are wider than the cells themselves
  const at = (e: MouseEvent) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
    onCell?.(r.width ? Math.max(0, Math.min(cells.length - 1, Math.floor(((e.clientX - r.left) / r.width) * cells.length))) : null, e)
  }
  return (
    <span class={`day${size ? ' ' + size : ''}${rise ? ' reveal' : ''}`} role="img" aria-label={label}
      onMouseMove={onCell && ((e) => at(e as unknown as MouseEvent))}
      onClick={onCell && ((e) => at(e as unknown as MouseEvent))}
      onMouseLeave={onCell && (() => onCell(null))}>
      {cells.split('').map((c, i) => <i key={i} data-i={i} class={c === 'x' && i < last ? 'w' : CELL[c] ?? 'q'} style={rise ? { '--i': i } : undefined} />)}
    </span>
  )
}

/** The last samples, one cell each (the collector's beat history). */
export function Beats({ beats, label }: { beats: string; label: string }) {
  return (
    <span class="beats" role="img" aria-label={label}>
      {beats.split('').map((c, i) => <i key={i} class={CELL[c] ?? 'q'} />)}
    </span>
  )
}

/** A line over values with an area under it that fades to nothing and a dot
 *  at the newest value; negative values are gaps (a failed probe). A `fluid`
 *  chart stretches to its width, so its dot is drawn in HTML to stay round. */
export function Spark({ values, w = 120, h = 28, level, grid, fluid }: { values: number[]; w?: number; h?: number; level?: Level; grid?: boolean; fluid?: boolean }) {
  const fade = 'f' + useId().replace(/[^\w-]/g, '')
  const ok = values.filter((v) => v >= 0)
  if (ok.length < 2) return <svg class="spark" width={fluid ? '100%' : w} height={h} aria-hidden="true" />
  const max = Math.max(...ok)
  const min = Math.min(0, ...ok)
  const span = max - min || 1
  const step = w / Math.max(1, values.length - 1)
  const pad = 2
  const y = (v: number) => h - pad - ((v - min) / span) * (h - pad * 2)
  let line = ''
  let area = ''
  let seg: [number, number][] = []
  const flush = () => {
    if (seg.length > 1) area += `M${seg[0][0].toFixed(1)} ${h}` + seg.map(([x, yy]) => `L${x.toFixed(1)} ${yy.toFixed(1)}`).join('') + `L${seg[seg.length - 1][0].toFixed(1)} ${h}Z`
    seg = []
  }
  values.forEach((v, i) => {
    if (v < 0) { flush(); return }
    const x = i * step
    const yy = y(v)
    line += `${seg.length ? 'L' : 'M'}${x.toFixed(1)} ${yy.toFixed(1)}`
    seg.push([x, yy])
  })
  flush()
  const lastI = values.length - 1
  const endV = values[lastI]
  const tone = level && level !== 'ok' ? ' ' + level : ''
  const svg = (
    <svg class={`spark${tone}`} width={fluid ? '100%' : w} height={h} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-hidden="true">
      <defs>
        <linearGradient id={fade} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="currentColor" stop-opacity={fluid ? 0.16 : 0.2} />
          <stop offset="1" stop-color="currentColor" stop-opacity="0" />
        </linearGradient>
      </defs>
      {grid && <g class="grid">{[0.25, 0.5, 0.75].map((f) => <line key={f} x1="0" x2={w} y1={(h * f).toFixed(1)} y2={(h * f).toFixed(1)} />)}</g>}
      <path class="area" d={area} fill={`url(#${fade})`} />
      <path class="line" d={line} />
      {endV >= 0 && !fluid && <><circle class="halo" cx={(lastI * step).toFixed(1)} cy={y(endV).toFixed(1)} r={3.6} /><circle class="end" cx={(lastI * step).toFixed(1)} cy={y(endV).toFixed(1)} r={1.9} /></>}
    </svg>
  )
  if (!fluid) return svg
  return (
    <div class="spark-fluid">
      {svg}
      {endV >= 0 && <i class={`spark-dot${tone}`} style={{ top: `${((y(endV) / h) * 100).toFixed(2)}%` }} aria-hidden="true" />}
    </div>
  )
}

/** How full something is against its own limit. */
export function Meter({ pct, level = 'ok', label }: { pct: number; level?: Level | 'plain'; label?: string }) {
  return (
    <span class={`meter ${level === 'plain' ? '' : level}`} role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)}>
      <i style={{ width: `${Math.max(2, Math.min(100, pct))}%` }} />
    </span>
  )
}

/** Day bars (alerts per day), oldest first. */
export function Hist({ bins, h = 48 }: { bins: { crit: number; warn: number; info: number; t: number }[]; h?: number }) {
  const max = Math.max(1, ...bins.map((b) => b.crit + b.warn + b.info))
  return (
    <span class="hist" style={{ height: `${h}px` }} aria-hidden="true">
      {bins.map((b) => {
        const tot = b.crit + b.warn + b.info
        const lv = b.crit ? 'crit' : b.warn ? 'warn' : tot ? 'info' : ''
        return <i key={b.t} class={lv} style={{ height: `${tot ? Math.max(14, (tot / max) * 100) : 4}%` }} />
      })}
    </span>
  )
}

/** Runs as cells (nightly backups, weekly drills): pick one to see what it was. */
export function Runs({ items, selected, onPick, label }: { items: { level: Level; label: string }[]; selected?: number; onPick?: (i: number) => void; label: string }) {
  return (
    <span class="runs" role="group" aria-label={label}>
      {items.map((it, i) => {
        const cls = it.level === 'crit' ? 'crit' : it.level === 'ok' ? '' : 'info'
        return onPick
          ? <button type="button" key={i} class={cls} aria-label={it.label} aria-pressed={selected === i} onClick={() => onPick(i)} />
          : <i key={i} class={cls} role="img" aria-label={it.label} />
      })}
    </span>
  )
}

/** A quiet tooltip that follows the pointer. Opened by a tap or the keyboard
 *  (no pointer to leave), it closes by itself after a few seconds. */
export function useTip(): [ComponentChildren, (html: ComponentChildren | null, e?: MouseEvent | FocusEvent) => void] {
  const [tip, setTip] = useState<{ body: ComponentChildren; x: number; y: number; below: number } | null>(null)
  const timer = useRef(0)
  const pinned = useRef(0)
  useEffect(() => () => clearTimeout(timer.current), [])
  // a tip is pinned to the screen, so it must not stay behind when the page scrolls under it
  useEffect(() => {
    if (!tip) return
    const hide = () => setTip(null)
    addEventListener('scroll', hide, { passive: true, once: true })
    return () => removeEventListener('scroll', hide)
  }, [tip !== null])
  // .tip is at most 272px wide: keep it 8px inside both edges, and below the pointer or the element when there is no room above
  const node = tip ? <div class="tip" role="status" style={{ left: `${Math.max(8, Math.min(tip.x + 12, innerWidth - 280))}px`, top: `${tip.y < 60 ? tip.below : tip.y - 44}px` }}>{tip.body}</div> : null
  return [node, (body, e) => {
    if (!body || !e) {
      // a phone sends mouseleave right after the tap itself: that must not close what the tap opened
      if (Date.now() < pinned.current) return
      clearTimeout(timer.current)
      return setTip(null)
    }
    clearTimeout(timer.current)
    pinned.current = 0
    if (e.type === 'focus') {
      const r = (e.target as HTMLElement).getBoundingClientRect()
      setTip({ body, x: r.left, y: r.top, below: r.bottom + 6 })
    } else setTip({ body, x: (e as MouseEvent).clientX, y: (e as MouseEvent).clientY, below: (e as MouseEvent).clientY + 18 })
    if (e.type === 'click' || e.type === 'focus') {
      timer.current = window.setTimeout(() => setTip(null), 3500)
      if (e.type === 'click' && typeof matchMedia === 'function' && matchMedia('(hover: none)').matches) pinned.current = Date.now() + 3500
    }
  }]
}
