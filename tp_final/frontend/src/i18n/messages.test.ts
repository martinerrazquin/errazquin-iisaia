import { describe, expect, it } from 'vitest'
import { errorMessage, errorMessages } from './messages'

const BACKEND_CODES = [
  'authentication_required',
  'invalid_authentication',
  'admin_access_required',
  'share_not_found',
  'share_already_consumed',
  'share_expired',
  'share_revoked',
  'share_payload_deleted',
  'invalid_request',
  'internal_error',
  'network_error',
]

describe('error messages', () => {
  it.each(BACKEND_CODES)('has a Spanish message for %s', (code) => {
    expect(errorMessages[code]).toBeTruthy()
    expect(errorMessage(code)).toBe(errorMessages[code])
  })

  it('falls back to the generic message for unknown codes', () => {
    expect(errorMessage('something_new')).toBe(errorMessages.internal_error)
  })
})
