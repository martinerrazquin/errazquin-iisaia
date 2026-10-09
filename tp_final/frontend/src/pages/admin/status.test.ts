import { describe, expect, it } from 'vitest'
import type { AdminShareItem } from '../../api'
import { shareStatus } from './status'

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
