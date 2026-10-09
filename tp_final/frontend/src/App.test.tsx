// @vitest-environment jsdom
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { User, UserManager } from 'oidc-client-ts'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as api from './api'
import { App } from './App'
import { encodeBase64Url } from './crypto/base64url'
import * as v1 from './crypto/v1'

vi.mock('./api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./api')>()
  return { ...actual, consumeShare: vi.fn() }
})
vi.mock('./crypto/v1', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./crypto/v1')>()
  return { ...actual, decryptV1: vi.fn() }
})

const userManager = {
  signinPopup: vi.fn(),
  removeUser: vi.fn(),
  signinPopupCallback: vi.fn(),
} as unknown as UserManager

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('App', () => {
  it('refuses to run outside a secure context', () => {
    vi.stubGlobal('isSecureContext', false)
    render(<App userManager={userManager} />)
    expect(screen.getByRole('alert')).toHaveTextContent('contexto seguro')
  })

  it('refuses to run without WebCrypto', () => {
    vi.stubGlobal('isSecureContext', true)
    vi.stubGlobal('crypto', {})
    render(<App userManager={userManager} />)
    expect(screen.getByRole('alert')).toHaveTextContent('contexto seguro')
  })

  it('renders the create page at / in a secure context', () => {
    vi.stubGlobal('isSecureContext', true)
    vi.stubGlobal('crypto', { subtle: { encrypt: vi.fn() }, getRandomValues: vi.fn() })
    window.history.replaceState(null, '', '/')
    render(<App userManager={userManager} />)
    expect(screen.getByRole('heading', { name: 'Compartir un secreto' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Administración' })).toHaveAttribute('href', '/admin')
  })

  it('starts over when a different link is pasted into an open /s tab', async () => {
    vi.stubGlobal('isSecureContext', true)
    vi.stubGlobal('crypto', { subtle: { encrypt: vi.fn() }, getRandomValues: vi.fn() })
    const user = {
      access_token: 'oidc-token',
      expired: false,
      expires_in: 300,
      profile: { preferred_username: 'bgonzalez' },
    }
    const manager = {
      signinPopup: vi.fn().mockResolvedValue(user as unknown as User),
      removeUser: vi.fn(),
      signinPopupCallback: vi.fn(),
    } as unknown as UserManager
    const consumeShare = vi.mocked(api.consumeShare)
    const decryptV1 = vi.mocked(v1.decryptV1)
    consumeShare.mockReset().mockResolvedValue({ crypto_version: 1, ciphertext: 'ct', nonce: 'nn' })
    decryptV1.mockReset().mockResolvedValueOnce('secret A').mockResolvedValueOnce('secret B')
    const cek = encodeBase64Url(new Uint8Array(32).fill(9))
    const tokenA = encodeBase64Url(new Uint8Array(32).fill(1))
    const tokenB = encodeBase64Url(new Uint8Array(32).fill(2))

    window.history.replaceState(null, '', `/s#v=1&t=${tokenA}&k=${cek}`)
    render(<App userManager={manager} />)
    await userEvent.click(screen.getAllByRole('button', { name: 'Iniciar sesión' })[0])
    await userEvent.click(await screen.findByRole('button', { name: 'Revelar secreto' }))
    expect(await screen.findByLabelText('Secreto revelado')).toHaveValue('secret A')

    // Pasting a link that differs only in the fragment does not reload the page.
    await act(async () => {
      window.location.hash = `#v=1&t=${tokenB}&k=${cek}`
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    expect(screen.queryByLabelText('Secreto revelado')).not.toBeInTheDocument()
    expect(screen.queryByText('secret A')).not.toBeInTheDocument()
    await userEvent.click(await screen.findByRole('button', { name: 'Revelar secreto' }))
    expect(await screen.findByLabelText('Secreto revelado')).toHaveValue('secret B')
    expect(consumeShare).toHaveBeenCalledTimes(2)
    expect(consumeShare).toHaveBeenLastCalledWith('oidc-token', tokenB)
  })
})
