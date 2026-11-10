import { expect, it } from 'vitest'

// The demo reaches the app only through the pages build's swap (vite.config.ts).
// If app code imported it directly, the binary would carry demo code.
const sources = import.meta.glob<string>('../**/*.{ts,tsx}', { query: '?raw', import: 'default', eager: true })

it('nothing outside demo/ imports from it', () => {
  const app = Object.entries(sources).filter(([path]) => path.startsWith('../'))
  expect(app.length).toBeGreaterThan(20)
  const reaching = app.filter(([, text]) => /(?:from|import)\s*\(?\s*['"][^'"\n]*\bdemo\/[^'"\n]*['"]/.test(text)).map(([path]) => path)
  expect(reaching).toEqual([])
})
