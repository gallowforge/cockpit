import { describe, expect, it } from 'vitest'
import { outline, renderMarkdown, safeHref, slug } from './markdown'

describe('runbook markdown', () => {
  it('escapes raw HTML', () => {
    const html = renderMarkdown('Hello <script>alert(1)</script> <img src=x onerror=alert(1)>')
    expect(html).not.toContain('<script>')
    expect(html).not.toContain('<img')
    expect(html).toContain('&lt;script&gt;')
  })
  it('drops dangerous link schemes', () => {
    expect(renderMarkdown('[x](javascript:alert(1))')).not.toContain('href')
    expect(renderMarkdown('[x](data:text/html,hi)')).not.toContain('href')
    expect(safeHref('JaVaScRiPt:alert(1)')).toBeNull()
    expect(safeHref('#restore')).toBe('#restore')
    expect(safeHref('https://example.com/a')).toBe('https://example.com/a')
  })
  it('opens external links safely', () => {
    expect(renderMarkdown('[docs](https://example.com)')).toContain('rel="noopener noreferrer"')
  })
  it('reduces images to their alt text', () => {
    expect(renderMarkdown('![diagram](https://example.com/x.png)')).toContain('[diagram]')
  })
  it('renders tables and code', () => {
    const html = renderMarkdown('| a | b |\n|---|---|\n| 1 | 2 |\n\n```bash\nsudo x\n```')
    expect(html).toContain('<table>')
    expect(html).toContain('<code class="language-bash">')
  })
  it('gives headings ids and builds an outline that skips code blocks', () => {
    expect(renderMarkdown('## Before you start')).toContain('id="before-you-start"')
    expect(outline('# T\n## One\n```\n## not a heading\n```\n## Two *x*')).toEqual([
      { id: 'one', text: 'One' },
      { id: 'two-x', text: 'Two x' },
    ])
    expect(slug('Restore one set!')).toBe('restore-one-set')
  })
})
