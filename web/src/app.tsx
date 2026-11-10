import { Component, type ComponentChildren } from 'preact'
import { useEffect, useMemo, useRef, useState } from 'preact/hooks'
import type { Level, Session, Snapshot } from './types'
import { follow, getSession, logout, readCachedSnap, type StreamState } from './api'
import { heroOf, levelRank, normalizeSnap, serverNow, servicesLevel, worst } from './derive'
import { ago, precise } from './format'
import { IconBackups, IconChecklist, IconHistory, IconJobs, IconLogout, IconMore, IconOverview, IconSearch, IconServices, IconSystem, Mark } from './components/icons'
import { Dot, Empty, Glyph, PageHead, ThemeSwitch } from './components/ui'
import { Login } from './views/login'
import { Palette, PAGES } from './components/palette'
import { readLastLook, writeLastLook } from './lastlook'
import { Overview } from './views/overview'
import { Services } from './views/services'
import { BackupsView } from './views/backups'
import { HistoryView } from './views/history'
import { JobsView } from './views/jobs'
import { SystemView } from './views/system'
import { RunbooksView } from './views/runbooks'
import { More } from './views/more'

export interface ViewProps {
  snap: Snapshot
  now: number
  route: string[]
  since?: number | null
  online?: boolean
}

type NavId = '' | 'services' | 'backups' | 'history' | 'jobs' | 'system' | 'runbooks' | 'more'
const NAV: { id: NavId; label: string; icon: (p: { size?: number }) => preact.JSX.Element; tab?: boolean }[] = [
  { id: '', label: 'Overview', icon: IconOverview, tab: true },
  { id: 'services', label: 'Services', icon: IconServices, tab: true },
  { id: 'backups', label: 'Backups', icon: IconBackups, tab: true },
  { id: 'history', label: 'History', icon: IconHistory, tab: true },
  { id: 'jobs', label: 'Jobs', icon: IconJobs },
  { id: 'system', label: 'System', icon: IconSystem, tab: true },
  { id: 'runbooks', label: 'Checklists', icon: IconChecklist },
]

// Addresses from earlier layouts still land in the right place, keeping what they pointed at.
const MOVED: Record<string, (rest: string[]) => string> = {
  alerts: (r) => (r[0] ? `history/alert/${encodeURIComponent(r[0])}` : 'history'),
  timers: () => 'jobs',
  drift: () => 'system/drift',
}

function useRoute(): string[] {
  const parse = () => location.hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent)
  const [r, setR] = useState(parse)
  useEffect(() => {
    const on = () => {
      setR(parse())
      window.scrollTo({ top: 0 })
    }
    addEventListener('hashchange', on)
    return () => removeEventListener('hashchange', on)
  }, [])
  return r
}

/** Each destination's state, and the short count the sidebar shows beside it. */
function areas(s: Snapshot): Record<NavId, { level: Level; count?: string }> {
  const blind = s.status.blind ?? []
  const has = (a: string[]) => blind.some((b) => a.includes(b.area))
  const lv = (l: Level, a: string[]) => (l === 'ok' && has(a) ? 'unknown' : l)
  const svcBad = s.services.filter((x) => levelRank[x.level] >= levelRank.unknown)
  const svcLevel = lv(servicesLevel(s.services), ['services'])
  const svcWord = svcLevel === 'unknown' ? 'unseen' : svcBad.some((x) => x.state === 'down') ? 'down' : 'need you'
  const setBad = s.backups.sets.filter((b) => b.level !== 'ok').length
  const jobs = s.timers.filter((t) => t.highlight)
  const jobsBad = jobs.filter((t) => t.level === 'warn' || t.level === 'crit').length
  const open = s.alerts.open.length
  return {
    '': { level: s.status.level },
    services: { level: svcLevel, count: svcBad.length ? `${svcBad.length} ${svcWord}` : String(s.services.length) },
    backups: { level: lv(worst([s.backups.level, s.drill.level === 'unknown' ? 'ok' : s.drill.level]), ['backups', 'drill']), count: setBad ? `${setBad} late` : String(s.backups.sets.length) },
    history: { level: lv(s.alerts.level === 'info' ? 'ok' : s.alerts.level, ['alerts']), count: open ? `${open} open` : undefined },
    jobs: { level: lv(worst(jobs.map((t) => t.level)), ['timers']), count: jobsBad ? `${jobsBad} failed` : String(jobs.length) },
    system: { level: lv(worst([s.host.level, s.drift.level === 'info' ? 'ok' : s.drift.level, s.heartbeat.level === 'off' ? 'ok' : s.heartbeat.level, s.health.level]), ['drift', 'heartbeat', 'host', 'health']) },
    runbooks: { level: lv('ok', ['runbooks']), count: s.runbooks.length ? String(s.runbooks.length) : undefined },
    more: { level: 'ok' },
  }
}

/** One broken page must not blank the whole app. */
class Guard extends Component<{ page: string; children: ComponentChildren }, { err: string | null }> {
  state = { err: null as string | null }
  static getDerivedStateFromError(e: unknown) {
    return { err: String((e as Error)?.message ?? e) }
  }
  componentDidUpdate(prev: { page: string }) {
    if (prev.page !== this.props.page && this.state.err) this.setState({ err: null })
  }
  render() {
    if (this.state.err) {
      return <div class="empty">This page hit an error and could not be drawn. The rest of Vesper still works.<code>{this.state.err}</code></div>
    }
    return this.props.children
  }
}

function useOnline(): boolean {
  const [on, setOn] = useState(typeof navigator === 'undefined' ? true : navigator.onLine !== false)
  useEffect(() => {
    const up = () => setOn(true)
    const down = () => setOn(false)
    addEventListener('online', up)
    addEventListener('offline', down)
    return () => {
      removeEventListener('online', up)
      removeEventListener('offline', down)
    }
  }, [])
  return on
}

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)

export function App() {
  const [session, setSession] = useState<Session | null>(null)
  const [sessionErr, setSessionErr] = useState('')
  const shot = typeof location !== 'undefined' && new URLSearchParams(location.search).has('shot')
  // screenshots: the ribbon and every other animation hold still
  useEffect(() => {
    if (shot) document.documentElement.classList.add('shot')
  }, [])
  // open on the last known state at once, clearly marked by its time, while the stream connects
  const [snap, setSnap] = useState<Snapshot | null>(() => {
    if (shot) return null
    const c = readCachedSnap()
    return c ? normalizeSnap(c) : null
  })
  const [received, setReceived] = useState(() => performance.now())
  const [fresh, setFresh] = useState(false)
  const [stream, setStream] = useState<StreamState>('connecting')
  const [tick, setTick] = useState(0)
  const route = useRoute()
  const online = useOnline()
  const shotPalette = typeof location !== 'undefined' ? new URLSearchParams(location.search).get('palette') : null
  const [palette, setPalette] = useState(shotPalette !== null)
  const paletteOpen = useRef(palette)
  paletteOpen.current = palette
  const [since, setSince] = useState<number | null | undefined>(undefined)
  const nowRef = useRef(Date.now())

  const load = () =>
    getSession()
      .then((s) => {
        setSession(s)
        setSessionErr('')
      })
      .catch((e) => setSessionErr(String(e.message || e)))

  useEffect(() => {
    load()
  }, [])

  const authed = !!session && (session.auth === 'none' || session.authenticated)

  useEffect(() => {
    if (!authed) return
    return follow(
      (s) => {
        setSnap(normalizeSnap(s))
        setReceived(performance.now())
        setFresh(true)
      },
      (st) => {
        setStream(st)
        if (st === 'unauthorized') setSession((x) => (x ? { ...x, authenticated: false } : x))
      },
    )
  }, [authed])

  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 1000)
    return () => clearInterval(t)
  }, [])

  // a cached snapshot is judged against the wall clock until a live one arrives
  const now = useMemo(() => (fresh ? serverNow(snap, received, performance.now()) : Date.now()), [snap, received, tick, fresh])
  nowRef.current = now

  // the horizon and the sky take the colour of the answer (styles.css, atmosphere); signed out, they take none
  const sky = authed && snap ? heroOf(snap, now, { online }).light : null
  useEffect(() => {
    if (sky) document.documentElement.dataset.sky = sky
    else delete document.documentElement.dataset.sky
  }, [sky])

  useEffect(() => {
    if (snap && fresh && since === undefined) setSince(readLastLook(now))
  }, [snap, fresh])
  useEffect(() => {
    if (shot) return
    const save = () => writeLastLook(nowRef.current)
    const onVis = () => {
      if (document.visibilityState === 'hidden') save()
      else setSince(readLastLook(nowRef.current))
    }
    document.addEventListener('visibilitychange', onVis)
    addEventListener('pagehide', save)
    return () => {
      document.removeEventListener('visibilitychange', onVis)
      removeEventListener('pagehide', save)
    }
  }, [])

  // keyboard: Cmd/Ctrl-K or / opens search; G then a letter jumps to a page
  useEffect(() => {
    let g = 0
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setPalette((p) => !p)
        return
      }
      if (paletteOpen.current) {
        if (e.key === 'Escape') setPalette(false)
        return
      }
      const t = e.target as HTMLElement
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return
      if (e.metaKey || e.ctrlKey || e.altKey) return
      if (e.key === '/' || e.key === '?') {
        e.preventDefault()
        setPalette(true)
        return
      }
      const k = e.key.toUpperCase()
      if (k === 'G') {
        g = Date.now()
        return
      }
      if (Date.now() - g < 900) {
        const page = PAGES.find((p) => p.key === k)
        if (page) location.hash = '/' + page.id
        g = 0
      }
    }
    addEventListener('keydown', onKey)
    return () => removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    if (!snap) return
    const lv = snap.status.level
    const mark = lv === 'crit' ? '■ ' : lv === 'warn' ? '▲ ' : lv === 'unknown' ? '◌ ' : ''
    document.title = `${mark}${snap.title} · Vesper`
  }, [snap?.status.level, snap?.title])

  const page0 = route[0] ?? ''
  useEffect(() => {
    if (Object.hasOwn(MOVED, page0)) location.replace('#/' + MOVED[page0](route.slice(1)))
  }, [page0])

  if (sessionErr && !snap) {
    return (
      <div class="splash">
        <Mark size={44} />
        <p class="strong">Vesper can't reach its server.</p>
        <p class="muted">{sessionErr}</p>
        <button type="button" class="btn" onClick={load}>Try again</button>
      </div>
    )
  }
  if (!session && !snap) return <div class="splash"><Mark size={44} /></div>
  if (session && !authed) return <Login session={session} onDone={load} />
  if (!snap) {
    return (
      <div class="splash">
        <Mark size={44} />
        <p class="strong">Waiting for the first snapshot.</p>
        <p class="muted">The collector writes one every 20 seconds after it starts.</p>
      </div>
    )
  }

  const state = areas(snap)
  const page = (Object.hasOwn(MOVED, page0) ? MOVED[page0](route.slice(1)).split('/')[0] : page0) as NavId
  const props: ViewProps = { snap, now, route, since, online }
  const age = now - Date.parse(snap.generated)
  const live = stream === 'live' && age <= 90_000 && online
  const liveText = !online ? 'Offline' : live ? 'Live' : stream === 'reconnecting' ? 'Reconnecting' : age > 90_000 ? 'Lost sight' : 'Connecting'
  const known = NAV.some((n) => n.id === page) || page === 'more'
  const hostLevel = snap.status.level === 'info' ? 'ok' : snap.status.level

  return (
    <div class="shell">
      <aside class="side" aria-label="Vesper">
        <a class="brand" href="#/"><Mark size={22} />Vesper</a>
        <div class="hostbox">
          <Dot level={hostLevel} live={hostLevel === 'crit'} />
          <b>{snap.title}</b>
          <span class="sub">{[snap.host.os?.replace(/ GNU\/Linux| \(.*\)/g, ''), `up ${precise(snap.host.uptime_s * 1000).replace(/ \d+[ms]$/, '')}`].filter(Boolean).join(' · ')}</span>
          {snap.demo && <span class="tag">DEMO DATA</span>}
        </div>
        <button type="button" class="search" onClick={() => setPalette(true)}>
          <IconSearch size={15} />
          <span>Search or jump</span>
          <kbd>{isMac ? '⌘' : 'Ctrl'} K</kbd>
        </button>
        <nav class="nav" aria-label="Sections">
          {NAV.map((n) => {
            const Icon = n.icon
            const a = state[n.id]
            const bad = a.level === 'crit' || a.level === 'warn' || a.level === 'unknown'
            return (
              <a key={n.id} href={`#/${n.id}`} aria-current={page === n.id ? 'page' : undefined}>
                <Icon size={16} />
                <span>{n.label}</span>
                {bad && !a.count ? <span class="count"><Glyph level={a.level} size={13} /></span> : a.count ? <span class={`count${bad ? ' ' + a.level : ''}`}>{a.count}</span> : null}
              </a>
            )
          })}
        </nav>
        <div class="side-foot">
          <div class="row-x">
            <span class={`live${live ? ' on' : age > 90_000 ? ' lost' : ''}`}><i />{liveText} · {ago(snap.generated, now)}</span>
            {session && <span class="num">{/^\d/.test(session.version) ? 'v' : ''}{session.version}</span>}
          </div>
          <span>Read-only. Vesper never changes the server.</span>
          <div class="row-x"><span>Theme</span><ThemeSwitch compact /></div>
          {session?.auth === 'password' && (
            <button type="button" class="linklike" onClick={() => logout().then(load)}><IconLogout size={14} />Sign out</button>
          )}
        </div>
      </aside>

      <header class="mtop">
        <Mark size={26} />
        <span class="who"><b>{snap.title}</b><span class={`live${live ? ' on' : age > 90_000 ? ' lost' : ''}`}><i />{liveText} · {ago(snap.generated, now)}</span></span>
        <button type="button" class="icon-btn" aria-label="Search" onClick={() => setPalette(true)}><IconSearch size={18} /></button>
      </header>

      <main class={`main${page === '' ? ' flush' : ''}`}>
        <Guard page={page}>
          <div key={page + (route[1] ?? '')}>
            {page === '' && <Overview {...props} />}
            {page === 'services' && <div class="page"><Services {...props} /></div>}
            {page === 'backups' && <div class="page"><BackupsView {...props} /></div>}
            {page === 'history' && <div class="page"><HistoryView {...props} /></div>}
            {page === 'jobs' && <div class="page"><JobsView {...props} /></div>}
            {page === 'system' && <div class="page"><SystemView {...props} /></div>}
            {page === 'runbooks' && <div class="page"><RunbooksView {...props} /></div>}
            {page === 'more' && <div class="page"><More snap={snap} levels={state} onSearch={() => setPalette(true)} /></div>}
            {!known && <div class="page"><PageHead title="Page not found" /><Empty>Vesper has no page at this address.<code>#/{route.join('/')}</code><a class="btn" href="#/">Back to the overview</a></Empty></div>}
          </div>
        </Guard>
      </main>

      <nav class="tabbar" aria-label="Sections">
        {NAV.filter((n) => n.tab && n.id !== 'system').map((n) => {
          const Icon = n.icon
          const a = state[n.id]
          const bad = a.level === 'crit' || a.level === 'warn' || a.level === 'unknown'
          return (
            <a key={n.id} href={`#/${n.id}`} class="tab" aria-current={page === n.id ? 'page' : undefined}>
              <Icon size={20} />
              {bad && <span class="badge"><Glyph level={a.level} size={11} /></span>}
              <span>{n.label}</span>
            </a>
          )
        })}
        {(() => {
          const lv = worst([state.jobs.level, state.system.level, state.runbooks.level])
          const bad = lv === 'crit' || lv === 'warn' || lv === 'unknown'
          return (
            <a href="#/more" class="tab" aria-current={page === 'more' || page === 'jobs' || page === 'system' || page === 'runbooks' ? 'page' : undefined}>
              <IconMore size={20} />
              {bad && <span class="badge"><Glyph level={lv} size={11} /></span>}
              <span>More</span>
            </a>
          )
        })()}
      </nav>
      {palette && <Palette snap={snap} initial={shotPalette ?? ''} onClose={() => setPalette(false)} />}
    </div>
  )
}
