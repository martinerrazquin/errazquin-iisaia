// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { User } from 'oidc-client-ts'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { AuthProvider, type PopupUserManager } from './AuthProvider'
import { useAuth } from './context'

function fakeUser(overrides: Record<string, unknown> = {}): User {
  return {
    access_token: 'access-1',
    expired: false,
    expires_in: 300,
    profile: { preferred_username: 'aperez' },
    ...overrides,
  } as unknown as User
}

function Probe() {
  const auth = useAuth()
  const [result, setResult] = useState('')
  return (
    <div>
      <span data-testid="token">{auth.getAccessToken() ?? 'none'}</span>
      <span data-testid="result">{result}</span>
      <button onClick={() => void auth.login().then((ok) => setResult(ok ? 'ok' : 'failed'))}>login</button>
      <button onClick={auth.expireSession}>expire</button>
    </div>
  )
}

function renderWith(signinPopup: () => Promise<User>) {
  const manager = { signinPopup: vi.fn(signinPopup), removeUser: vi.fn(async () => {}) }
  render(
    <AuthProvider userManager={manager as unknown as PopupUserManager}>
      <Probe />
    </AuthProvider>,
  )
  return manager
}

describe('AuthProvider', () => {
  it('keeps the popup-authenticated user in memory', async () => {
    const manager = renderWith(async () => fakeUser())
    expect(screen.getByTestId('token')).toHaveTextContent('none')
    await userEvent.click(screen.getByText('login'))
    expect(await screen.findByText('access-1')).toBeInTheDocument()
    expect(screen.getByTestId('result')).toHaveTextContent('ok')
    expect(manager.signinPopup).toHaveBeenCalledTimes(1)
  })

  it('reports failure when the popup is closed or blocked', async () => {
    renderWith(async () => {
      throw new Error('Popup closed by user')
    })
    await userEvent.click(screen.getByText('login'))
    expect(await screen.findByText('failed')).toBeInTheDocument()
    expect(screen.getByTestId('token')).toHaveTextContent('none')
  })

  it.each([
    ['expired', { expired: true }],
    ['about to expire', { expires_in: 5 }],
  ])('treats an %s token as missing', async (_name, overrides) => {
    renderWith(async () => fakeUser(overrides))
    await userEvent.click(screen.getByText('login'))
    expect(await screen.findByText('ok')).toBeInTheDocument()
    expect(screen.getByTestId('token')).toHaveTextContent('none')
  })

  it('expireSession forgets the user', async () => {
    const manager = renderWith(async () => fakeUser())
    await userEvent.click(screen.getByText('login'))
    await screen.findByText('access-1')
    await userEvent.click(screen.getByText('expire'))
    expect(screen.getByTestId('token')).toHaveTextContent('none')
    expect(manager.removeUser).toHaveBeenCalled()
  })
})
