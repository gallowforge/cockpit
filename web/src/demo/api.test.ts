import { afterEach, describe, expect, it, vi } from 'vitest'
import type * as Real from '../api'
import type { Snapshot } from '../types'
import type { Engine } from './engine'

type Made = Snapshot & { scenario: string }
const visible = (v: boolean) => {
  Object.defineProperty(document, 'visibilityState', { value: v ? 'visible' : 'hidden', configurable: true })
  document.dispatchEvent(new Event('visibilitychange'))
}

// a generator that says what it was asked for, in place of the WebAssembly one
async function page(url = '/', withEngine = true) {
  history.replaceState(null, '', url)
  document.documentElement.className = ''
  vi.resetModules()
  const asked: [string, number][] = []
  const fake: Engine = {
    snapshot: (scenario, ms) => {
      asked.push([scenario, ms])
      return JSON.stringify({ title: 'raspberrypi', demo: true, generated: new Date(ms).toISOString(), scenario })
    },
    runbook: (id) => (id === 'restore-a-backup' ? '# Restore a backup' : null),
  }
  globalThis.vesperDemo = withEngine ? fake : undefined
  return { api: await import('./api'), scenario: await import('./scenario'), asked }
}

afterEach(() => {
  vi.useRealTimers()
  visible(true)
  globalThis.vesperDemo = undefined
})

describe('the demo in place of the server', () => {
  it('offers everything the app asks of the real one', async () => {
    const { api } = await page()
    const same: typeof Real = api // a compile-time check: the app cannot tell the two apart
    expect(Object.keys(same)).toEqual(expect.arrayContaining(['follow', 'forgetSnap', 'getRunbook', 'getSession', 'login', 'logout', 'readCachedSnap']))
  })

  it('opens signed in, as demo data, on the state now', async () => {
    const { api } = await page()
    expect(await api.getSession()).toMatchObject({ auth: 'none', authenticated: true, demo: true, title: 'raspberrypi' })
    expect(api.readCachedSnap()).toMatchObject({ title: 'raspberrypi', demo: true })
    expect((await page('/', false)).api.readCachedSnap()).toBeNull()
  })

  it('serves runbooks from the generator, and says so when there is none', async () => {
    const { api } = await page()
    expect(await api.getRunbook('restore-a-backup')).toBe('# Restore a backup')
    await expect(api.getRunbook('nope')).rejects.toThrow('This runbook is not available.')
  })

  it('makes a state every two seconds, at once on a new scenario, and none while hidden', async () => {
    vi.useFakeTimers()
    const { api, scenario } = await page()
    const snaps: Made[] = []
    const states: string[] = []
    const stop = api.follow((s) => snaps.push(s as Made), (s) => states.push(s))
    expect(states).toEqual(['connecting'])
    await vi.advanceTimersByTimeAsync(0)
    expect(snaps).toHaveLength(1)
    expect(states.at(-1)).toBe('live')
    await vi.advanceTimersByTimeAsync(api.EVERY_MS * 2)
    expect(snaps).toHaveLength(3)

    scenario.setScenario('incident')
    expect(snaps).toHaveLength(4)
    expect(snaps[3].scenario).toBe('incident')

    visible(false)
    await vi.advanceTimersByTimeAsync(60_000)
    scenario.setScenario('blind')
    expect(snaps).toHaveLength(4)
    visible(true) // back on screen: the state now, without waiting for the next beat
    expect(snaps).toHaveLength(5)
    expect(snaps[4].scenario).toBe('blind')
    await vi.advanceTimersByTimeAsync(api.EVERY_MS)
    expect(snaps).toHaveLength(6)

    stop()
    scenario.setScenario('calm')
    await vi.advanceTimersByTimeAsync(60_000)
    expect(snaps).toHaveLength(6)
  })

  it('renders one still state for a screenshot, at the time it is given', async () => {
    vi.useFakeTimers()
    const { api, asked } = await page('/?shot&scenario=blind&at=2026-03-10T10:42:00Z')
    const snaps: Made[] = []
    api.follow((s) => snaps.push(s as Made), () => {})
    await vi.advanceTimersByTimeAsync(60_000)
    expect(snaps).toHaveLength(1)
    expect(asked).toEqual([['blind', Date.UTC(2026, 2, 10, 10, 42)]])
    expect(document.documentElement.classList.contains('shot')).toBe(true)
  })

  it('keeps the last state when the generator stops answering, and says so', async () => {
    vi.useFakeTimers()
    const { api } = await page()
    const snaps: Made[] = []
    const states: string[] = []
    const stop = api.follow((s) => snaps.push(s as Made), (s) => states.push(s))
    await vi.advanceTimersByTimeAsync(0)
    expect(states.at(-1)).toBe('live')
    globalThis.vesperDemo!.snapshot = () => {
      throw new Error('Go program has already exited')
    }
    expect(api.readCachedSnap()).toBeNull()
    await vi.advanceTimersByTimeAsync(api.EVERY_MS)
    expect(snaps).toHaveLength(1)
    expect(states.at(-1)).toBe('reconnecting')
    stop()
  })
})
