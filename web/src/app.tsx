import { Component, type ComponentChildren } from 'preact'
import { useEffect, useMemo, useRef, useState } from 'preact/hooks'
import type { Level, Session, Snapshot } from './types'
import { follow, getSession, logout, type StreamState } from './api'
import { normalizeSnap, serverNow, servicesLevel, worst } from './derive'
import { ago } from './format'
import {
  IconAlerts, IconBackups, IconDrift, IconLogout, IconOverview, IconRunbooks, IconServices, IconTimers, Mark,
} from './components/icons'
import { Dot } from './components/ui'
import { Login } from './views/login'
import { Palette, PAGES } from './components/palette'
import { readLastLook, writeLastLook } from './lastlook'
import { Overview } from './views/overview'
import { Services } from './views/services'
import { BackupsView } from './views/backups'
import { AlertsView } from './views/alerts'
import { TimersView } from './views/timers'
import { DriftView } from './views/drift'
import { RunbooksView } from './views/runbooks'

export interface ViewProps {
  snap: Snapshot
  now: number
  route: string[]
  since?: number | null
}

const NAV = [
  { id: '', label: 'Overview', icon: IconOverview },
  { id: 'services', label: 'Services', icon: IconServices },
  { id: 'backups', label: 'Backups', icon: IconBackups },
  { id: 'alerts', label: 'Alerts', icon: IconAlerts },
  { id: 'timers', label: 'Timers', icon: IconTimers },
  { id: 'drift', label: 'Drift', icon: IconDrift },
  { id: 'runbooks', label: 'Checklists', icon: IconRunbooks },
] as const

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
  return {
    '': s.status.level,
    services: servicesLevel(s.services),
    backups: worst([s.backups.level, s.drill.level === 'unknown' ? 'ok' : s.drill.level]),
    alerts: s.alerts.level,
    timers: worst(s.timers.filter((t) => t.highlight).map((t) => t.level)),
    drift: worst([s.drift.level === 'info' ? 'ok' : s.drift.level, s.heartbeat.level === 'off' ? 'ok' : s.heartbeat.level]),
    runbooks: 'ok',
  }
}

/** The attitude indicator flies level when all is well and banks when it is not. */
function bankFor(l: Level) {
  return l === 'crit' ? -34 : l === 'warn' ? -20 : -6
}

/** One broken page must not blank the whole dashboard. */
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
      return <div class="empty">This page hit an error and could not be drawn: <code>{this.state.err}</code></div>
    }
    return this.props.children
  }
}

export function App() {
  const [session, setSession] = useState<Session | null>(null)
  const [sessionErr, setSessionErr] = useState('')
  const [snap, setSnap] = useState<Snapshot | null>(null)
  const [received, setReceived] = useState(0)
  const [stream, setStream] = useState<StreamState>('connecting')
  const [tick, setTick] = useState(0)
  const route = useRoute()
  const shotPalette = typeof location !== 'undefined' ? new URLSearchParams(location.search).get('palette') : null
  const [palette, setPalette] = useState(shotPalette !== null)
  const paletteOpen = useRef(palette)
  paletteOpen.current = palette
  const [since, setSince] = useState<number | null | undefined>(undefined)
  const nowRef = useRef(Date.now())
  const shot = typeof location !== 'undefined' && new URLSearchParams(location.search).has('shot')

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
      },
      (st) => {
        setStream(st)
        if (st === 'unauthorized') setSession((x) => (x ? { ...x, authenticated: false } : x))
      },
    )
  }, [authed])

  // a 1 s heartbeat for countdowns and "updated 3s ago"
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 1000)
    return () => clearInterval(t)
  }, [])

  const now = useMemo(() => serverNow(snap, received, performance.now()), [snap, received, tick])
  nowRef.current = now

  // "since you last looked": read once the server clock is known, save when the deck is hidden
  useEffect(() => {
    if (snap && since === undefined) setSince(readLastLook(now))
  }, [snap])
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

  // keyboard: Cmd/Ctrl-K or / opens the command bar; G then a letter jumps to a page
  useEffect(() => {
    let g = 0
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setPalette((p) => !p)
        return
      }
      if (paletteOpen.current) { // the command bar has its own keys; Escape closes it from anywhere
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
    const mark = lv === 'crit' ? '■ ' : lv === 'warn' ? '▲ ' : ''
    document.title = `${mark}${snap.title} · Cockpit`
  }, [snap?.status.level, snap?.title])

  if (sessionErr) {
    return (
      <div class="splash">
        <Mark size={44} />
        <p>Cockpit cannot reach its server.</p>
        <p class="muted">{sessionErr}</p>
        <button class="btn" onClick={load}>Try again</button>
      </div>
    )
  }
  if (!session) return <div class="splash"><Mark size={44} /></div>
  if (!authed) return <Login session={session} onDone={load} />
  if (!snap) {
    return (
      <div class="splash">
        <Mark size={44} />
        <p>Waiting for the first snapshot…</p>
        <p class="muted">The collector writes one every few seconds after it starts.</p>
      </div>
    )
  }

  const levels = areaLevels(snap)
  const page = route[0] ?? ''
  const props: ViewProps = { snap, now, route, since }
  const age = now - Date.parse(snap.generated)
  const stale = age > 90_000

  return (
    <div class="shell">
      <aside class="rail">
        <a class="brand" href="#/">
          <Mark size={30} bank={bankFor(snap.status.level)} />
          <div>
            <div class="brand-name">Cockpit</div>
            <div class="brand-host">{snap.title}</div>
          </div>
        </a>
        <button type="button" class="search" onClick={() => setPalette(true)}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="6.5" /><path d="M16 16l4.5 4.5" /></svg>
          <span>Jump to…</span>
          <kbd>{/Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl'} K</kbd>
        </button>
        <nav class="nav" aria-label="Sections">
          {NAV.map((n) => {
            const Icon = n.icon
            const lv = levels[n.id]
            return (
              <a key={n.id} href={`#/${n.id}`} class={`nav-item${page === n.id ? ' active' : ''}`} aria-current={page === n.id ? 'page' : undefined}>
                <Icon size={18} />
                <span class="nav-label">{n.label}</span>
                {lv === 'warn' || lv === 'crit' ? <Dot level={lv} size={7} /> : null}
              </a>
            )
          })}
        </nav>
        <div class="rail-foot">
          <div class={`live ${stream === 'live' && !stale ? 'on' : 'off'}`}>
            <Dot level={stream === 'live' && !stale ? 'ok' : 'warn'} pulse={stream === 'live' && !stale} size={7} />
            {stream === 'live' && !stale ? 'Live' : stream === 'reconnecting' ? 'Reconnecting' : stale ? 'Stale' : 'Connecting'}
            <span class="muted">updated {ago(snap.generated, now)}</span>
          </div>
          {snap.demo && <div class="demo-tag">Demo data</div>}
          {session.auth === 'password' && (
            <button class="linklike" onClick={() => logout().then(load)}>
              <IconLogout size={15} /> Sign out
            </button>
          )}
          <div class="version">{/^\d/.test(session.version) ? 'v' : ''}{session.version}</div>
        </div>
      </aside>

      <header class="topbar">
        <a class="brand" href="#/">
          <Mark size={26} bank={bankFor(snap.status.level)} />
          <div class="brand-name">{snap.title}</div>
        </a>
        <button type="button" class="top-search" aria-label="Jump to anything" onClick={() => setPalette(true)}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="6.5" /><path d="M16 16l4.5 4.5" /></svg>
        </button>
        <span class={`top-status lv-${snap.status.level}`}>
          <Dot level={stream === 'live' && !stale ? snap.status.level : 'warn'} pulse={stream === 'live'} size={7} />
          {stream === 'live' && !stale ? (snap.status.level === 'ok' ? 'Normal' : snap.status.level === 'crit' ? 'Warning' : 'Caution') : 'Offline'}
        </span>
      </header>
      <nav class="tabs" aria-label="Sections">
        {NAV.map((n) => (
          <a key={n.id} href={`#/${n.id}`} class={`tab${page === n.id ? ' active' : ''}`}>
            {n.label}
            {levels[n.id] === 'warn' || levels[n.id] === 'crit' ? <Dot level={levels[n.id]} size={6} /> : null}
          </a>
        ))}
      </nav>

      <main class="main">
        {stale && (
          <div class="banner warn">
            The collector has not written for {ago(snap.generated, now).replace(' ago', '')}. Showing the last known state.
          </div>
        )}
        {snap.maintenance && (
          <div class="banner info">Maintenance mode since {ago(snap.maintenance.since, now)}: watchdogs are paused.</div>
        )}
        <Guard page={page}>
        <div class="page" key={page}>
        {page === '' && <Overview {...props} />}
        {page === 'services' && <Services {...props} />}
        {page === 'backups' && <BackupsView {...props} />}
        {page === 'alerts' && <AlertsView {...props} />}
        {page === 'timers' && <TimersView {...props} />}
        {page === 'drift' && <DriftView {...props} />}
        {page === 'runbooks' && <RunbooksView {...props} />}
        </div>
        </Guard>
        {!NAV.some((n) => n.id === page) && (
          <div class="empty">
            Nothing here. <a href="#/">Back to the overview</a>
          </div>
        )}
      </main>
      {palette && <Palette snap={snap} initial={shotPalette ?? ''} onClose={() => setPalette(false)} />}
    </div>
  )
}
