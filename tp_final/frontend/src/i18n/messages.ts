export const errorMessages: Record<string, string> = {
  authentication_required: 'Tenés que iniciar sesión para continuar.',
  invalid_authentication: 'Tu sesión no es válida o expiró. Iniciá sesión nuevamente.',
  admin_access_required: 'No tenés permisos de administración.',
  share_not_found: 'El enlace no existe o no está destinado a tu usuario.',
  share_already_consumed: 'Este secreto ya fue obtenido. Cada destinatario puede obtenerlo una sola vez.',
  share_expired: 'El enlace expiró. Pedile al remitente que comparta el secreto nuevamente.',
  share_revoked: 'El enlace fue revocado por el remitente.',
  share_payload_deleted: 'El contenido de este enlace ya no está disponible.',
  invalid_request: 'La solicitud no es válida. Revisá los datos ingresados.',
  internal_error: 'Ocurrió un error inesperado. Intentá nuevamente más tarde.',
  network_error: 'No se pudo conectar con el servidor. Revisá tu conexión.',
}

export function errorMessage(code: string): string {
  return errorMessages[code] ?? errorMessages.internal_error
}
