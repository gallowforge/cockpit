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
  await fetch('/api/logout', { method: 'POST', headers: json, credentials: 'same-origin', body: '{}' })
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

  const fetchOnce = async () => {
    try {
      const r = await fetch('/api/state', { credentials: 'same-origin', cache: 'no-cache' })
      if (r.status === 401) {
        onState('unauthorized')
        stop()
        return
      }
      if (r.ok) onSnap(await r.json())
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
    onState('connecting')
    es = new EventSource('/api/events')
    es.addEventListener('snapshot', (ev) => {
      try {
        onSnap(JSON.parse((ev as MessageEvent).data))
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
  const stop = () => {
    stopped = true
    es?.close()
    stopPoll()
  }
  // ?shot renders one snapshot without a stream, for screenshots and tests
  if (new URLSearchParams(location.search).has('shot')) {
    document.documentElement.classList.add('shot')
    onState('live')
    fetchOnce()
    return stop
  }
  open()
  return stop
}
