import { Component, type ComponentChildren } from 'preact'
import { useEffect, useMemo, useRef, useState } from 'preact/hooks'
import type { Level, Session, Snapshot } from './types'
import { follow, getSession, logout, readCachedSnap, type StreamState } from './api'
import { normalizeSnap, serverNow, servicesLevel, worst } from './derive'
import { ago } from './format'
import { IconBackups, IconHistory, IconLogout, IconNow, IconSearch, IconServices, IconSystem, Mark } from './components/icons'
import { Glyph } from './components/ui'
import { Login } from './views/login'
import { Palette, PAGES } from './components/palette'
import { readLastLook, writeLastLook } from './lastlook'
import { Now } from './views/now'
import { Services } from './views/services'
import { BackupsView } from './views/backups'
import { HistoryView } from './views/history'
import { SystemView } from './views/system'
import { RunbooksView } from './views/runbooks'

export interface ViewProps {
  snap: Snapshot
  now: number
  route: string[]
  since?: number | null
  online?: boolean
}

const NAV = [
  { id: '', label: 'Now', icon: IconNow },
  { id: 'services', label: 'Services', icon: IconServices },
  { id: 'backups', label: 'Backups', icon: IconBackups },
  { id: 'history', label: 'History', icon: IconHistory },
  { id: 'system', label: 'System', icon: IconSystem },
] as const

// Addresses from the earlier layout still land in the right place.
const MOVED: Record<string, string> = { alerts: 'history', timers: 'system', drift: 'system' }

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

function areaLevels(s: Snapshot): Record<string, Level> {
  const blind = s.status.blind ?? []
  const has = (a: string[]) => blind.some((b) => a.includes(b.area))
  const lv = (l: Level, areas: string[]) => (l === 'ok' && has(areas) ? 'unknown' : l)
  return {
    '': s.status.level,
    services: lv(servicesLevel(s.services), ['services']),
    backups: lv(worst([s.backups.level, s.drill.level === 'unknown' ? 'ok' : s.drill.level]), ['backups', 'drill']),
    history: s.alerts.level,
    system: lv(worst([s.host.level, s.drift.level === 'info' ? 'ok' : s.drift.level, s.heartbeat.level === 'off' ? 'ok' : s.heartbeat.level, s.health.level,
      worst(s.timers.filter((t) => t.highlight).map((t) => t.level))]), ['drift', 'heartbeat', 'timers', 'host', 'runbooks']),
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
      return <div class="empty">This page hit an error and could not be drawn. The rest of Cockpit still works. <code>{this.state.err}</code></div>
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

export function App() {
  const [session, setSession] = useState<Session | null>(null)
  const [sessionErr, setSessionErr] = useState('')
  const shot = typeof location !== 'undefined' && new URLSearchParams(location.search).has('shot')
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
    document.title = `${mark}${snap.title} · Cockpit`
    document.documentElement.dataset.light = lv === 'crit' ? 'down' : lv === 'warn' ? 'attn' : lv === 'unknown' ? 'blind' : 'calm'
  }, [snap?.status.level, snap?.title])

  const page0 = route[0] ?? ''
  useEffect(() => {
    if (MOVED[page0]) location.replace('#/' + MOVED[page0])
  }, [page0])

  if (sessionErr && !snap) {
    return (
      <div class="splash">
        <Mark size={52} />
        <p>Cockpit cannot reach its server.</p>
        <p class="muted">{sessionErr}</p>
        <button class="btn" onClick={load}>Try again</button>
      </div>
    )
  }
  if (!session && !snap) return <div class="splash"><Mark size={52} /></div>
  if (session && !authed) return <Login session={session} onDone={load} />
  if (!snap) {
    return (
      <div class="splash">
        <Mark size={52} />
        <p>Waiting for the first snapshot.</p>
        <p class="muted">The collector writes one every 20 seconds after it starts.</p>
      </div>
    )
  }

  const levels = areaLevels(snap)
  const page = MOVED[page0] ?? page0
  const props: ViewProps = { snap, now, route, since, online }
  const age = now - Date.parse(snap.generated)
  const live = stream === 'live' && age <= 90_000 && online
  const liveText = !online ? 'Offline' : live ? 'Live' : stream === 'reconnecting' ? 'Reconnecting' : age > 90_000 ? 'Lost sight' : 'Connecting'
  const known = NAV.some((n) => n.id === page) || page === 'runbooks'

  return (
    <div class="shell">
      <aside class="side chrome">
        <a class="brand" href="#/">
          <Mark size={34} level={snap.status.level} />
          <span><span class="brand-name">Cockpit</span><span class="brand-host">{snap.title}</span></span>
        </a>
        <button type="button" class="search" onClick={() => setPalette(true)}>
          <IconSearch size={16} />
          <span>Search or jump</span>
          <kbd>{/Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl'} K</kbd>
        </button>
        <nav class="nav" aria-label="Sections">
          {NAV.map((n) => {
            const Icon = n.icon
            const lv = levels[n.id]
            return (
              <a key={n.id} href={`#/${n.id}`} class={`nav-item${page === n.id ? ' on' : ''}`} aria-current={page === n.id ? 'page' : undefined}>
                <Icon size={19} />
                <span>{n.label}</span>
                {lv === 'warn' || lv === 'crit' || lv === 'unknown' ? <Glyph level={lv} size={13} /> : null}
              </a>
            )
          })}
        </nav>
        {snap.runbooks.some((r) => r.local) && (
          <div class="side-list">
            <span class="side-list-h">Checklists</span>
            {snap.runbooks.filter((r) => r.local).slice(0, 6).map((r) => (
              <a key={r.id} href={`#/runbooks/${encodeURIComponent(r.id)}`} class={page === 'runbooks' && route[1] === r.id ? 'on' : ''}>{r.title}</a>
            ))}
          </div>
        )}
        <div class="side-foot">
          <span class={`live${live ? ' on' : ''}`}><i />{liveText}<span class="muted"> · {ago(snap.generated, now)}</span></span>
          {snap.demo && <span class="demo-tag">Demo data</span>}
          {session?.auth === 'password' && (
            <button class="linklike" onClick={() => logout().then(load)}><IconLogout size={15} /> Sign out</button>
          )}
          {session && <span class="version">{/^\d/.test(session.version) ? 'v' : ''}{session.version}</span>}
        </div>
      </aside>

      <header class="topbar">
        <a class="brand" href="#/">
          <Mark size={30} level={snap.status.level} />
          <span><span class="brand-name">{snap.title}</span><span class={`brand-live${live ? ' on' : ''}`}>{liveText}, {ago(snap.generated, now)}</span></span>
        </a>
        <button type="button" class="icon-btn" aria-label="Search" onClick={() => setPalette(true)}><IconSearch size={20} /></button>
      </header>

      <main class="main">
        <Guard page={page}>
          <div class="page" key={page + (route[1] ?? '')}>
            {page === '' && <Now {...props} />}
            {page === 'services' && <Services {...props} />}
            {page === 'backups' && <BackupsView {...props} />}
            {page === 'history' && <HistoryView {...props} />}
            {page === 'system' && <SystemView {...props} />}
            {page === 'runbooks' && <RunbooksView {...props} />}
            {!known && <div class="empty">Nothing here. <a href="#/">Back to Now</a></div>}
          </div>
        </Guard>
      </main>

      <nav class="tabbar chrome" aria-label="Sections">
        {NAV.map((n) => {
          const Icon = n.icon
          const lv = levels[n.id]
          return (
            <a key={n.id} href={`#/${n.id}`} class={`tab${page === n.id ? ' on' : ''}`} aria-current={page === n.id ? 'page' : undefined}>
              <span class="tab-icon"><Icon size={22} />{lv === 'warn' || lv === 'crit' || lv === 'unknown' ? <Glyph level={lv} size={11} /> : null}</span>
              <span class="tab-label">{n.label}</span>
            </a>
          )
        })}
      </nav>
      {palette && <Palette snap={snap} initial={shotPalette ?? ''} onClose={() => setPalette(false)} />}
    </div>
  )
}
