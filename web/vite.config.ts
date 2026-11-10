import { copyFileSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig, type Plugin } from 'vite'
import preact from '@preact/preset-vite'

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url))

/**
 * The live demo (`make pages`): the same UI, with src/demo standing where the
 * server would be. The swap is made here, while building, so the build that
 * goes into the binary has no demo code in it to switch on.
 */
function demoSite(site: string): Plugin {
  const swap = new Map([
    [here('./src/api.ts'), here('./src/demo/api.ts')],
    [here('./src/main.tsx'), here('./src/demo/main.tsx')],
  ])
  const about = 'Vesper is a read-only operations dashboard for a home server. This is its real interface on a made-up server, generated in your browser.'
  let out = ''
  return {
    name: 'vesper-demo-site',
    enforce: 'pre',
    configResolved(c) {
      out = resolve(c.root, c.build.outDir)
    },
    async resolveId(source, importer, options) {
      const found = await this.resolve(source, importer, { ...options, skipSelf: true })
      return (found && swap.get(found.id.split('?')[0])) || null
    },
    transformIndexHtml: {
      order: 'pre',
      handler(html) {
        const meta = (key: 'name' | 'property', id: string, content: string) => ({ tag: 'meta', attrs: { [key]: id, content }, injectTo: 'head' as const })
        // a public page: findable, and with a card when its link is shared
        const robots = /^\s*<meta name="robots"[^>]*>\n/m
        const title = '<title>Vesper</title>'
        if (!robots.test(html) || !html.includes(title)) throw new Error('index.html changed: the demo build no longer finds its robots meta or its title')
        return {
          html: html.replace(robots, '').replace(title, '<title>Vesper live demo</title>'),
          tags: [
            meta('name', 'description', about),
            meta('property', 'og:type', 'website'),
            meta('property', 'og:title', 'Vesper live demo'),
            meta('property', 'og:description', about),
            meta('property', 'og:url', site),
            meta('property', 'og:image', site + 'social.png'),
            meta('name', 'twitter:card', 'summary_large_image'),
          ],
        }
      },
    },
    closeBundle() {
      // the page may live under any path, so the installed app starts beside its manifest
      const file = join(out, 'manifest.webmanifest')
      const m = JSON.parse(readFileSync(file, 'utf8'))
      m.start_url = '.'
      m.scope = '.'
      for (const icon of m.icons) icon.src = icon.src.replace(/^\//, '')
      writeFileSync(file, JSON.stringify(m, null, 2) + '\n')
      copyFileSync(here('../docs/readme/social.png'), join(out, 'social.png'))
    },
  }
}

export default defineConfig(({ mode }) => {
  const pages = mode === 'pages'
  const site = (process.env.SITE_URL || 'https://gallowforge.github.io/vesper/').replace(/\/*$/, '/')
  return {
    plugins: [preact(), ...(pages ? [demoSite(site)] : [])],
    // the demo's links are relative, so it works under /vesper/ or any other path
    base: pages ? './' : '/',
    // the version the demo shows in the sidebar; the binary gets its own from the server
    define: { __VESPER_VERSION__: JSON.stringify(process.env.VERSION || 'dev') },
    build: {
      // the app's build lands inside the Go module, which embeds it into the binary
      outDir: pages ? '../pages' : '../internal/web/ui/dist',
      emptyOutDir: true,
      target: 'es2022',
      assetsInlineLimit: 0,
      cssCodeSplit: false,
      reportCompressedSize: false,
    },
    server: {
      proxy: { '/api': 'http://127.0.0.1:8080', '/healthz': 'http://127.0.0.1:8080' },
    },
    test: { environment: 'jsdom' },
  }
})
