// @vitest-environment jsdom
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { User } from 'oidc-client-ts'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as api from '../../api'
import { ApiError } from '../../api'
import { AuthContext } from '../../auth/context'
import { formatDateTime } from '../../i18n/format'
import { TestAuthProvider } from '../../test/auth'
import { AdminPage } from './AdminPage'

vi.mock('../../api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../api')>()
  return { ...actual, listAdminShares: vi.fn() }
})

const listAdminShares = vi.mocked(api.listAdminShares)

const ITEM = {
  id: 'share-1',
  creator_identity: 'aperez',
  label: 'Staging DB',
  created_at: '2026-10-08T20:00:00Z',
  expires_at: '2999-01-01T00:00:00Z',
  revoked_at: null,
  payload_deleted_at: null,
  grants: [
    { recipient_identity: 'bgonzalez', consumed_at: '2026-10-08T20:05:00Z' },
    { recipient_identity: 'csaul', consumed_at: null },
  ],
}

function renderPage(onExpire = vi.fn()) {
  render(
    <TestAuthProvider initialToken="admin-token" username="flapinto" onExpire={onExpire}>
      <AdminPage />
    </TestAuthProvider>,
  )
  return { onExpire }
}

beforeEach(() => {
  listAdminShares.mockReset()
})

describe('AdminPage', () => {
  it('lists share metadata and grant states', async () => {
    listAdminShares.mockResolvedValue({ items: [ITEM], page: 1, page_size: 50, total: 1 })
    renderPage()
    expect(await screen.findByText('Staging DB')).toBeInTheDocument()
    expect(screen.getByText('aperez')).toBeInTheDocument()
    expect(screen.getByText('Activo')).toBeInTheDocument()
    expect(screen.getByText('Obtenidos: 1 de 2')).toBeInTheDocument()
    expect(listAdminShares).toHaveBeenCalledWith('admin-token', 1, 50)

    // Recipients sit in a collapsed row that the +/− button opens.
    const toggle = screen.getByRole('button', { name: 'Mostrar destinatarios' })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('cell', { name: 'csaul' })).not.toBeInTheDocument()
    await userEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    const bgonzalez = screen.getByRole('cell', { name: 'bgonzalez' }).closest('tr')!
    expect(bgonzalez).toHaveTextContent('Obtenido')
    expect(bgonzalez).toHaveTextContent(formatDateTime(ITEM.grants[0].consumed_at!))
    const csaul = screen.getByRole('cell', { name: 'csaul' }).closest('tr')!
    expect(csaul).toHaveTextContent('Pendiente')
    expect(csaul).toHaveTextContent('—')
    await userEvent.click(toggle)
    expect(screen.queryByRole('cell', { name: 'csaul' })).not.toBeInTheDocument()
  })

  it('marks unused grants of a closed share as not obtained', async () => {
    listAdminShares.mockResolvedValue({
      items: [{ ...ITEM, expires_at: '2026-10-08T21:00:00Z' }],
      page: 1,
      page_size: 50,
      total: 1,
    })
    renderPage()
    await userEvent.click(await screen.findByRole('button', { name: 'Mostrar destinatarios' }))
    expect(screen.getByRole('cell', { name: 'csaul' }).closest('tr')).toHaveTextContent('No obtenido')
  })

  it('paginates', async () => {
    listAdminShares.mockResolvedValue({ items: [ITEM], page: 1, page_size: 50, total: 120 })
    renderPage()
    await screen.findByText('Staging DB')
    expect(screen.getByRole('button', { name: 'Anterior' })).toBeDisabled()
    listAdminShares.mockResolvedValue({ items: [ITEM], page: 2, page_size: 50, total: 120 })
    await userEvent.click(screen.getByRole('button', { name: 'Siguiente' }))
    expect(listAdminShares).toHaveBeenLastCalledWith('admin-token', 2, 50)
    expect(await screen.findByText(/Página 2 de 3/)).toBeInTheDocument()
  })

  it('refreshes the current page in place', async () => {
    listAdminShares.mockResolvedValue({ items: [ITEM], page: 1, page_size: 50, total: 1 })
    renderPage()
    await screen.findByText('Staging DB')

    let resolve!: (value: Awaited<ReturnType<typeof api.listAdminShares>>) => void
    listAdminShares.mockReturnValue(new Promise((r) => (resolve = r)))
    const refresh = screen.getByRole('button', { name: 'Actualizar' })
    await userEvent.click(refresh)
    // The current table stays while the same page reloads.
    expect(refresh).toBeDisabled()
    expect(screen.getByText('Staging DB')).toBeInTheDocument()
    expect(listAdminShares).toHaveBeenLastCalledWith('admin-token', 1, 50)

    await act(async () => resolve({ items: [{ ...ITEM, label: 'Prod DB' }], page: 1, page_size: 50, total: 1 }))
    expect(screen.getByText('Prod DB')).toBeInTheDocument()
    expect(refresh).toBeEnabled()
    expect(listAdminShares).toHaveBeenCalledTimes(2)
  })

  it('shows an empty state', async () => {
    listAdminShares.mockResolvedValue({ items: [], page: 1, page_size: 50, total: 0 })
    renderPage()
    expect(await screen.findByText('Todavía no se compartieron secretos.')).toBeInTheDocument()
  })

  it('explains a 403 in Spanish', async () => {
    listAdminShares.mockRejectedValue(new ApiError(403, 'admin_access_required'))
    renderPage()
    expect(await screen.findByRole('alert')).toHaveTextContent('No tenés permisos de administración.')
  })

  it('drops the session on 401', async () => {
    listAdminShares.mockRejectedValue(new ApiError(401, 'invalid_authentication'))
    const { onExpire } = renderPage()
    await vi.waitFor(() => expect(onExpire).toHaveBeenCalled())
  })

  it('expires the session instead of spinning when the token lapses before changing page', async () => {
    listAdminShares.mockResolvedValue({ items: [ITEM], page: 1, page_size: 50, total: 120 })
    let token: string | null = 'admin-token'
    const expireSession = vi.fn()
    const value = {
      user: { access_token: 'admin-token', profile: { preferred_username: 'flapinto' } } as unknown as User,
      getAccessToken: () => token,
      login: async () => true,
      logout: async () => {},
      expireSession,
    }
    render(
      <AuthContext.Provider value={value}>
        <AdminPage />
      </AuthContext.Provider>,
    )
    await screen.findByText('Staging DB')
    expect(expireSession).not.toHaveBeenCalled()
    token = null
    await userEvent.click(screen.getByRole('button', { name: 'Siguiente' }))
    expect(expireSession).toHaveBeenCalled()
    expect(listAdminShares).toHaveBeenCalledTimes(1)
    expect(listAdminShares).not.toHaveBeenCalledWith(expect.anything(), 2, 50)
  })
})
