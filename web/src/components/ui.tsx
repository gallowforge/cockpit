// The building blocks every page is made of. Two rules: healthy things carry
// no colour beyond a quiet green, and a state is never shown by colour alone:
// it always has a shape and, where there is room, a word.
import type { ComponentChildren } from 'preact'
import { useState } from 'preact/hooks'
import type { Level } from '../types'
import { bucket } from '../derive'

export const WORD: Record<Level, string> = { ok: 'Fine', info: 'Note', warn: 'Needs you', crit: 'Down', unknown: "Can't see", off: 'Off' }

/** The status shape: a check when fine, a ring with a mark when it needs you,
 *  a disc with a bar when down, a dashed ring when Cockpit can't see, a faint
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
          <div class="v">{f.value}{f.unit && <small>{f.unit}</small>}</div>
          {f.caption && <div class="c">{f.caption}</div>}
        </div>
      ))}
    </div>
  )
}

export function Btn({ href, children, primary, external, onClick, label }: { href?: string; children: ComponentChildren; primary?: boolean; external?: boolean; onClick?: () => void; label?: string }) {
  const cls = `btn${primary ? ' primary' : ''}`
  if (href) {
    return <a class={cls} href={href} aria-label={label} {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}>{children}</a>
  }
  return <button type="button" class={cls} aria-label={label} onClick={onClick}>{children}</button>
}

/** A segmented control: one of a few views of the same list. */
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

const CELL: Record<string, string> = { u: '', d: 'd', x: 'x', '?': 'q', o: 'o' }

/** A day line drawn as `n` cells (the worst state in each). `past` turns a
 *  down cell that is over into a quieter red, so only what is down now is loud. */
export function Day({ day, n, size, label, onCell }: { day: string; n: number; size?: 'mid' | 'tall'; label: string; onCell?: (i: number | null, e?: MouseEvent) => void }) {
  const cells = bucket(day, n)
  const last = cells.length - 1
  return (
    <span class={`day${size ? ' ' + size : ''}`} role="img" aria-label={label}
      onMouseMove={onCell && ((e) => { const i = (e.target as HTMLElement).dataset?.i; onCell(i == null ? null : Number(i), e as unknown as MouseEvent) })}
      onMouseLeave={onCell && (() => onCell(null))}>
      {cells.split('').map((c, i) => <i key={i} data-i={i} class={c === 'x' && i < last ? 'w' : CELL[c] ?? 'q'} />)}
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

/** A line over values with a faint area under it and a dot at the newest
 *  value; negative values are gaps (a failed probe). */
export function Spark({ values, w = 120, h = 28, level, grid, fluid }: { values: number[]; w?: number; h?: number; level?: Level; grid?: boolean; fluid?: boolean }) {
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
  return (
    <svg class={`spark${level && level !== 'ok' ? ' ' + level : ''}`} width={fluid ? '100%' : w} height={h} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-hidden="true">
      {grid && <g class="grid">{[0.25, 0.5, 0.75].map((f) => <line key={f} x1="0" x2={w} y1={(h * f).toFixed(1)} y2={(h * f).toFixed(1)} />)}</g>}
      <path class="area" d={area} />
      <path class="line" d={line} />
      {endV >= 0 && !fluid && <circle class="end" cx={(lastI * step).toFixed(1)} cy={y(endV).toFixed(1)} r={1.8} />}
    </svg>
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
          : <i key={i} class={cls} aria-label={it.label} />
      })}
    </span>
  )
}

/** A quiet tooltip that follows the pointer. */
export function useTip(): [ComponentChildren, (html: ComponentChildren | null, e?: MouseEvent) => void] {
  const [tip, setTip] = useState<{ body: ComponentChildren; x: number; y: number } | null>(null)
  const node = tip ? <div class="tip" style={{ left: `${Math.min(tip.x + 12, innerWidth - 280)}px`, top: `${tip.y - 44}px` }}>{tip.body}</div> : null
  return [node, (body, e) => setTip(body && e ? { body, x: e.clientX, y: e.clientY } : null)]
}
