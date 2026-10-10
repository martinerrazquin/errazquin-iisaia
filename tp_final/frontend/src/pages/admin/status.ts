import type { AdminShareItem } from '../../api'

export function shareStatus(item: AdminShareItem, now: Date): string {
  if (item.payload_deleted_at) return 'Contenido eliminado'
  if (item.revoked_at) return 'Revocado'
  if (new Date(item.expires_at) <= now) return 'Vencido'
  if (item.grants.length > 0 && item.grants.every((grant) => grant.consumed_at !== null)) return 'Obtenido por todos'
  return 'Activo'
}

export type GrantStatus = 'Obtenido' | 'Pendiente' | 'No obtenido'

/** An unused grant can still be obtained only while its share is open: not deleted, revoked or expired. */
export function grantStatus(item: AdminShareItem, grant: AdminShareItem['grants'][number], now: Date): GrantStatus {
  if (grant.consumed_at) return 'Obtenido'
  const open = !item.payload_deleted_at && !item.revoked_at && new Date(item.expires_at) > now
  return open ? 'Pendiente' : 'No obtenido'
}
