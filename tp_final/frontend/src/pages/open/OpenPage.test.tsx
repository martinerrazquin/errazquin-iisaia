// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as api from '../../api'
import { ApiError } from '../../api'
import { encodeBase64Url } from '../../crypto/base64url'
import * as v1 from '../../crypto/v1'
import { DecryptionError } from '../../crypto/v1'
import { errorMessages } from '../../i18n/messages'
import { TestAuthProvider } from '../../test/auth'
import { OpenPage } from './OpenPage'

vi.mock('../../api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../api')>()
  return { ...actual, consumeShare: vi.fn() }
})
vi.mock('../../crypto/v1', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../crypto/v1')>()
  return { ...actual, decryptV1: vi.fn() }
})

const consumeShare = vi.mocked(api.consumeShare)
const decryptV1 = vi.mocked(v1.decryptV1)

const TOKEN = encodeBase64Url(new Uint8Array(32).fill(7))
const CEK = encodeBase64Url(new Uint8Array(32).fill(9))
const VALID = `v=1&t=${TOKEN}&k=${CEK}`
const PAYLOAD = { crypto_version: 1, ciphertext: 'ct', nonce: 'nn' }

function openAt(fragment: string, initialToken: string | null = 'oidc-token', onExpire = vi.fn()) {
  window.history.replaceState(null, '', `/s#${fragment}`)
  render(
    <TestAuthProvider initialToken={initialToken} onExpire={onExpire}>
      <OpenPage />
    </TestAuthProvider>,
  )
  return { onExpire }
}

const reveal = () => userEvent.click(screen.getByRole('button', { name: 'Revelar secreto' }))

beforeEach(() => {
  consumeShare.mockReset()
  decryptV1.mockReset()
})

describe('OpenPage', () => {
  it.each([
    ['empty fragment', ''],
    ['version only', 'v=1'],
    ['unsupported version', `v=2&t=${TOKEN}&k=${CEK}`],
    ['short token', `v=1&t=abc&k=${CEK}`],
    ['trailing parenthesis', `${VALID})`],
  ])('shows a malformed-link error and never consumes: %s', (_name, fragment) => {
    openAt(fragment)
    expect(screen.getByRole('alert')).toHaveTextContent('El enlace está incompleto o no es válido')
    expect(screen.queryByRole('button', { name: 'Revelar secreto' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Iniciar sesión' })).not.toBeInTheDocument()
    expect(consumeShare).not.toHaveBeenCalled()
  })

  it('asks for login first, and login alone never consumes', async () => {
    openAt(VALID, null)
    expect(screen.queryByRole('button', { name: 'Revelar secreto' })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Iniciar sesión' }))
    expect(await screen.findByRole('button', { name: 'Revelar secreto' })).toBeInTheDocument()
    expect(screen.getByText(/una sola vez/)).toBeInTheDocument()
    expect(consumeShare).not.toHaveBeenCalled()
  })

  it('consumes once on explicit click and decrypts locally', async () => {
    consumeShare.mockResolvedValue(PAYLOAD)
    decryptV1.mockResolvedValue('the secret')
    openAt(VALID)
    await reveal()
    expect(await screen.findByLabelText('Secreto revelado')).toHaveValue('the secret')
    expect(consumeShare).toHaveBeenCalledTimes(1)
    expect(consumeShare).toHaveBeenCalledWith('oidc-token', TOKEN)
    expect(decryptV1).toHaveBeenCalledWith({ cek: CEK, nonce: 'nn', ciphertext: 'ct' })
    expect(screen.queryByRole('button', { name: 'Revelar secreto' })).not.toBeInTheDocument()
  })

  it('explains that a wrong key consumed the grant, without retrying', async () => {
    consumeShare.mockResolvedValue(PAYLOAD)
    decryptV1.mockRejectedValue(new DecryptionError())
    openAt(VALID)
    await reveal()
    expect(await screen.findByRole('alert')).toHaveTextContent('ya fue consumido')
    expect(consumeShare).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('button', { name: /Revelar secreto|Intentar nuevamente/ })).not.toBeInTheDocument()
  })

  it('treats an unexpected crypto_version as a decryption failure', async () => {
    consumeShare.mockResolvedValue({ ...PAYLOAD, crypto_version: 2 })
    openAt(VALID)
    await reveal()
    expect(await screen.findByRole('alert')).toHaveTextContent('ya fue consumido')
    expect(decryptV1).not.toHaveBeenCalled()
  })

  it.each([
    [410, 'share_already_consumed'],
    [410, 'share_expired'],
    [404, 'share_not_found'],
  ])('shows %s %s without offering a retry', async (status, code) => {
    consumeShare.mockRejectedValue(new ApiError(status, code))
    openAt(VALID)
    await reveal()
    expect(await screen.findByRole('alert')).toHaveTextContent(errorMessages[code])
    expect(screen.queryByRole('button', { name: /Revelar secreto|Intentar nuevamente/ })).not.toBeInTheDocument()
    expect(consumeShare).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['network failure', new ApiError(0, 'network_error')],
    ['server error', new ApiError(500, 'internal_error')],
  ])('on %s warns it may be consumed and only retries on explicit click', async (_name, failure) => {
    consumeShare.mockRejectedValueOnce(failure).mockResolvedValueOnce(PAYLOAD)
    decryptV1.mockResolvedValue('the secret')
    openAt(VALID)
    await reveal()
    expect(await screen.findByRole('alert')).toHaveTextContent('Es posible que el secreto ya se haya obtenido')
    expect(consumeShare).toHaveBeenCalledTimes(1)
    await userEvent.click(screen.getByRole('button', { name: 'Intentar nuevamente' }))
    expect(await screen.findByLabelText('Secreto revelado')).toHaveValue('the secret')
    expect(consumeShare).toHaveBeenCalledTimes(2)
  })

  it('on 401 drops the session and asks to log in again', async () => {
    consumeShare.mockRejectedValue(new ApiError(401, 'invalid_authentication'))
    const { onExpire } = openAt(VALID)
    await reveal()
    expect(onExpire).toHaveBeenCalled()
    expect(await screen.findByRole('button', { name: 'Iniciar sesión' })).toBeInTheDocument()
    expect(consumeShare).toHaveBeenCalledTimes(1)
  })
})
