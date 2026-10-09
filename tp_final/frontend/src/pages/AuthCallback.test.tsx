// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react'
import { StrictMode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import * as api from '../api'
import { AuthCallback } from './AuthCallback'

vi.mock('../api')

describe('AuthCallback', () => {
  it('completes the popup handshake once and never consumes', async () => {
    const manager = { signinPopupCallback: vi.fn(async () => undefined) }
    render(
      <StrictMode>
        <AuthCallback userManager={manager} />
      </StrictMode>,
    )
    await waitFor(() => expect(manager.signinPopupCallback).toHaveBeenCalledTimes(1))
    expect(api.consumeShare).not.toHaveBeenCalled()
  })

  it('shows a Spanish error when the handshake fails', async () => {
    const manager = { signinPopupCallback: vi.fn(async () => Promise.reject(new Error('state mismatch'))) }
    render(<AuthCallback userManager={manager} />)
    expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo completar el inicio de sesión')
  })
})
