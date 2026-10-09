const ALPHABET = /^[A-Za-z0-9_-]*$/

export class Base64UrlError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'Base64UrlError'
  }
}

export function encodeBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** Strict unpadded base64url (RFC 4648 §5) decoding; rejects non-canonical input. */
export function decodeBase64Url(value: string): Uint8Array<ArrayBuffer> {
  if (!ALPHABET.test(value) || value.length % 4 === 1) {
    throw new Base64UrlError('invalid base64url')
  }
  const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (value.length % 4)) % 4)
  const binary = atob(padded)
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0))
  if (encodeBase64Url(bytes) !== value) throw new Base64UrlError('non-canonical base64url')
  return bytes
}
