// Loads the generator behind `vesper demo`, built for WebAssembly
// (cmd/vesper-wasm), once. Both files sit beside the page.

export interface Engine {
  /** The state as the JSON the server would send, or "" if it cannot be made. */
  snapshot(scenario: string, unixMillis: number): string
  /** A runbook's Markdown, or null if there is none by that name. */
  runbook(id: string): string | null
}

interface GoRuntime {
  importObject: WebAssembly.Imports
  run(instance: WebAssembly.Instance): Promise<void>
}

declare global {
  /** Go's loader, wasm_exec.js. */
  var Go: (new () => GoRuntime) | undefined
  /** Set by the generator when it starts. */
  var vesperDemo: Engine | undefined
}

const beside = (file: string) => new URL(file, document.baseURI).href

function script(src: string): Promise<void> {
  return new Promise((done, fail) => {
    const s = document.createElement('script')
    s.src = src
    s.onload = () => done()
    s.onerror = () => fail(new Error(`${src} did not load`))
    document.head.append(s)
  })
}

async function instantiate(url: string, imports: WebAssembly.Imports): Promise<WebAssembly.Instance> {
  // compiling while it downloads needs the host to name the type; any other host gets the plain way
  if (typeof WebAssembly.instantiateStreaming === 'function') {
    try {
      return (await WebAssembly.instantiateStreaming(fetch(url), imports)).instance
    } catch {
      /* fall through */
    }
  }
  const r = await fetch(url)
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`)
  return (await WebAssembly.instantiate(await r.arrayBuffer(), imports)).instance
}

async function start(): Promise<Engine> {
  if (globalThis.vesperDemo) return globalThis.vesperDemo
  if (typeof WebAssembly !== 'object') throw new Error('this browser has no WebAssembly')
  if (!globalThis.Go) await script(beside('wasm_exec.js'))
  if (!globalThis.Go) throw new Error('wasm_exec.js did not define Go')
  const go = new globalThis.Go()
  const instance = await instantiate(beside('demo.wasm'), go.importObject)
  // run() resolves when the program exits, and this one stays loaded for as
  // long as the page is open; its main has set vesperDemo by the time it parks
  void go.run(instance)
  for (let i = 0; i < 1000 && !globalThis.vesperDemo; i++) await new Promise((r) => setTimeout(r, 10))
  if (!globalThis.vesperDemo) throw new Error('the generator did not start')
  return globalThis.vesperDemo
}

let loading: Promise<Engine> | null = null

/** The generator, loaded on the first call. A failed load can be tried again. */
export function engine(): Promise<Engine> {
  loading ??= start().catch((e) => {
    loading = null
    throw e
  })
  return loading
}

/** The generator if it is already loaded. */
export const loaded = (): Engine | null => globalThis.vesperDemo ?? null
