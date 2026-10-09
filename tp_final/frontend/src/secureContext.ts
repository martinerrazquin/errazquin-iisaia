/** WebCrypto is only available in secure contexts (HTTPS or *.localhost). No fallback is allowed. */
export function isSecureCryptoAvailable(): boolean {
  return globalThis.isSecureContext === true && typeof globalThis.crypto?.subtle?.encrypt === 'function'
}
