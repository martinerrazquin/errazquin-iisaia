// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { TestAuthProvider } from '../test/auth'
import { LoginPrompt } from './LoginPrompt'

describe('LoginPrompt', () => {
  it('explains a blocked or closed popup and stays usable', async () => {
    render(
      <TestAuthProvider loginSucceeds={false}>
        <LoginPrompt message="Iniciá sesión." />
      </TestAuthProvider>,
    )
    await userEvent.click(screen.getByRole('button', { name: 'Iniciar sesión' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('bloqueó la ventana emergente')
    expect(screen.getByRole('button', { name: 'Iniciar sesión' })).toBeEnabled()
  })

  it('notifies the caller after a successful login', async () => {
    const onLoggedIn = vi.fn()
    render(
      <TestAuthProvider>
        <LoginPrompt message="Iniciá sesión." onLoggedIn={onLoggedIn} />
      </TestAuthProvider>,
    )
    await userEvent.click(screen.getByRole('button', { name: 'Iniciar sesión' }))
    await vi.waitFor(() => expect(onLoggedIn).toHaveBeenCalledTimes(1))
  })
})
