import { useEffect, useRef, useState } from 'preact/hooks'
import type { Session } from '../types'
import { login } from '../api'
import { Mark } from '../components/icons'

export function Login({ session, onDone }: { session: Session; onDone: () => void }) {
  const [pw, setPw] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [wait, setWait] = useState(0)
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => input.current?.focus(), [])
  useEffect(() => {
    if (wait <= 0) return
    const t = setTimeout(() => setWait((w) => w - 1), 1000)
    return () => clearTimeout(t)
  }, [wait])

  const submit = async (e: Event) => {
    e.preventDefault()
    if (!pw || busy || wait > 0) return
    setBusy(true)
    setErr('')
    const r = await login(pw).catch(() => ({ ok: false as const, error: 'The server did not answer.' }))
    setBusy(false)
    if (r.ok) {
      onDone()
      return
    }
    setErr(r.error)
    if ('retryAfter' in r && r.retryAfter) setWait(r.retryAfter)
    setPw('')
    input.current?.focus()
  }

  return (
    <div class="login">
      <div class="login-glow" />
      <form class="login-card" onSubmit={submit}>
        <Mark size={48} />
        <h1>Cockpit</h1>
        <p class="muted">Sign in to <b>{session.title}</b></p>
        {/* a username field helps password managers file the entry */}
        <input type="text" name="username" autocomplete="username" value="cockpit" hidden readOnly />
        <label class="field">
          <span>Password</span>
          <input
            ref={input}
            type="password"
            name="password"
            autocomplete="current-password"
            value={pw}
            onInput={(e) => setPw((e.target as HTMLInputElement).value)}
            disabled={busy}
          />
        </label>
        <button class="btn btn-primary" type="submit" disabled={busy || !pw || wait > 0}>
          {busy ? 'Checking…' : wait > 0 ? `Wait ${wait}s` : 'Sign in'}
        </button>
        <p class={`login-err${err ? ' on' : ''}`} role="alert">{err}</p>
        <p class="login-foot">Read-only dashboard · nothing here can change the server</p>
      </form>
    </div>
  )
}
