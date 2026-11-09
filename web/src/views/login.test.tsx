import { render } from 'preact'
import { act } from 'preact/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Login } from './login'
import type { Session } from '../types'

const session: Session = { auth: 'password', authenticated: false, title: 'pi', demo: false, version: 'test' }

type Call = [string, { body: string }]
function setup(status: number, body: object = {}) {
  const fetch = vi.fn(async (..._args: Call) => ({ ok: status < 300, status, json: async () => body }))
  vi.stubGlobal('fetch', fetch)
  const done = vi.fn()
  const root = document.createElement('div')
  document.body.append(root)
  act(() => render(<Login session={session} onDone={done} />, root))
  const user = root.querySelector<HTMLInputElement>('input#username')!
  const pass = root.querySelector<HTMLInputElement>('input#password')!
  const button = root.querySelector<HTMLButtonElement>('button[type=submit]')!
  return { fetch, done, root, user, pass, button }
}

afterEach(() => {
  vi.unstubAllGlobals()
  document.body.innerHTML = ''
})

describe('login form', () => {
  it('is a real login form a password manager can file as one entry', () => {
    const { root, user, pass } = setup(204)
    expect(root.querySelector('form')).not.toBeNull()
    expect([user.name, user.autocomplete, user.type]).toEqual(['username', 'username', 'text'])
    expect([pass.name, pass.autocomplete, pass.type]).toEqual(['password', 'current-password', 'password'])
  })

  it('signs in with values filled the way Bitwarden fills them: no key or input events', async () => {
    const { fetch, done, user, pass, button } = setup(204)
    user.value = 'alex'
    pass.value = 'correct horse battery staple'
    expect(button.disabled).toBe(false)
    await act(async () => button.click())
    await vi.waitFor(() => expect(done).toHaveBeenCalledOnce())
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ username: 'alex', password: 'correct horse battery staple' })
  })

  it('keeps the button live with empty fields and says which one is missing', async () => {
    const { fetch, root, button, user } = setup(204)
    expect(button.disabled).toBe(false)
    await act(async () => button.click())
    expect(fetch).not.toHaveBeenCalled()
    expect(root.querySelector('[role=alert]')!.textContent).toBe('Enter your username.')
    expect(document.activeElement).toBe(user)
  })

  it('on a wrong login clears only the password and does not say which half was wrong', async () => {
    const { root, user, pass, button, done } = setup(401, { error: 'wrong username or password' })
    user.value = 'alex'
    pass.value = 'not it'
    await act(async () => button.click())
    await vi.waitFor(() => expect(root.querySelector('[role=alert]')!.textContent).toBe('That username or password is not right.'))
    expect([user.value, pass.value]).toEqual(['alex', ''])
    expect(done).not.toHaveBeenCalled()
  })
})
