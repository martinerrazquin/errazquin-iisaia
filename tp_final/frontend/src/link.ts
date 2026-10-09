import { decodeBase64Url } from './crypto/base64url'

export interface ShareLink {
  version: 1
  token: string
  cek: string
}

const KEY_OR_TOKEN = /^[A-Za-z0-9_-]{43}$/

/** Token and CEK live only in the fragment, which browsers never send to servers. */
export function buildShareLink(origin: string, token: string, cek: string): string {
  return `${origin}/s#v=1&t=${token}&k=${cek}`
}

function is32Bytes(value: string): boolean {
  if (!KEY_OR_TOKEN.test(value)) return false
  try {
    return decodeBase64Url(value).length === 32
  } catch {
    return false
  }
}

export function parseShareFragment(hash: string): ShareLink | null {
  const fragment = hash.startsWith('#') ? hash.slice(1) : hash
  if (fragment === '') return null
  const params = new Map<string, string>()
  for (const part of fragment.split('&')) {
    const separator = part.indexOf('=')
    if (separator <= 0) return null
    const key = part.slice(0, separator)
    if (params.has(key)) return null
    params.set(key, part.slice(separator + 1))
  }
  if (params.size !== 3) return null
  const version = params.get('v')
  const token = params.get('t')
  const cek = params.get('k')
  if (version !== '1' || token === undefined || cek === undefined) return null
  if (!is32Bytes(token) || !is32Bytes(cek)) return null
  return { version: 1, token, cek }
}
