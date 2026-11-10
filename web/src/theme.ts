// The theme: night, day, or whichever the device is in.
//
// The choice is one of three modes and lives in this browser only. What the
// page shows is one of two themes, named on the root as data-theme, and the
// stylesheet hangs every colour from that name. public/theme.js names it once
// before the first paint; this module keeps it right afterwards and tells the
// two things that cannot read a stylesheet: the browser's own chrome (the
// theme-color meta) and the canvas of stage.ts.
import { useEffect, useState } from 'preact/hooks'

export type Mode = 'system' | 'light' | 'dark'
export type Theme = 'light' | 'dark'

export const KEY = 'vesper:theme'
/** The ground of each theme: --bg in styles.css, and the colour the browser paints its own bars. */
export const GROUND: Record<Theme, string> = { dark: '#060d0a', light: '#eef2ec' }
export const MODES: readonly (readonly [Mode, string])[] = [['system', 'System'], ['light', 'Light'], ['dark', 'Dark']]

const device = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: light)') : null
const heard = new Set<() => void>()
// the choice when storage is off: it then lasts as long as the tab
let kept: Mode | null = null

export function isMode(v: unknown): v is Mode {
  return v === 'system' || v === 'light' || v === 'dark'
}

/** What the reader chose; `system` until they choose. */
export function mode(): Mode {
  if (kept) return kept
  try {
    const v = localStorage.getItem(KEY)
    return isMode(v) ? v : 'system'
  } catch {
    return 'system'
  }
}

/** The theme a mode comes to on a device that is, or is not, in its light setting. */
export function resolve(m: Mode, deviceLight: boolean): Theme {
  return m === 'system' ? (deviceLight ? 'light' : 'dark') : m
}

/** The theme on show. */
export function theme(): Theme {
  return resolve(mode(), !!device?.matches)
}

/** Names the theme on the root and tells whoever asked to hear. */
function show() {
  const now = theme()
  const root = document.documentElement
  if (root.dataset.theme !== now) root.dataset.theme = now
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', GROUND[now])
  for (const fn of heard) fn()
}

/** True when the change should simply happen: a screenshot, or a reader who asked for less motion. */
function plain(): boolean {
  return document.documentElement.classList.contains('shot') || (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches)
}

/** Chooses a mode. The page dissolves from one theme into the other where the
 *  browser can do that; everywhere else it just changes. */
export function setMode(m: Mode) {
  const before = theme()
  kept = m
  try {
    if (m === 'system') localStorage.removeItem(KEY)
    else localStorage.setItem(KEY, m)
    kept = null
  } catch {
    // storage is off: `kept` carries the choice
  }
  const dissolve = (document as Document & { startViewTransition?: (cb: () => void) => unknown }).startViewTransition
  if (theme() !== before && typeof dissolve === 'function' && !plain()) dissolve.call(document, show)
  else show()
}

/** Calls `fn` whenever the mode or the theme changes. Returns the way to stop. */
export function onTheme(fn: () => void): () => void {
  heard.add(fn)
  return () => heard.delete(fn)
}

/** The mode, for a control that sets it. */
export function useMode(): Mode {
  const [m, set] = useState(mode)
  useEffect(() => onTheme(() => set(mode())), [])
  return m
}

// the device changing its own setting moves a reader who follows it, and
// another tab choosing a mode moves this one
device?.addEventListener('change', show)
if (typeof addEventListener === 'function') addEventListener('storage', (e) => {
  if (e.key !== KEY && e.key !== null) return
  kept = null
  show()
})
if (typeof document !== 'undefined') show()
