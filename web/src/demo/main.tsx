// The live demo's entry: the pages build puts this file in ../main's place.
import { render } from 'preact'
import { useEffect, useState } from 'preact/hooks'
import '../styles.css'
import './demo.css'
import { App } from '../app'
import { Mark } from '../components/icons'
import { DemoBar } from './bar'
import { engine } from './engine'

// The app mounts once the generator is loaded, so it opens on a full page and
// never on a wait for a collector that this page does not have.
function Boot() {
  const [state, setState] = useState<'loading' | 'ready' | 'failed'>('loading')
  const start = () => {
    setState('loading')
    engine().then(() => setState('ready'), () => setState('failed'))
  }
  useEffect(start, [])
  if (state === 'ready') return <App />
  return (
    <div class="splash">
      <Mark size={44} />
      {state === 'failed' && (
        <>
          <p class="strong">The demo could not start.</p>
          <p class="muted">It runs Vesper's generator in this tab as WebAssembly, and this browser did not load it. The same demo runs on any machine with <code>vesper demo</code>.</p>
          <button type="button" class="btn" onClick={start}>Try again</button>
        </>
      )}
    </div>
  )
}

const root = document.documentElement
const bar = document.createElement('div')
bar.id = 'demo'
bar.setAttribute('role', 'region')
bar.setAttribute('aria-label', 'About this demo')
document.body.prepend(bar)
root.classList.add('demo')
// the app's own layout is measured from the foot of the bar (demo.css)
new ResizeObserver(() => root.style.setProperty('--demo-h', `${bar.offsetHeight}px`)).observe(bar)

render(<DemoBar />, bar)
render(<Boot />, document.getElementById('app')!)
