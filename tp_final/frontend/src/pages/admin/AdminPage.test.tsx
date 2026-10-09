// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as api from '../../api'
import { ApiError } from '../../api'
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
    expect(screen.getByText(/bgonzalez: obtenido/)).toBeInTheDocument()
    expect(screen.getByText(/csaul: pendiente/)).toBeInTheDocument()
    expect(screen.getByText('Activo')).toBeInTheDocument()
    expect(listAdminShares).toHaveBeenCalledWith('admin-token', 1, 50)
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
})
