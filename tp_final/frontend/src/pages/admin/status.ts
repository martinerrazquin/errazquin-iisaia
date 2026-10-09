import type { AdminShareItem } from '../../api'

export function shareStatus(item: AdminShareItem, now: Date): string {
  if (item.payload_deleted_at) return 'Contenido eliminado'
  if (item.revoked_at) return 'Revocado'
  if (new Date(item.expires_at) <= now) return 'Vencido'
  if (item.grants.length > 0 && item.grants.every((grant) => grant.consumed_at !== null)) return 'Obtenido por todos'
  return 'Activo'
}
