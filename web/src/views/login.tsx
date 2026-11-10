import { useEffect, useRef, useState } from 'preact/hooks'
import type { Session } from '../types'
import { login } from '../api'
import { Mark } from '../components/icons'

// A real login form, so password managers (Bitwarden and the rest) save and fill
// one complete login. They fill fields without typing, so nothing here waits for
// key or input events: the fields are uncontrolled, the button is never disabled
// because a field looks empty, and the values are read when the form is sent.
export function Login({ session, onDone }: { session: Session; onDone: () => void }) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [wait, setWait] = useState(0)
  const user = useRef<HTMLInputElement>(null)
  const pass = useRef<HTMLInputElement>(null)

  useEffect(() => (user.current?.value ? pass.current : user.current)?.focus(), [])
  useEffect(() => {
    if (wait <= 0) return
    const t = setTimeout(() => setWait((w) => w - 1), 1000)
    return () => clearTimeout(t)
  }, [wait])

  const submit = async (e: Event) => {
    e.preventDefault()
    if (busy || wait > 0) return
    const username = user.current?.value.trim() ?? ''
    const password = pass.current?.value ?? ''
    if (!username || !password) {
      setErr(username ? 'Enter your password.' : 'Enter your username.')
      ;(username ? pass : user).current?.focus()
      return
    }
    setBusy(true)
    setErr('')
    const r = await login(username, password).catch(() => ({ ok: false as const, error: 'The server did not answer.' }))
    setBusy(false)
    if (r.ok) {
      onDone()
      return
    }
    setErr(r.error)
    if ('retryAfter' in r && r.retryAfter) setWait(r.retryAfter)
    if (pass.current) {
      pass.current.value = ''
      pass.current.focus()
    }
  }

  return (
    <div class="login">
      <form class="login-card" method="post" action="/api/login" onSubmit={submit} noValidate>
        <Mark size={36} />
        <h1>Sign in to Vesper</h1>
        <p class="sub">for <b>{session.title}</b></p>
        <label class="field" for="username">
          <span>Username</span>
          <input ref={user} id="username" name="username" type="text" autocomplete="username"
            autocapitalize="none" autocorrect="off" spellcheck={false} required readOnly={busy} />
        </label>
        <label class="field" for="password">
          <span>Password</span>
          <input ref={pass} id="password" name="password" type="password" autocomplete="current-password"
            required readOnly={busy} />
        </label>
        <button class="btn primary" type="submit" disabled={busy || wait > 0}>
          {busy ? 'Checking…' : wait > 0 ? `Wait ${wait}s` : 'Sign in'}
        </button>
        <p class="login-err" role="alert">{err}</p>
        <p class="login-foot">Read-only. Nothing here can change the server.</p>
      </form>
    </div>
  )
}
