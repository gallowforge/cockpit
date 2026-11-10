import { useEffect, useMemo, useRef, useState } from 'preact/hooks'
import type { Snapshot } from '../types'
import { prioLevel } from '../derive'
import { Glyph } from './ui'
import { IconExternal, IconSearch } from './icons'
import { safeHref } from '../markdown'

export interface PaletteItem {
  id: string
  group: string
  title: string
  sub?: string
  href: string
  external?: boolean
  level?: Parameters<typeof Glyph>[0]['level']
  keys?: string
}

export const PAGES: { id: string; title: string; key: string }[] = [
  { id: '', title: 'Overview', key: 'O' },
  { id: 'services', title: 'Services', key: 'S' },
  { id: 'backups', title: 'Backups', key: 'B' },
  { id: 'history', title: 'History', key: 'H' },
  { id: 'jobs', title: 'Jobs', key: 'J' },
  { id: 'system', title: 'System', key: 'Y' },
  { id: 'runbooks', title: 'Checklists', key: 'C' },
]

/** Everything Vesper knows about, as places to jump to. */
export function paletteItems(s: Snapshot): PaletteItem[] {
  const out: PaletteItem[] = PAGES.map((p) => ({ id: 'page:' + p.id, group: 'Go to', title: p.title, href: `#/${p.id}`, keys: `G ${p.key}` }))
  for (const sv of s.services) {
    out.push({ id: 'svc:' + sv.id, group: 'Services', title: sv.title, sub: sv.detail || sv.note, href: `#/services/${encodeURIComponent(sv.id)}`, level: sv.level })
    const app = sv.url ? safeHref(sv.url) : null
    if (app) out.push({ id: 'app:' + sv.id, group: 'Open an app', title: `Open ${sv.title}`, sub: app.replace(/^https?:\/\//, ''), href: app, external: true })
  }
  for (const r of s.runbooks) {
    if (r.local) out.push({ id: 'rb:' + r.id, group: 'Checklists', title: r.title, href: `#/runbooks/${encodeURIComponent(r.id)}`, external: false })
    else {
      const url = safeHref(r.url ?? '')
      if (url) out.push({ id: 'rb:' + r.id, group: 'Checklists', title: r.title, href: url, external: true })
    }
  }
  for (const b of s.backups.sets) {
    out.push({ id: 'bk:' + b.name, group: 'Backup sets', title: b.name, sub: b.detail, href: `#/backups/${encodeURIComponent(b.name)}`, level: b.level })
  }
  for (const i of s.alerts.incidents.filter((x) => x.state !== 'info').slice(0, 20)) {
    out.push({ id: 'al:' + i.key + i.opened, group: 'Alerts', title: i.title, sub: i.state === 'open' ? 'open now' : i.state, href: `#/history/alert/${encodeURIComponent(i.key)}`, level: i.state === 'open' ? prioLevel(i.prio) : 'off' })
  }
  for (const t of s.timers) {
    out.push({ id: 'tm:' + t.unit, group: 'Jobs', title: t.description || t.activates.replace(/\.service$/, ''), sub: t.unit, href: '#/jobs', level: t.result === 'failed' ? 'warn' : undefined })
  }
  return out
}

/** Every query word must appear; matches at the start of the title or a word rank first. */
export function search(items: PaletteItem[], q: string): PaletteItem[] {
  const words = q.toLowerCase().trim().split(/\s+/).filter(Boolean)
  if (!words.length) return items.filter((i) => i.group === 'Go to' || i.level === 'warn' || i.level === 'crit')
  const scored: { i: PaletteItem; score: number }[] = []
  for (const i of items) {
    const title = i.title.toLowerCase()
    const hay = `${title} ${(i.sub ?? '').toLowerCase()} ${i.group.toLowerCase()}`
    if (!words.every((w) => hay.includes(w))) continue
    let score = 0
    for (const w of words) {
      if (title.startsWith(w)) score += 6
      else if (title.includes(' ' + w) || title.includes('-' + w)) score += 4
      else if (title.includes(w)) score += 2
    }
    score -= title.length / 60
    if (i.group === 'Go to') score += 1
    scored.push({ i, score })
  }
  // best matches first, but each group stays together under one heading
  scored.sort((a, b) => b.score - a.score)
  const groups = new Map<string, PaletteItem[]>()
  for (const x of scored.slice(0, 40)) {
    if (!groups.has(x.i.group)) groups.set(x.i.group, [])
    groups.get(x.i.group)!.push(x.i)
  }
  return [...groups.values()].flat()
}

export function Palette({ snap, onClose, initial = '' }: { snap: Snapshot; onClose: () => void; initial?: string }) {
  const [q, setQ] = useState(initial)
  const [active, setActive] = useState(0)
  const input = useRef<HTMLInputElement>(null)
  const list = useRef<HTMLDivElement>(null)
  const items = useMemo(() => paletteItems(snap), [snap])
  const results = useMemo(() => search(items, q), [items, q])

  useEffect(() => input.current?.focus(), [])
  useEffect(() => setActive(0), [q])
  // a new snapshot can shorten the list under the cursor
  useEffect(() => setActive((a) => Math.min(a, Math.max(0, results.length - 1))), [results.length])
  useEffect(() => {
    list.current?.querySelector<HTMLElement>(`[data-i="${active}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [active])

  const open = (it?: PaletteItem) => {
    if (!it) return
    if (it.external) window.open(it.href, '_blank', 'noopener,noreferrer')
    else location.hash = it.href.replace(/^#/, '')
    onClose()
  }
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((a) => Math.min(results.length - 1, a + 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((a) => Math.max(0, a - 1))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      open(results[active])
    } else if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
    }
  }

  let lastGroup = ''
  return (
    <div class="backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div class="palette" role="dialog" aria-label="Jump to anything">
        <div class="palette-input">
          <IconSearch size={16} />
          <input ref={input} value={q} onInput={(e) => setQ((e.target as HTMLInputElement).value)} onKeyDown={onKey}
            placeholder="Jump to a service, backup, alert, timer or checklist" aria-label="Search" spellcheck={false} autocomplete="off" />
          <kbd>esc</kbd>
        </div>
        <div class="palette-list" ref={list} role="listbox">
          {results.length === 0 && <div class="palette-empty">Nothing matches "{q}".</div>}
          {results.map((it, n) => {
            const head = it.group !== lastGroup ? <div class="palette-group" key={'g' + it.group}>{it.group}</div> : null
            lastGroup = it.group
            return (
              <>
                {head}
                <button type="button" key={it.id} data-i={n} role="option" aria-selected={n === active}
                  class={`palette-item${n === active ? ' on' : ''}`} onMouseMove={() => setActive(n)} onClick={() => open(it)}>
                  {it.level && it.level !== 'ok' ? <Glyph level={it.level} size={13} /> : <span class="palette-bullet" />}
                  <span class="palette-title">{it.title}</span>
                  {it.sub && <span class="palette-sub">{it.sub}</span>}
                  {it.external && <IconExternal size={13} />}
                  {it.keys && <span class="palette-keys">{it.keys.split(' ').map((k) => <kbd key={k}>{k}</kbd>)}</span>}
                </button>
              </>
            )
          })}
        </div>
        <div class="palette-foot"><span><kbd>↑</kbd><kbd>↓</kbd> move</span><span><kbd>↵</kbd> open</span><span><kbd>G</kbd> then a letter jumps to a page</span></div>
      </div>
    </div>
  )
}
