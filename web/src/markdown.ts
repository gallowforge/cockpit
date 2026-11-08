// Runbooks are Markdown files from the server. They are rendered with raw HTML
// escaped, links limited to safe schemes and images reduced to their alt text,
// so a runbook can never run script in the dashboard.
import { Marked, type Tokens } from 'marked'

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')

export function safeHref(href: string): string | null {
  const h = href.trim()
  if (/^(https?:|mailto:)/i.test(h)) return h
  if (/^[a-z][a-z0-9+.-]*:/i.test(h)) return null // javascript:, data:, vbscript: ...
  return h // relative or #anchor
}

export function slug(text: string): string {
  return text
    .toLowerCase()
    .replace(/<[^>]+>/g, '')
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
}

const md = new Marked({ gfm: true, breaks: false })
md.use({
  renderer: {
    html(token: Tokens.HTML | Tokens.Tag) {
      return esc(token.text)
    },
    link(token: Tokens.Link) {
      const href = safeHref(token.href)
      const text = this.parser.parseInline(token.tokens)
      if (!href) return text
      const ext = /^https?:/i.test(href)
      return `<a href="${esc(href)}"${ext ? ' target="_blank" rel="noopener noreferrer"' : ''}>${text}</a>`
    },
    image(token: Tokens.Image) {
      return `<span class="md-img">[${esc(token.text || 'image')}]</span>`
    },
    heading(token: Tokens.Heading) {
      const text = this.parser.parseInline(token.tokens)
      return `<h${token.depth} id="${esc(slug(token.text))}">${text}</h${token.depth}>\n`
    },
  },
})

export function renderMarkdown(src: string): string {
  return md.parse(src, { async: false }) as string
}

/** The level-2 headings, for the runbook's table of contents. */
export function outline(src: string): { id: string; text: string }[] {
  const out: { id: string; text: string }[] = []
  let fence = false
  for (const line of src.split('\n')) {
    if (/^\s*```/.test(line)) fence = !fence
    if (fence) continue
    const m = /^##\s+(.+?)\s*#*\s*$/.exec(line)
    if (m) out.push({ id: slug(m[1]), text: m[1].replace(/[*_`]/g, '') })
  }
  return out
}
