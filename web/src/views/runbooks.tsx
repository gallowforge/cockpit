import { useEffect, useMemo, useRef, useState } from 'preact/hooks'
import type { ViewProps } from '../app'
import { getRunbook } from '../api'
import { outline, renderMarkdown, safeHref } from '../markdown'
import { PageHead } from '../components/ui'
import { IconChecklist, IconExternal } from '../components/icons'

// Ticks are kept on this device for 12 hours: long enough for an incident,
// short enough that tomorrow's run starts clean.
const KEEP_MS = 12 * 3600 * 1000

/** A short fingerprint of the runbook's text: ticks saved against an older
 *  version of the file are dropped instead of landing on the wrong steps. */
export function textSig(text: string): string {
  let h = 5381
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) | 0
  return (h >>> 0).toString(36)
}

function loadTicks(id: string, sig: string): Set<number> {
  // screenshots only: ?shot&tick=0,1 pre-ticks steps
  const q = new URLSearchParams(location.search)
  if (q.has('shot') && q.has('tick')) return new Set(q.get('tick')!.split(',').filter(Boolean).map(Number))
  try {
    const raw = localStorage.getItem(`cockpit-checklist:${id}`)
    if (!raw) return new Set()
    const v = JSON.parse(raw) as { at: number; sig?: string; done: number[] }
    if (Date.now() - v.at > KEEP_MS || v.sig !== sig || !Array.isArray(v.done)) return new Set()
    return new Set(v.done.filter((n) => Number.isInteger(n) && n >= 0))
  } catch {
    return new Set()
  }
}

function saveTicks(id: string, sig: string, done: Set<number>) {
  try {
    if (done.size === 0) localStorage.removeItem(`cockpit-checklist:${id}`)
    else localStorage.setItem(`cockpit-checklist:${id}`, JSON.stringify({ at: Date.now(), sig, done: [...done] }))
  } catch {
    /* private mode: ticks just do not persist */
  }
}

export function RunbooksView({ snap, route }: ViewProps) {
  const list = snap.runbooks
  const id = route[1] ?? list.find((r) => r.local)?.id
  const current = list.find((r) => r.id === id)
  const [text, setText] = useState<string>('')
  const [err, setErr] = useState('')
  const [done, setDone] = useState<Set<number>>(new Set())
  const [steps, setSteps] = useState(0)
  const doc = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setText('')
    setErr('')
    setDone(new Set())
    if (!current?.local) return
    let stale = false // a slow answer for the previous runbook must not land on this one
    const rid = current.id
    getRunbook(rid)
      .then((t) => {
        if (stale) return
        setText(t)
        setDone(loadTicks(rid, textSig(t)))
      })
      .catch((e) => !stale && setErr(String(e.message || e)))
    return () => {
      stale = true
    }
  }, [current?.id, current?.bytes])

  const sig = useMemo(() => textSig(text), [text])
  const html = useMemo(() => (text ? renderMarkdown(text) : ''), [text])
  const toc = useMemo(() => (text ? outline(text) : []), [text])

  // every numbered step becomes a line on the checklist. The tick box is a real
  // checkbox button over the step number, so links inside a step stay links for
  // screen readers; a tap anywhere else on the step ticks it too.
  useEffect(() => {
    const items = doc.current ? Array.from(doc.current.querySelectorAll<HTMLLIElement>(':scope > ol > li')) : []
    items.forEach((li, i) => {
      li.dataset.step = String(i)
      li.classList.add('step')
      li.classList.toggle('done', done.has(i))
      let box = li.querySelector<HTMLButtonElement>(':scope > button.tick')
      if (!box) {
        box = document.createElement('button')
        box.type = 'button'
        box.className = 'tick'
        box.setAttribute('role', 'checkbox')
        box.setAttribute('aria-label', `Step ${i + 1} done`)
        li.prepend(box)
      }
      box.setAttribute('aria-checked', String(done.has(i)))
    })
    setSteps(items.length)
  }, [html, done])

  const toggle = (e: Event) => {
    const li = (e.target as HTMLElement).closest<HTMLLIElement>('li.step')
    if (!li || (e.target as HTMLElement).closest('a, code')) return
    const i = Number(li.dataset.step)
    const next = new Set(done)
    if (next.has(i)) next.delete(i)
    else next.add(i)
    setDone(next)
    if (current) saveTicks(current.id, sig, next)
  }
  const reset = () => {
    setDone(new Set())
    if (current) saveTicks(current.id, sig, new Set())
  }
  const ticked = [...done].filter((i) => i < steps).length

  return (
    <div>
      <PageHead title={current?.title ?? 'Checklists'} sub="Tap each step as you do it. Ticks stay on this device for 12 hours." />
      {list.length === 0 ? (
        <div class="empty">No checklists configured. Add [runbook:name] blocks to cockpit.conf.</div>
      ) : (
        <div class="rb-layout">
          <nav class="rb-nav">
            {list.map((r) =>
              r.local ? (
                <a key={r.id} href={`#/runbooks/${encodeURIComponent(r.id)}`} class={r.id === id ? 'on' : ''}>
                  <IconChecklist size={16} /> {r.title}
                </a>
              ) : (
                <a key={r.id} href={safeHref(r.url ?? '') ?? undefined} target="_blank" rel="noopener noreferrer">
                  <IconExternal size={16} /> {r.title}
                </a>
              ),
            )}
          </nav>
          <article class="rb-doc">
            {err && <p class="lv-text-warn">{err}</p>}
            {!err && current?.local && !text && <p class="muted">Loading…</p>}
            {steps > 0 && (
              <div class="rb-progress">
                <span class={`rb-count${ticked === steps ? ' all' : ''}`}>
                  {ticked === steps ? 'Checklist complete' : `${ticked} of ${steps} steps done`}
                </span>
                <span class="rb-bar"><i style={{ width: `${(ticked / steps) * 100}%` }} /></span>
                {ticked > 0 && <button type="button" class="linklike" onClick={reset}>Reset</button>}
              </div>
            )}
            {toc.length > 1 && (
              <div class="rb-toc">
                <span class="rb-toc-label">On this page</span>
                {toc.map((t) => (
                  <a key={t.id} href={`#/runbooks/${encodeURIComponent(current!.id)}`} onClick={(e) => {
                    e.preventDefault()
                    document.getElementById(t.id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
                  }}>{t.text}</a>
                ))}
              </div>
            )}
            <div class="md" ref={doc} onClick={toggle} dangerouslySetInnerHTML={{ __html: html }} />
            {current?.match && current.match.length > 0 && (
              <p class="rb-match">Opened from: {current.match.map((m) => <code key={m}>{m}</code>)}</p>
            )}
          </article>
        </div>
      )}
    </div>
  )
}
