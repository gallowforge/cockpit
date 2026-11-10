#!/usr/bin/env node
// The live demo runs the generator in a browser. This proves that build says
// exactly what `vesper demo` says: for every scenario, at the same moment, the
// two snapshots are equal, and every runbook the snapshot lists can be read.
//
//   node scripts/wasm-parity.mjs [pages dir] [vesper binary]     after: make build pages
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import { pathToFileURL } from 'node:url'

const pages = resolve(process.argv[2] ?? 'pages')
const binary = resolve(process.argv[3] ?? 'bin/vesper')

await import(pathToFileURL(join(pages, 'wasm_exec.js')).href) // defines globalThis.Go
const go = new globalThis.Go()
const { instance } = await WebAssembly.instantiate(readFileSync(join(pages, 'demo.wasm')), go.importObject)
void go.run(instance)
const demo = globalThis.vesperDemo
if (!demo) throw new Error('the generator did not start')

// one time on the second, and one inside a second (the generator rounds down, as the server's clock does)
const times = ['2026-03-10T10:42:00Z', '2026-07-04T23:59:59.640Z']
const dir = mkdtempSync(join(tmpdir(), 'vesper-parity-'))
let failed = 0
try {
  for (const scenario of ['calm', 'attention', 'incident', 'blind']) {
    for (const at of times) {
      const file = join(dir, 'state.json')
      execFileSync(binary, ['demo', '-scenario', scenario, '-at', at, '-write', file])
      const native = JSON.parse(readFileSync(file, 'utf8'))
      const wasm = JSON.parse(demo.snapshot(scenario, Date.parse(at)))
      const same = isDeepStrictEqual(wasm, native)
      if (!same) failed++
      console.log(`${same ? 'ok  ' : 'FAIL'}  ${scenario.padEnd(9)} ${at}  ${wasm.services?.length ?? 0} services`)
      for (const rb of native.runbooks ?? []) {
        const body = demo.runbook(rb.id)
        const bytes = body == null ? -1 : Buffer.byteLength(body)
        if (bytes !== rb.bytes) {
          failed++
          console.log(`FAIL  runbook ${rb.id}: ${bytes} bytes, the snapshot lists ${rb.bytes}`)
        }
      }
    }
  }
  if (demo.runbook('no-such-runbook') !== null) {
    failed++
    console.log('FAIL  a runbook that does not exist was served')
  }
} finally {
  rmSync(dir, { recursive: true, force: true })
}
console.log(failed ? `${failed} difference(s) between the browser build and vesper demo` : 'the browser build and vesper demo agree')
process.exit(failed ? 1 : 0) // the generator stays loaded, so the process is ended here
