import { describe, expect, it, vi } from 'vitest'

// the module reads the address once, when it loads
async function at(url: string) {
  history.replaceState(null, '', url)
  vi.resetModules()
  return import('./scenario')
}

describe('the demo scenario', () => {
  it('comes from the address, and anything else is the default', async () => {
    expect((await at('/?scenario=incident#/services')).getScenario()).toBe('incident')
    expect((await at('/?scenario=nonsense')).getScenario()).toBe('attention')
    expect((await at('/')).getScenario()).toBe('attention')
  })

  it('writes a choice to the address, keeps the page and the other parameters, and tells listeners once', async () => {
    const m = await at('/?since=9h#/backups')
    const seen: string[] = []
    const off = m.onScenario((s) => seen.push(s))
    m.setScenario('blind')
    expect(location.search).toBe('?since=9h&scenario=blind')
    expect(location.hash).toBe('#/backups')
    m.setScenario('blind') // no change: nobody is told
    m.setScenario('attention') // the default leaves the address clean
    expect(location.search).toBe('?since=9h')
    off()
    m.setScenario('calm')
    expect(seen).toEqual(['blind', 'attention'])
    expect(m.getScenario()).toBe('calm')
  })

  it('holds the clock still only for a time it can read', async () => {
    const m = await at('/?at=2026-03-10T10:42:00Z')
    expect(m.frozenAt()).toBe(Date.UTC(2026, 2, 10, 10, 42))
    expect(m.parseAt('yesterday-ish')).toBeNull()
    expect(m.parseAt(null)).toBeNull()
  })
})
