import { decodeBase64Url, encodeBase64Url } from './base64url'

/** Chismoso client crypto protocol v1 (base spec §6). The server never interprets it. */
export const CRYPTO_VERSION = 1
export const AAD = new TextEncoder().encode('secret-handoff:v1')

const CEK_BYTES = 32
const NONCE_BYTES = 12
const TAG_BITS = 128

export interface EncryptedV1 {
  cek: string
  nonce: string
  ciphertext: string
}

export class DecryptionError extends Error {
  constructor() {
    super('decryption failed')
    this.name = 'DecryptionError'
  }
}

export async function encryptV1(plaintext: string): Promise<EncryptedV1> {
  const cek = crypto.getRandomValues(new Uint8Array(CEK_BYTES))
  const nonce = crypto.getRandomValues(new Uint8Array(NONCE_BYTES))
  return encryptV1With(plaintext, cek, nonce)
}

/** Deterministic variant for known-answer tests; production code uses encryptV1. */
export async function encryptV1With(
  plaintext: string,
  cek: Uint8Array<ArrayBuffer>,
  nonce: Uint8Array<ArrayBuffer>,
): Promise<EncryptedV1> {
  if (cek.length !== CEK_BYTES || nonce.length !== NONCE_BYTES) {
    throw new Error('invalid key or nonce length')
  }
  const key = await crypto.subtle.importKey('raw', cek, { name: 'AES-GCM' }, false, ['encrypt'])
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: nonce, additionalData: AAD, tagLength: TAG_BITS },
    key,
    new TextEncoder().encode(plaintext),
  )
  return {
    cek: encodeBase64Url(cek),
    nonce: encodeBase64Url(nonce),
    ciphertext: encodeBase64Url(new Uint8Array(ciphertext)),
  }
}

export async function decryptV1(input: EncryptedV1): Promise<string> {
  let cek: Uint8Array<ArrayBuffer>
  let nonce: Uint8Array<ArrayBuffer>
  let ciphertext: Uint8Array<ArrayBuffer>
  try {
    cek = decodeBase64Url(input.cek)
    nonce = decodeBase64Url(input.nonce)
    ciphertext = decodeBase64Url(input.ciphertext)
  } catch {
    throw new DecryptionError()
  }
  if (cek.length !== CEK_BYTES || nonce.length !== NONCE_BYTES || ciphertext.length < TAG_BITS / 8) {
    throw new DecryptionError()
  }
  try {
    const key = await crypto.subtle.importKey('raw', cek, { name: 'AES-GCM' }, false, ['decrypt'])
    const plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: nonce, additionalData: AAD, tagLength: TAG_BITS },
      key,
      ciphertext,
    )
    return new TextDecoder('utf-8', { fatal: true }).decode(plaintext)
  } catch {
    throw new DecryptionError()
  }
}
