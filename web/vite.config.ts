import { defineConfig } from 'vite'
import preact from '@preact/preset-vite'

// The build lands inside the Go module, which embeds it into the binary.
export default defineConfig({
  plugins: [preact()],
  build: {
    outDir: '../internal/web/ui/dist',
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
})
