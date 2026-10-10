import { describe, expect, it } from 'vitest'
import type { AdminShareItem } from '../../api'
import { grantStatus, shareStatus } from './status'

const NOW = new Date('2026-10-08T12:00:00Z')

function item(overrides: Partial<AdminShareItem> = {}): AdminShareItem {
  return {
    id: 'id',
    creator_identity: 'aperez',
    label: null,
    created_at: '2026-10-08T10:00:00Z',
    expires_at: '2026-10-08T13:00:00Z',
    revoked_at: null,
    payload_deleted_at: null,
    grants: [{ recipient_identity: 'bgonzalez', consumed_at: null }],
    ...overrides,
  }
}

const obtained = { recipient_identity: 'bgonzalez', consumed_at: '2026-10-08T11:00:00Z' }

describe('shareStatus', () => {
  it.each([
    ['Activo', item()],
    ['Vencido', item({ expires_at: '2026-10-08T11:59:59Z' })],
    ['Revocado', item({ revoked_at: '2026-10-08T11:00:00Z' })],
    ['Contenido eliminado', item({ payload_deleted_at: '2026-10-08T11:00:00Z', revoked_at: '2026-10-08T11:00:00Z' })],
    ['Obtenido por todos', item({ grants: [obtained] })],
  ])('derives %s', (expected, share) => {
    expect(shareStatus(share, NOW)).toBe(expected)
  })

  it.each([
    ['expired', item({ grants: [obtained], expires_at: '2026-10-08T11:59:59Z' })],
    ['revoked', item({ grants: [obtained], revoked_at: '2026-10-08T11:30:00Z' })],
    ['deleted', item({ grants: [obtained], payload_deleted_at: '2026-10-08T11:30:00Z' })],
  ])('keeps "Obtenido por todos" once every recipient obtained it, even if later %s', (_name, share) => {
    expect(shareStatus(share, NOW)).toBe('Obtenido por todos')
  })

  it('a partly obtained share still shows its lifecycle status', () => {
    const partly = item({
      expires_at: '2026-10-08T11:59:59Z',
      grants: [obtained, { recipient_identity: 'csaul', consumed_at: null }],
    })
    expect(shareStatus(partly, NOW)).toBe('Vencido')
  })
})

describe('grantStatus', () => {
  const pending = { recipient_identity: 'bgonzalez', consumed_at: null }
  it.each([
    ['Obtenido', item(), { recipient_identity: 'bgonzalez', consumed_at: '2026-10-08T11:00:00Z' }],
    ['Obtenido', item({ revoked_at: '2026-10-08T11:30:00Z' }), { recipient_identity: 'b', consumed_at: '2026-10-08T11:00:00Z' }],
    ['Pendiente', item(), pending],
    ['No obtenido', item({ expires_at: '2026-10-08T12:00:00Z' }), pending],
    ['No obtenido', item({ revoked_at: '2026-10-08T11:00:00Z' }), pending],
    ['No obtenido', item({ payload_deleted_at: '2026-10-08T11:00:00Z' }), pending],
  ])('derives %s', (expected, share, grant) => {
    expect(grantStatus(share, grant, NOW)).toBe(expected)
  })
})
