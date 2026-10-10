// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as api from '../../api'
import { ApiError } from '../../api'
import { errorMessages } from '../../i18n/messages'
import { TestAuthProvider } from '../../test/auth'
import { CreatePage } from './CreatePage'

const CEK = 'C'.repeat(43)

vi.mock('../../crypto/v1', () => ({
  CRYPTO_VERSION: 1,
  encryptV1: vi.fn(async () => ({ cek: 'C'.repeat(43), nonce: 'N'.repeat(16), ciphertext: 'X'.repeat(30) })),
}))

vi.mock('../../api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../api')>()
  return { ...actual, createShare: vi.fn() }
})

const createShare = vi.mocked(api.createShare)

const RESPONSE = {
  share_id: 'id',
  crypto_version: 1,
  created_at: '2026-10-08T20:00:00Z',
  expires_at: '2026-10-08T21:00:00Z',
  grants: [
    { recipient: 'bgonzalez', access_token: 'T'.repeat(43) },
    { recipient: 'csaul', access_token: 'U'.repeat(43) },
  ],
}

const SHARED_RESPONSE = {
  ...RESPONSE,
  grants: RESPONSE.grants.map(({ recipient }) => ({ recipient, access_token: 'S'.repeat(43) })),
}

function renderPage(initialToken: string | null = 'oidc-token', onExpire = vi.fn()) {
  render(
    <TestAuthProvider initialToken={initialToken} onExpire={onExpire}>
      <CreatePage />
    </TestAuthProvider>,
  )
  return { onExpire }
}

/** Renders with a session that the test can make lapse later (the page has then already shown the form). */
function renderExpiringPage({ loginSucceeds = true } = {}) {
  const page = (tokenExpired: boolean) => (
    <TestAuthProvider initialToken="oidc-token" tokenExpired={tokenExpired} loginSucceeds={loginSucceeds}>
      <CreatePage />
    </TestAuthProvider>
  )
  const { rerender } = render(page(false))
  return { expire: () => rerender(page(true)) }
}

function fillForm(plaintext = 'hunter2', recipients = ' BGonzalez, csaul ') {
  fireEvent.change(screen.getByLabelText('Secreto'), { target: { value: plaintext } })
  fireEvent.change(screen.getByLabelText('Destinatarios'), { target: { value: recipients } })
}

const submit = () => userEvent.click(screen.getByRole('button', { name: 'Cifrar y crear enlaces' }))

beforeEach(() => {
  createShare.mockReset()
})

describe('CreatePage', () => {
  it('sends only ciphertext and shows one fragment link per recipient', async () => {
    createShare.mockResolvedValue(RESPONSE)
    renderPage()
    fillForm()
    await submit()

    expect(createShare).toHaveBeenCalledWith('oidc-token', {
      ciphertext: 'X'.repeat(30),
      nonce: 'N'.repeat(16),
      crypto_version: 1,
      expires_in_minutes: 60,
      recipients: ['bgonzalez', 'csaul'],
      shared_token: false,
      label: null,
    })
    const sent = JSON.stringify(createShare.mock.calls[0])
    expect(sent).not.toContain('hunter2')
    expect(sent).not.toContain(CEK)

    const list = await screen.findByTestId('share-links')
    expect(list.querySelector('li[data-recipient="bgonzalez"] code')?.textContent).toBe(
      `${window.location.origin}/s#v=1&t=${'T'.repeat(43)}&k=${CEK}`,
    )
    expect(list.querySelector('li[data-recipient="csaul"] code')?.textContent).toContain(`t=${'U'.repeat(43)}`)
  })

  it('sends label, shared mode and custom expiry', async () => {
    createShare.mockResolvedValue(RESPONSE)
    renderPage()
    fillForm()
    fireEvent.change(screen.getByLabelText('Etiqueta (opcional)'), { target: { value: '  Staging DB  ' } })
    await userEvent.click(screen.getByLabelText('Usar un único enlace para todos los destinatarios'))
    await userEvent.selectOptions(screen.getByLabelText('Vencimiento'), 'Personalizado')
    fireEvent.change(screen.getByLabelText('Minutos'), { target: { value: '90' } })
    await submit()
    expect(createShare.mock.calls[0][1]).toMatchObject({ label: 'Staging DB', shared_token: true, expires_in_minutes: 90 })
  })

  it('shows a shared link once, for all recipients', async () => {
    createShare.mockResolvedValue(SHARED_RESPONSE)
    renderPage()
    fillForm()
    await userEvent.click(screen.getByLabelText('Usar un único enlace para todos los destinatarios'))
    await submit()
    const list = await screen.findByTestId('share-links')
    expect(list.querySelectorAll('li')).toHaveLength(1)
    const row = list.querySelector('li[data-shared]')
    expect(row).toHaveTextContent('Todos los destinatarios')
    expect(row).toHaveTextContent('bgonzalez, csaul')
    expect(row?.querySelector('code')?.textContent).toBe(`${window.location.origin}/s#v=1&t=${'S'.repeat(43)}&k=${CEK}`)
  })

  it('blurs each link until the eye button reveals it', async () => {
    createShare.mockResolvedValue(RESPONSE)
    renderPage()
    fillForm()
    await submit()
    const list = await screen.findByTestId('share-links')
    const code = list.querySelector('li[data-recipient="bgonzalez"] code')
    const [eye] = screen.getAllByRole('button', { name: 'Mostrar enlace' })
    expect(eye).toHaveAttribute('aria-pressed', 'false')
    expect(code).toHaveClass('blur-xs')
    await userEvent.click(eye)
    expect(eye).toHaveAttribute('aria-pressed', 'true')
    expect(code).not.toHaveClass('blur-xs')
  })

  it('rejects email recipients without calling the API', async () => {
    renderPage()
    fillForm('hunter2', 'bgonzalez@corp.example')
    await submit()
    expect(screen.getByRole('alert')).toHaveTextContent('no direcciones de correo')
    expect(createShare).not.toHaveBeenCalled()
  })

  it('measures the limit in UTF-8 bytes, not characters', () => {
    renderPage()
    fireEvent.change(screen.getByLabelText('Secreto'), { target: { value: 'ñ'.repeat(32769) } }) // 65,538 bytes
    expect(screen.getByText(/supera el tamaño máximo/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cifrar y crear enlaces' })).toBeDisabled()
    fireEvent.change(screen.getByLabelText('Secreto'), { target: { value: 'a'.repeat(65536) } })
    expect(screen.queryByText(/supera el tamaño máximo/)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cifrar y crear enlaces' })).toBeEnabled()
  })

  it('shows only a login prompt when entering without a session', async () => {
    renderPage(null)
    expect(screen.queryByLabelText('Secreto')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Iniciar sesión' }))
    expect(await screen.findByLabelText('Secreto')).toBeInTheDocument()
  })

  it('keeps the typed secret when the session lapses: the button logs in, then the user submits again', async () => {
    createShare.mockResolvedValue(RESPONSE)
    const { expire } = renderExpiringPage()
    fillForm()
    expire()
    expect(screen.getByText(/Tu sesión expiró/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Cifrar y crear enlaces' })).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Iniciar sesión para continuar' }))
    expect(createShare).not.toHaveBeenCalled()
    expect(screen.getByLabelText('Secreto')).toHaveValue('hunter2')

    await submit()
    expect(createShare).toHaveBeenCalledWith('fresh-token', expect.objectContaining({ recipients: ['bgonzalez', 'csaul'] }))
  })

  it('explains a closed login popup and lets the user try again', async () => {
    const { expire } = renderExpiringPage({ loginSucceeds: false })
    fillForm()
    expire()
    const loginButton = screen.getByRole('button', { name: 'Iniciar sesión para continuar' })
    await userEvent.click(loginButton)
    expect(await screen.findByRole('alert')).toHaveTextContent('bloqueó la ventana emergente')
    expect(loginButton).toBeEnabled()
    expect(screen.getByLabelText('Secreto')).toHaveValue('hunter2')
    expect(createShare).not.toHaveBeenCalled()
  })

  it('handles a 401 by asking to log in again without losing the form', async () => {
    createShare.mockRejectedValue(new ApiError(401, 'invalid_authentication'))
    const { onExpire } = renderPage()
    fillForm()
    await submit()
    expect(onExpire).toHaveBeenCalled()
    expect(await screen.findByText(/Tu sesión expiró/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Iniciar sesión para continuar' })).toBeEnabled()
    expect(screen.getByLabelText('Secreto')).toHaveValue('hunter2')
  })

  it('shows backend validation errors in Spanish', async () => {
    createShare.mockRejectedValue(new ApiError(422, 'invalid_request'))
    renderPage()
    fillForm()
    await submit()
    expect(await screen.findByRole('alert')).toHaveTextContent(errorMessages.invalid_request)
  })

  it('starts over with an empty form', async () => {
    createShare.mockResolvedValue(RESPONSE)
    renderPage()
    fillForm()
    await submit()
    await userEvent.click(await screen.findByRole('button', { name: 'Compartir otro secreto' }))
    expect(screen.getByLabelText('Secreto')).toHaveValue('')
    expect(screen.getByLabelText('Destinatarios')).toHaveValue('')
  })
})
