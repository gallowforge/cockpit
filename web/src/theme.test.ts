import { beforeEach, describe, expect, it, vi } from 'vitest'
import { GROUND, KEY, isMode, mode, onTheme, resolve, setMode, theme } from './theme'
import src from '../public/theme.js?raw'

const root = () => document.documentElement
const meta = () => document.querySelector('meta[name="theme-color"]')!

beforeEach(() => {
  localStorage.clear()
  document.head.innerHTML = '<meta name="theme-color" content="#000000">'
  setMode('system')
})

describe('resolve', () => {
  it('follows the device only in the system mode', () => {
    expect(resolve('system', true)).toBe('light')
    expect(resolve('system', false)).toBe('dark')
    expect(resolve('light', false)).toBe('light')
    expect(resolve('dark', true)).toBe('dark')
  })
})

describe('isMode', () => {
  it('accepts the three modes and nothing else', () => {
    expect(['system', 'light', 'dark'].every(isMode)).toBe(true)
    expect([null, '', 'Light', 'auto', 1].some(isMode)).toBe(false)
  })
})

describe('setMode', () => {
  it('names the theme on the root and tells the browser its ground', () => {
    setMode('light')
    expect(root().dataset.theme).toBe('light')
    expect(meta().getAttribute('content')).toBe(GROUND.light)
    setMode('dark')
    expect(root().dataset.theme).toBe('dark')
    expect(meta().getAttribute('content')).toBe(GROUND.dark)
  })

  it('remembers a choice, and forgets it when the reader goes back to the device', () => {
    setMode('light')
    expect(localStorage.getItem(KEY)).toBe('light')
    expect(mode()).toBe('light')
    setMode('system')
    expect(localStorage.getItem(KEY)).toBeNull()
    expect(mode()).toBe('system')
  })

  it('reads anything else in storage as no choice', () => {
    localStorage.setItem(KEY, 'sepia')
    expect(mode()).toBe('system')
  })

  it('keeps the choice for the tab when storage refuses it', () => {
    const refuse = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('denied') })
    try {
      setMode('light')
      expect(mode()).toBe('light')
      expect(theme()).toBe('light')
      expect(root().dataset.theme).toBe('light')
    } finally {
      refuse.mockRestore()
      setMode('system')
    }
  })

  it('lets another tab\'s choice win over one this tab could not store', () => {
    const refuse = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('denied') })
    try {
      setMode('light')
    } finally {
      refuse.mockRestore()
    }
    localStorage.setItem(KEY, 'dark')
    dispatchEvent(new StorageEvent('storage', { key: KEY, newValue: 'dark' }))
    expect(mode()).toBe('dark')
    expect(root().dataset.theme).toBe('dark')
    setMode('system')
  })

  it('tells its listeners, until they stop listening', () => {
    const fn = vi.fn()
    const stop = onTheme(fn)
    setMode('light')
    expect(fn).toHaveBeenCalledTimes(1)
    stop()
    setMode('dark')
    expect(fn).toHaveBeenCalledTimes(1)
  })
})

// public/theme.js runs before the app and cannot import this module, so the
// two are held together here
describe('the script that runs before the first paint', () => {
  const run = () => new Function(src)()

  it('uses the same key and the same two grounds', () => {
    expect(src).toContain(`'${KEY}'`)
    expect(src).toContain(GROUND.light)
    expect(src).toContain(GROUND.dark)
  })

  it('names the stored theme on the root', () => {
    localStorage.setItem(KEY, 'light')
    delete root().dataset.theme
    run()
    expect(root().dataset.theme).toBe('light')
    expect(meta().getAttribute('content')).toBe(GROUND.light)
    localStorage.setItem(KEY, 'dark')
    run()
    expect(root().dataset.theme).toBe('dark')
    expect(meta().getAttribute('content')).toBe(GROUND.dark)
  })

  it('agrees with the module when nothing is stored', () => {
    delete root().dataset.theme
    run()
    expect(root().dataset.theme).toBe(theme())
  })
})
