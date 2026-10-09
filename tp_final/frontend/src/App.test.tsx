// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import type { UserManager } from 'oidc-client-ts'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { App } from './App'

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
})
