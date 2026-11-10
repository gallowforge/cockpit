// The live demo's stand-in for ../api: the same surface, with Vesper's own
// generator (WebAssembly, see ./engine) where the server would be. The pages
// build puts this file in ../api's place (vite.config.ts); the build that goes
// into the binary never sees it.
import type { Session, Snapshot } from '../types'
import type { LoginResult, StreamState } from '../api'
import { engine, loaded } from './engine'
import { frozenAt, getScenario, onScenario } from './scenario'

export type { LoginResult, StreamState }

declare const __VESPER_VERSION__: string

/** The pace of `vesper demo`. */
export const EVERY_MS = 2000

/** One snapshot of the chosen scenario, at the visitor's own time. */
function make(): Snapshot | null {
  const e = loaded()
  if (!e) return null
  try {
    const raw = e.snapshot(getScenario(), frozenAt() ?? Date.now())
    return raw ? (JSON.parse(raw) as Snapshot) : null
  } catch {
    return null // the generator stopped: the page keeps the last state it drew, and follow() says so
  }
}

export async function getSession(): Promise<Session> {
  await engine()
  return { auth: 'none', authenticated: true, title: make()?.title ?? 'Vesper', demo: true, version: __VESPER_VERSION__ }
}

// nobody signs in to the demo
export async function login(): Promise<LoginResult> {
  return { ok: true }
}

export async function logout(): Promise<void> {}

/** The state to open on at once. Here nothing is kept between visits: once
 *  the generator is loaded this is simply the state now. */
export function readCachedSnap(): Snapshot | null {
  return make()
}

export function forgetSnap() {}

export async function getRunbook(id: string): Promise<string> {
  const text = (await engine()).runbook(id)
  if (text == null) throw new Error('This runbook is not available.')
  return text
}

/**
 * Hands the page a new state every two seconds while it is on screen, and at
 * once when the scenario changes.
 */
export function follow(onSnap: (s: Snapshot) => void, onState: (s: StreamState) => void): () => void {
  let timer: number | undefined
  let stopped = false
  // ?shot renders one snapshot and holds still, for screenshots and tests
  const shot = new URLSearchParams(location.search).has('shot')
  if (shot) document.documentElement.classList.add('shot')

  const beat = () => {
    // a hidden tab makes nothing, and neither does a generator that is still loading
    if (stopped || document.visibilityState !== 'visible' || !loaded()) return
    const s = make()
    if (!s) {
      onState('reconnecting') // the generator stopped: say so, as a lost server would be said
      return
    }
    onSnap(s)
    onState('live')
  }
  const pace = () => {
    window.clearInterval(timer)
    timer = undefined
    if (stopped || document.visibilityState !== 'visible') return
    beat()
    if (!shot) timer = window.setInterval(beat, EVERY_MS)
  }
  const offScenario = onScenario(beat)
  document.addEventListener('visibilitychange', pace)
  onState('connecting')
  engine().then(pace, () => !stopped && onState('reconnecting'))
  return () => {
    stopped = true
    window.clearInterval(timer)
    offScenario()
    document.removeEventListener('visibilitychange', pace)
  }
}
