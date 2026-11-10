import { useEffect, useState } from 'preact/hooks'
import { IconExternal } from '../components/icons'
import { Seg } from '../components/ui'
import { getScenario, onScenario, SCENARIOS, setScenario } from './scenario'

/** The one line above the app that says what this page is. It is not part of
 *  Vesper: everything under it is the interface the binary serves. */
export function DemoBar() {
  const [scenario, set] = useState(getScenario)
  useEffect(() => onScenario(set), [])
  return (
    <>
      <span class="tag">LIVE DEMO</span>
      <p>
        A made-up server<span class="demo-more">, generated in this tab by the same code as <code>vesper demo</code></span>. Nothing is sent anywhere.
      </p>
      <Seg label="Scenario" options={SCENARIOS} value={scenario} onChange={setScenario} />
      <a class="demo-src" href="https://github.com/gallowforge/vesper">Source<IconExternal size={13} /></a>
    </>
  )
}
