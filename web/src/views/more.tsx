// More: on a phone, the pages that do not fit in the tab bar.
import type { Level, Snapshot } from '../types'
import { Glyph, PageHead, ThemeSwitch } from '../components/ui'
import { IconChecklist, IconChevron, IconJobs, IconSearch, IconSystem } from '../components/icons'
import { plural } from '../format'

export function More({ snap, levels, onSearch }: { snap: Snapshot; levels: Record<string, { level: Level; count?: string }>; onSearch: () => void }) {
  const rows = [
    { href: '#/system', icon: IconSystem, title: 'System', sub: 'Host health, checks, config drift and what Vesper can see', level: levels.system.level },
    { href: '#/jobs', icon: IconJobs, title: 'Jobs', sub: `${plural(snap.timers.filter((t) => t.highlight).length, 'homelab job')} and when they run next`, level: levels.jobs.level },
    { href: '#/runbooks', icon: IconChecklist, title: 'Checklists', sub: snap.runbooks.length ? `${plural(snap.runbooks.length, 'checklist')} to follow step by step` : 'None configured', level: levels.runbooks.level },
  ]
  return (
    <div>
      <PageHead title="More" />
      <div class="rows">
        {rows.map((r) => {
          const Icon = r.icon
          const bad = r.level === 'crit' || r.level === 'warn' || r.level === 'unknown'
          return (
            <a key={r.href} class="row" href={r.href} style={{ gridTemplateColumns: '20px minmax(0,1fr) auto' }}>
              <Icon size={18} />
              <span class="main-col"><span class="ttl"><span>{r.title}</span>{bad && <Glyph level={r.level} size={13} />}</span><span class="sub wrap">{r.sub}</span></span>
              <IconChevron size={14} />
            </a>
          )
        })}
        <button type="button" class="row" onClick={onSearch} style={{ gridTemplateColumns: '20px minmax(0,1fr) auto' }}>
          <IconSearch size={18} />
          <span class="main-col"><span class="ttl"><span>Search</span></span><span class="sub wrap">Jump to any service, backup set, alert, job or checklist</span></span>
          <IconChevron size={14} />
        </button>
      </div>
      <section class="sec" aria-label="Appearance">
        <div class="sec-h"><h2>Appearance</h2><span class="aside">Follows this device until you choose</span></div>
        <ThemeSwitch />
      </section>
      {snap.runbooks.some((r) => r.local) && (
        <section class="sec" aria-label="Checklists">
          <div class="sec-h"><h2>Checklists</h2></div>
          <div class="rows">
            {snap.runbooks.filter((r) => r.local).map((r) => (
              <a key={r.id} class="row" href={`#/runbooks/${encodeURIComponent(r.id)}`} style={{ gridTemplateColumns: 'minmax(0,1fr) auto' }}>
                <span class="main-col"><span class="ttl"><span>{r.title}</span></span></span>
                <IconChevron size={14} />
              </a>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
