import { useEffect, useMemo, useState } from 'preact/hooks'
import type { ViewProps } from '../app'
import { getRunbook } from '../api'
import { outline, renderMarkdown } from '../markdown'
import { PageHead } from '../components/ui'
import { IconExternal, IconRunbooks } from '../components/icons'

export function RunbooksView({ snap, route }: ViewProps) {
  const list = snap.runbooks
  const id = route[1] ?? list.find((r) => r.local)?.id
  const current = list.find((r) => r.id === id)
  const [text, setText] = useState<string>('')
  const [err, setErr] = useState('')

  useEffect(() => {
    setText('')
    setErr('')
    if (!current?.local) return
    getRunbook(current.id).then(setText).catch((e) => setErr(String(e.message || e)))
  }, [current?.id, current?.bytes])

  const html = useMemo(() => (text ? renderMarkdown(text) : ''), [text])
  const toc = useMemo(() => (text ? outline(text) : []), [text])

  return (
    <div>
      <PageHead title="Runbooks" sub="What to do when something on this page goes wrong. Alerts and services link straight to the right one." />
      {list.length === 0 ? (
        <div class="empty">No runbooks configured. Add [runbook:name] blocks to cockpit.conf.</div>
      ) : (
        <div class="rb-layout">
          <nav class="rb-nav">
            {list.map((r) =>
              r.local ? (
                <a key={r.id} href={`#/runbooks/${encodeURIComponent(r.id)}`} class={r.id === id ? 'on' : ''}>
                  <IconRunbooks size={15} /> {r.title}
                </a>
              ) : (
                <a key={r.id} href={r.url} target="_blank" rel="noopener noreferrer">
                  <IconExternal size={15} /> {r.title}
                </a>
              ),
            )}
          </nav>
          <article class="rb-doc">
            {err && <p class="lv-text-warn">{err}</p>}
            {!err && current?.local && !text && <p class="muted">Loading…</p>}
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
            <div class="md" dangerouslySetInnerHTML={{ __html: html }} />
            {current?.match && current.match.length > 0 && (
              <p class="rb-match">Linked from: {current.match.map((m) => <code key={m}>{m}</code>)}</p>
            )}
          </article>
        </div>
      )}
    </div>
  )
}
