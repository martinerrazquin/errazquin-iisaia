import { describe, expect, it } from 'vitest'
import { Base64UrlError, decodeBase64Url, encodeBase64Url } from './base64url'

describe('base64url', () => {
  it('round-trips without padding using the URL-safe alphabet', () => {
    const bytes = new Uint8Array([0xfb, 0xff, 0x00, 0x10])
    const encoded = encodeBase64Url(bytes)
    expect(encoded).toBe('-_8AEA')
    expect(Array.from(decodeBase64Url(encoded))).toEqual(Array.from(bytes))
  })

  it('encodes 32 bytes as 43 characters', () => {
    expect(encodeBase64Url(new Uint8Array(32))).toHaveLength(43)
  })

  it('decodes the empty string', () => {
    expect(decodeBase64Url('')).toHaveLength(0)
  })

  it.each(['AAAA=', 'AA+A', 'AA/A', 'A', 'AB', 'AA AA', 'ÁAAA', 'AAAA\n'])('rejects %j', (value) => {
    expect(() => decodeBase64Url(value)).toThrow(Base64UrlError)
  })
})
