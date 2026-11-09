import type { ComponentChildren } from 'preact'
import { useMemo } from 'preact/hooks'
import type { Level, Run } from '../types'
import { IconArrow, IconBook } from './icons'

export const levelWord: Record<Level, string> = {
  ok: 'OK', info: 'Info', warn: 'Attention', crit: 'Problem', unknown: 'Unknown', off: 'Off',
}

export function Dot({ level, pulse, size = 8 }: { level: Level; pulse?: boolean; size?: number }) {
  return <span class={`dot lv-${level}${pulse ? ' pulse' : ''}`} style={{ width: `${size}px`, height: `${size}px` }} />
}

export function Pill({ level, children }: { level: Level; children: ComponentChildren }) {
  return <span class={`pill lv-${level}`}>{children}</span>
}

export function Card(props: {
  title?: ComponentChildren
  icon?: ComponentChildren
  href?: string
  action?: ComponentChildren
  class?: string
  children: ComponentChildren
}) {
  return (
    <section class={`card ${props.class ?? ''}`}>
      {(props.title || props.action) && (
        <header class="card-head">
          <h2>
            {props.icon && <span class="card-icon">{props.icon}</span>}
            {props.title}
          </h2>
          {props.action}
          {props.href && (
            <a class="card-more" href={props.href} aria-label="Open">
              <IconArrow size={16} />
            </a>
          )}
        </header>
      )}
      {props.children}
    </section>
  )
}

export function Stat(props: { label: string; value: ComponentChildren; sub?: ComponentChildren; level?: Level }) {
  return (
    <div class="stat">
      <div class="stat-label">{props.label}</div>
      <div class={`stat-value ${props.level ? 'lv-text-' + props.level : ''}`}>{props.value}</div>
      {props.sub && <div class="stat-sub">{props.sub}</div>}
    </div>
  )
}

const beatClass: Record<string, string> = { u: 'b-up', d: 'b-deg', x: 'b-down', o: 'b-off', '?': 'b-unk' }

/** Kuma-style heartbeat bars: one bar per sample, newest on the right. */
export function Beats({ beats, n = 45, height = 22 }: { beats: string; n?: number; height?: number }) {
  const s = beats.slice(-n).padStart(n, ' ')
  const w = 4
  const gap = 2
  return (
    <svg class="beats" viewBox={`0 0 ${n * (w + gap) - gap} ${height}`} preserveAspectRatio="none" height={height} aria-hidden="true">
      {Array.from(s).map((ch, i) => (
        <rect
          key={i}
          x={i * (w + gap)}
          y={0}
          width={w}
          height={height}
          rx={1.5}
          class={ch === ' ' ? 'b-empty' : beatClass[ch] ?? 'b-unk'}
        />
      ))}
    </svg>
  )
}

/** A latency sparkline; negative values are failed probes and show as gaps with a red tick. */
export function Sparkline({ values, height = 28, width = 120, cls = '' }: { values: number[]; height?: number; width?: number; cls?: string }) {
  const { path, area, fails } = useMemo(() => {
    const ok = values.filter((v) => v >= 0)
    if (ok.length < 2) return { path: '', area: '', fails: [] as number[] }
    const sorted = ok.slice().sort((a, b) => a - b)
    const hi = Math.max(sorted[Math.floor(sorted.length * 0.95)] * 1.15, 1)
    const step = width / Math.max(values.length - 1, 1)
    let d = ''
    let a = ''
    let pen = false
    const f: number[] = []
    values.forEach((v, i) => {
      const x = i * step
      if (v < 0) {
        f.push(x)
        pen = false
        return
      }
      const y = height - 2 - (Math.min(v, hi) / hi) * (height - 4)
      d += `${pen ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)} `
      pen = true
    })
    const firstX = 0
    a = `${d} L${width} ${height} L${firstX} ${height} Z`
    return { path: d, area: a, fails: f }
  }, [values, height, width])
  if (!path) return <svg class="spark" width={width} height={height} />
  return (
    <svg class={`spark ${cls}`} viewBox={`0 0 ${width} ${height}`} width="100%" height={height} preserveAspectRatio="none" aria-hidden="true">
      <path d={area} class="spark-area" />
      <path d={path} class="spark-line" vector-effect="non-scaling-stroke" />
      {fails.map((x) => (
        <rect key={x} x={x - 1} y={0} width={2} height={height} class="spark-fail" />
      ))}
    </svg>
  )
}

/** A ring gauge, 0..100. */
export function Ring(props: { value: number; level?: Level; size?: number; stroke?: number; children?: ComponentChildren; label?: string }) {
  const size = props.size ?? 76
  const sw = props.stroke ?? 7
  const r = (size - sw) / 2
  const c = 2 * Math.PI * r
  const arc = 0.75 // a 270° instrument dial
  const v = Math.max(0, Math.min(100, props.value))
  return (
    <div class="ring" style={{ width: `${size}px`, height: `${size}px` }} aria-label={props.label}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle
          cx={size / 2} cy={size / 2} r={r} class="ring-track" stroke-width={sw}
          stroke-dasharray={`${c * arc} ${c}`} transform={`rotate(135 ${size / 2} ${size / 2})`}
        />
        <circle
          cx={size / 2} cy={size / 2} r={r} class={`ring-value lv-stroke-${props.level ?? 'ok'}`} stroke-width={sw}
          stroke-dasharray={`${(c * arc * v) / 100} ${c}`} transform={`rotate(135 ${size / 2} ${size / 2})`}
        />
      </svg>
      <div class="ring-center">{props.children}</div>
    </div>
  )
}

/** One square per run, oldest left. */
export function RunStrip({ runs, n = 30, onPick }: { runs: Run[]; n?: number; onPick?: (r: Run) => void }) {
  const list = runs.slice(0, n).reverse()
  return (
    <div class="runstrip">
      {Array.from({ length: Math.max(0, n - list.length) }, (_, i) => <span key={'e' + i} class="run run-empty" />)}
      {list.map((r) => (
        <button
          key={r.start}
          type="button"
          class={`run run-${r.result}`}
          title={`${new Date(r.start).toLocaleString()} · ${r.result}${r.summary ? ' · ' + r.summary : ''}`}
          onClick={() => onPick?.(r)}
        />
      ))}
    </div>
  )
}

/** Thin horizontal meter. */
export function Meter({ value, level = 'ok' }: { value: number; level?: Level }) {
  return (
    <div class="meter">
      <div class={`meter-fill lv-bg-${level}`} style={{ width: `${Math.max(2, Math.min(100, value))}%` }} />
    </div>
  )
}

export function RunbookLink({ id, title }: { id?: string; title?: string }) {
  if (!id) return null
  return (
    <a class="rb-link" href={`#/runbooks/${encodeURIComponent(id)}`}>
      <IconBook size={14} />
      {title ?? 'Checklist'}
    </a>
  )
}

export function Empty({ children }: { children: ComponentChildren }) {
  return <div class="empty">{children}</div>
}

export function PageHead(props: { title: string; sub?: ComponentChildren; right?: ComponentChildren }) {
  return (
    <div class="page-head">
      <div>
        <h1>{props.title}</h1>
        {props.sub && <p class="page-sub">{props.sub}</p>}
      </div>
      {props.right}
    </div>
  )
}

// ---- glass-cockpit instruments ---------------------------------------------

const DEG = Math.PI / 180
const SWEEP = 240

function polar(c: number, r: number, v: number) {
  const a = (150 + (SWEEP * Math.max(0, Math.min(100, v))) / 100) * DEG
  return [c + r * Math.cos(a), c + r * Math.sin(a)]
}

function arc(c: number, r: number, v1: number, v2: number) {
  const [x1, y1] = polar(c, r, v1)
  const [x2, y2] = polar(c, r, Math.max(v1 + 0.01, v2))
  const large = ((v2 - v1) * SWEEP) / 100 > 180 ? 1 : 0
  return `M${x1.toFixed(2)} ${y1.toFixed(2)} A${r} ${r} 0 ${large} 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`
}

/** A head-up-display gauge: a thin arc, the value, a caution zone. value is 0..100.
 * The arc and its dot glide to a new value instead of jumping. */
export function Gauge(props: { value: number; readout: string; unit?: string; label: string; caution?: number; level?: Level }) {
  const s = 96
  const c = s / 2
  const r = 40
  const v = Math.max(0, Math.min(100, props.value))
  const circ = 2 * Math.PI * r
  const sweep = (circ * SWEEP) / 360
  const rot = `rotate(150 ${c} ${c})`
  return (
    <div class={`gauge lv-${props.level ?? 'ok'}`} role="img" aria-label={`${props.label} ${props.readout}${props.unit ?? ''}`}>
      <svg width={s} height={s} viewBox={`0 0 ${s} ${s}`}>
        <circle cx={c} cy={c} r={r} class="g-track" stroke-dasharray={`${sweep} ${circ}`} transform={rot} />
        {props.caution !== undefined && <path d={arc(c, r, props.caution, 100)} class="g-zone" />}
        <circle cx={c} cy={c} r={r} class="g-value" stroke-dasharray={`${(sweep * v) / 100} ${circ}`} transform={rot} />
        <g class="g-needle" style={{ transform: `rotate(${150 + (SWEEP * v) / 100}deg)`, transformOrigin: `${c}px ${c}px` }}>
          <circle cx={c + r} cy={c} r={3.2} class="g-dot" />
        </g>
      </svg>
      <div class="g-read"><b key={props.readout} class="flash">{props.readout}</b>{props.unit && <small>{props.unit}</small>}</div>
      <div class="g-label">{props.label}</div>
    </div>
  )
}

/** One cell of the status strip: quiet when normal, lit when it needs you. */
export function Lamp(props: { legend: string; value: string; level: Level; href?: string; test?: boolean }) {
  const lit = props.test ? 'test' : props.level === 'crit' ? 'warning' : props.level === 'warn' ? 'caution' : props.level === 'unknown' ? 'unknown' : 'dark'
  const body = (
    <>
      <span class="lamp-legend"><i class="lamp-led" />{props.legend}</span>
      <span class="lamp-value flash" key={props.value}>{props.value}</span>
    </>
  )
  return props.href ? (
    <a class={`lamp ${lit}`} href={props.href} aria-label={`${props.legend}: ${props.value}`}>{body}</a>
  ) : (
    <span class={`lamp ${lit}`}>{body}</span>
  )
}
