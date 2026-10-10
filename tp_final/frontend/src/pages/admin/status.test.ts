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

describe('shareStatus', () => {
  it.each([
    ['Activo', item()],
    ['Vencido', item({ expires_at: '2026-10-08T11:59:59Z' })],
    ['Revocado', item({ revoked_at: '2026-10-08T11:00:00Z' })],
    ['Contenido eliminado', item({ payload_deleted_at: '2026-10-08T11:00:00Z', revoked_at: '2026-10-08T11:00:00Z' })],
    ['Obtenido por todos', item({ grants: [{ recipient_identity: 'bgonzalez', consumed_at: '2026-10-08T11:00:00Z' }] })],
  ])('derives %s', (expected, share) => {
    expect(shareStatus(share, NOW)).toBe(expected)
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
