import type { Session, Snapshot } from './types'

const json = { 'Content-Type': 'application/json' }

export async function getSession(): Promise<Session> {
  const r = await fetch('/api/session', { credentials: 'same-origin' })
  if (!r.ok) throw new Error(`session: HTTP ${r.status}`)
  return r.json()
}

export type LoginResult = { ok: true } | { ok: false; error: string; retryAfter?: number }

export async function login(username: string, password: string): Promise<LoginResult> {
  const r = await fetch('/api/login', {
    method: 'POST', headers: json, credentials: 'same-origin', body: JSON.stringify({ username, password }),
  })
  if (r.ok) return { ok: true }
  let body: { error?: string; retry_after?: number } = {}
  try {
    body = await r.json()
  } catch {
    /* not JSON */
  }
  if (r.status === 429) return { ok: false, error: 'Too many attempts.', retryAfter: body.retry_after }
  if (r.status === 401) return { ok: false, error: 'That username or password is not right.' }
  return { ok: false, error: body.error || `Sign-in failed (HTTP ${r.status}).` }
}

export async function logout(): Promise<void> {
  forgetSnap()
  await fetch('/api/logout', { method: 'POST', headers: json, credentials: 'same-origin', body: '{}' })
}

// The last snapshot is kept on this device, so Cockpit opens on the last known
// state at once (and offline), clearly marked with its time, while it reconnects.
const SNAP_KEY = 'cockpit-last-snapshot'

export function readCachedSnap(): Snapshot | null {
  try {
    const raw = localStorage.getItem(SNAP_KEY)
    return raw ? (JSON.parse(raw) as Snapshot) : null
  } catch {
    return null
  }
}

function keepSnap(s: Snapshot) {
  try {
    localStorage.setItem(SNAP_KEY, JSON.stringify(s))
  } catch {
    /* full or private: the app still works, it just starts empty */
  }
}

export function forgetSnap() {
  try {
    localStorage.removeItem(SNAP_KEY)
  } catch {
    /* private mode */
  }
}

export async function getRunbook(id: string): Promise<string> {
  const r = await fetch(`/api/runbooks/${encodeURIComponent(id)}`, { credentials: 'same-origin' })
  if (!r.ok) throw new Error(r.status === 404 ? 'This runbook is not available.' : `HTTP ${r.status}`)
  return r.text()
}

export type StreamState = 'connecting' | 'live' | 'reconnecting' | 'unauthorized'

/**
 * Follows /api/events. EventSource reconnects on its own; while it is down a
 * plain poll keeps the page fresh, and a 401 stops everything.
 */
export function follow(onSnap: (s: Snapshot) => void, onState: (s: StreamState) => void): () => void {
  let es: EventSource | null = null
  let poll: number | undefined
  let stopped = false
  const shot = new URLSearchParams(location.search).has('shot')
  const got = (s: Snapshot) => {
    onSnap(s)
    if (!shot) keepSnap(s)
  }

  const fetchOnce = async () => {
    try {
      const r = await fetch('/api/state', { credentials: 'same-origin', cache: 'no-cache' })
      if (r.status === 401) {
        onState('unauthorized')
        stop()
        return
      }
      if (r.ok) got(await r.json())
    } catch {
      /* offline: the next tick retries */
    }
  }
  const startPoll = () => {
    if (poll === undefined) poll = window.setInterval(fetchOnce, 15000)
  }
  const stopPoll = () => {
    if (poll !== undefined) window.clearInterval(poll)
    poll = undefined
  }
  const open = () => {
    es?.close()
    onState('connecting')
    es = new EventSource('/api/events')
    es.addEventListener('snapshot', (ev) => {
      try {
        got(JSON.parse((ev as MessageEvent).data))
        onState('live')
        stopPoll()
      } catch {
        /* a broken frame: wait for the next one */
      }
    })
    es.onerror = () => {
      if (stopped) return
      onState('reconnecting')
      startPoll()
      fetchOnce()
    }
  }
  // iOS drops the stream while the app is in the background and may never fire
  // an error for it (WebKit bug 282526), so coming back always reconnects.
  const onBack = () => {
    if (stopped || document.visibilityState !== 'visible') return
    open()
    fetchOnce()
  }
  const onPageShow = (e: PageTransitionEvent) => e.persisted && onBack()
  const stop = () => {
    stopped = true
    es?.close()
    stopPoll()
    document.removeEventListener('visibilitychange', onBack)
    removeEventListener('pageshow', onPageShow)
    removeEventListener('online', onBack)
  }
  // ?shot renders one snapshot without a stream, for screenshots and tests
  if (shot) {
    document.documentElement.classList.add('shot')
    onState('live')
    fetchOnce()
    return stop
  }
  document.addEventListener('visibilitychange', onBack)
  addEventListener('pageshow', onPageShow)
  addEventListener('online', onBack)
  open()
  return stop
}
