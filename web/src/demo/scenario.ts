// The demo's one choice: which of the generator's four scenarios is on show.
// It lives in the address (?scenario=incident), so a link opens on the same one.

export const SCENARIOS = [['calm', 'Calm'], ['attention', 'Attention'], ['incident', 'Incident'], ['blind', 'Blind']] as const
export type Scenario = (typeof SCENARIOS)[number][0]
/** What `vesper demo` shows when it is not told otherwise. */
export const DEFAULT: Scenario = 'attention'

export function parseScenario(v: string | null): Scenario {
  return SCENARIOS.some(([k]) => k === v) ? (v as Scenario) : DEFAULT
}

/** ?at=<RFC 3339 time> holds the generator's clock still, as `vesper demo -at` does. */
export function parseAt(v: string | null): number | null {
  if (!v) return null
  const t = Date.parse(v)
  return Number.isFinite(t) ? t : null
}

const query = () => new URLSearchParams(location.search)

let current = parseScenario(query().get('scenario'))
const subs = new Set<(s: Scenario) => void>()

export const getScenario = (): Scenario => current
export const frozenAt = (): number | null => parseAt(query().get('at'))

export function setScenario(s: Scenario) {
  if (s === current) return
  current = s
  const u = new URL(location.href)
  if (s === DEFAULT) u.searchParams.delete('scenario')
  else u.searchParams.set('scenario', s)
  history.replaceState(history.state, '', u) // the page (the part after #) stays where it is
  subs.forEach((fn) => fn(s))
}

export function onScenario(fn: (s: Scenario) => void): () => void {
  subs.add(fn)
  return () => {
    subs.delete(fn)
  }
}
