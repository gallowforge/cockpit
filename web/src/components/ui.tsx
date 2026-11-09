// Small building blocks shared by every page. Backlit rules: healthy things
// carry no colour; a status always has a shape and a word, never colour alone.
import type { ComponentChildren } from 'preact'
import type { Level } from '../types'

const WORD: Record<Level, string> = { ok: 'Fine', info: 'Note', warn: 'Needs you', crit: 'Down', unknown: "Can't see", off: 'Off' }

/** The status shape: a disc with a bar when down, a ring with a mark when it
 *  needs you, a dashed ring when Cockpit can't see, a hollow ring when off. */
export function Glyph({ level, size = 14, title }: { level: Level; size?: number; title?: string }) {
  const c = size / 2
  const r = c - 1.5
  const label = title ?? WORD[level]
  return (
    <svg class={`glyph g-${level}`} width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={label}>
      {level === 'crit' && (<><circle cx={c} cy={c} r={r} class="fill" /><rect x={c - r * 0.5} y={c - 0.9} width={r} height={1.8} rx={0.9} class="cut" /></>)}
      {level === 'warn' && (<><circle cx={c} cy={c} r={r - 0.4} class="ring" /><rect x={c - 0.8} y={c - r * 0.48} width={1.6} height={r * 0.6} rx={0.8} class="mark" /><circle cx={c} cy={c + r * 0.42} r={0.95} class="mark" /></>)}
      {level === 'unknown' && <circle cx={c} cy={c} r={r - 0.4} class="ring dashed" />}
      {level === 'off' && <circle cx={c} cy={c} r={r - 0.6} class="ring faint" />}
      {level === 'info' && <circle cx={c} cy={c} r={r * 0.42} class="fill" />}
      {level === 'ok' && <path d={`M${c - r * 0.55} ${c + 0.2} l${r * 0.38} ${r * 0.38} l${r * 0.72} ${-r * 0.8}`} class="check" />}
    </svg>
  )
}

/** A status word, shown only when the thing is not fine. */
export function StateWord({ level, children }: { level: Level; children?: ComponentChildren }) {
  if (level === 'ok' && !children) return null
  return <span class={`state s-${level}`}><Glyph level={level} size={12} />{children ?? WORD[level]}</span>
}

export function PageHead({ title, sub, aside }: { title: string; sub?: ComponentChildren; aside?: ComponentChildren }) {
  return (
    <header class="page-head">
      <div>
        <h1>{title}</h1>
        {sub && <p class="page-sub">{sub}</p>}
      </div>
      {aside && <div class="page-aside">{aside}</div>}
    </header>
  )
}

export function Section({ title, aside, children, id, class: cls }: { title?: string; aside?: ComponentChildren; children: ComponentChildren; id?: string; class?: string }) {
  return (
    <section class={`section${cls ? ' ' + cls : ''}`} id={id}>
      {(title || aside) && (
        <div class="section-head">
          {title && <h2>{title}</h2>}
          {aside && <div class="section-aside">{aside}</div>}
        </div>
      )}
      {children}
    </section>
  )
}

export function Figure({ value, unit, caption, level }: { value: ComponentChildren; unit?: string; caption?: ComponentChildren; level?: Level }) {
  return (
    <div class={`figure${level && level !== 'ok' ? ' f-' + level : ''}`}>
      <div class="figure-v">{value}{unit && <span class="figure-u">{unit}</span>}</div>
      {caption && <div class="figure-c">{caption}</div>}
    </div>
  )
}

export function Btn({ href, children, primary, external, onClick }: { href?: string; children: ComponentChildren; primary?: boolean; external?: boolean; onClick?: () => void }) {
  const cls = `btn${primary ? ' btn-primary' : ''}`
  if (href) {
    return (
      <a class={cls} href={href} {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}>
        {children}
      </a>
    )
  }
  return <button type="button" class={cls} onClick={onClick}>{children}</button>
}

export function Empty({ children }: { children: ComponentChildren }) {
  return <div class="empty">{children}</div>
}

/** One cell per sample: healthy cells are faint neutral ticks, so a good
 *  stretch is calm and an outage is a short bright bar where it happened. */
export function Strip({ beats, label }: { beats: string; label?: string }) {
  const cells = beats.split('')
  const up = cells.filter((c) => c === 'u').length
  const counted = cells.filter((c) => c !== 'o' && c !== '?').length
  const sr = label ?? `${counted ? Math.round((up / counted) * 1000) / 10 : 0}% up over ${cells.length} checks`
  return (
    <span class="strip" role="img" aria-label={sr}>
      {cells.map((c, i) => <i key={i} class={`c-${c === 'u' ? 'u' : c === 'd' ? 'd' : c === 'x' ? 'x' : c === '?' ? 'q' : 'o'}`} />)}
    </span>
  )
}

/** Worst state per sample across many beat strings (for the Services tile). */
export function mergeBeats(list: string[]): string {
  const n = Math.max(0, ...list.map((b) => b.length))
  const rank: Record<string, number> = { o: 0, u: 1, '?': 2, d: 3, x: 4 }
  let out = ''
  for (let i = 0; i < n; i++) {
    let w = 'o'
    for (const b of list) {
      const c = b[b.length - n + i] ?? 'o'
      if ((rank[c] ?? 0) > (rank[w] ?? 0)) w = c
    }
    out += w
  }
  return out
}

/** A line over values; negative values are gaps (a failed probe). */
export function Spark({ values, w = 120, h = 28, level }: { values: number[]; w?: number; h?: number; level?: Level }) {
  const ok = values.filter((v) => v >= 0)
  if (ok.length < 2) return <svg class="spark" width={w} height={h} aria-hidden="true" />
  const max = Math.max(...ok) || 1
  const min = Math.min(...ok)
  const span = max - min || max || 1
  const step = w / Math.max(1, values.length - 1)
  let d = ''
  let pen = false
  values.forEach((v, i) => {
    if (v < 0) {
      pen = false
      return
    }
    const x = i * step
    const y = h - 2 - ((v - min) / span) * (h - 4)
    d += `${pen ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`
    pen = true
  })
  return (
    <svg class={`spark${level && level !== 'ok' ? ' sp-' + level : ''}`} width={w} height={h} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-hidden="true">
      <path d={d} />
    </svg>
  )
}

/** Run dots (nightly backups, weekly drills): tap one to see what it was. */
export function Dots({ items, selected, onPick }: { items: { level: Level; label: string }[]; selected?: number; onPick?: (i: number) => void }) {
  return (
    <span class="dots" role={onPick ? 'group' : 'list'}>
      {items.map((it, i) =>
        onPick ? (
          <button type="button" key={i} class={`dot d-${it.level}${selected === i ? ' on' : ''}`} aria-label={it.label} aria-pressed={selected === i} onClick={() => onPick(i)} />
        ) : (
          <i key={i} role="listitem" class={`dot d-${it.level}`} aria-label={it.label} />
        ),
      )}
    </span>
  )
}

/** How full something is against its own limit (a backup's age against max age). */
export function Meter({ pct, level }: { pct: number; level: Level }) {
  return (
    <span class={`meter m-${level}`} role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)}>
      <i style={{ width: `${Math.max(2, Math.min(100, pct))}%` }} />
    </span>
  )
}

/** Day bars (alerts per day), oldest first. */
export function Bars({ bins, h = 32, mono }: { bins: { crit: number; warn: number; info: number; t: number }[]; h?: number; mono?: boolean }) {
  const max = Math.max(1, ...bins.map((b) => b.crit + b.warn + b.info))
  return (
    <span class={`bars${mono ? ' mono' : ''}`} style={{ height: `${h}px` }} aria-hidden="true">
      {bins.map((b) => {
        const tot = b.crit + b.warn + b.info
        const lv = b.crit ? 'crit' : b.warn ? 'warn' : tot ? 'info' : 'none'
        return <i key={b.t} class={`b-${lv}`} style={{ height: `${tot ? Math.max(12, (tot / max) * 100) : 6}%` }} />
      })}
    </span>
  )
}
