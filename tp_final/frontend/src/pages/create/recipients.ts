const USERNAME = /^[a-z0-9][a-z0-9._-]{0,63}$/

export type RecipientsResult = { ok: true; recipients: string[] } | { ok: false; error: string }

/** Mirrors backend canonicalization for friendly errors; the backend stays authoritative. */
export function parseRecipients(input: string): RecipientsResult {
  const recipients = input
    .split(/[\s,;]+/)
    .map((item) => item.trim().toLowerCase())
    .filter((item) => item !== '')
  if (recipients.length === 0) return { ok: false, error: 'Ingresá al menos un destinatario.' }
  if (recipients.some((item) => item.includes('@'))) {
    return { ok: false, error: 'Ingresá nombres de usuario, no direcciones de correo.' }
  }
  const invalid = recipients.find((item) => !USERNAME.test(item))
  if (invalid !== undefined) return { ok: false, error: `«${invalid}» no es un nombre de usuario válido.` }
  const duplicate = recipients.find((item, index) => recipients.indexOf(item) !== index)
  if (duplicate !== undefined) return { ok: false, error: `El destinatario «${duplicate}» está repetido.` }
  return { ok: true, recipients }
}
