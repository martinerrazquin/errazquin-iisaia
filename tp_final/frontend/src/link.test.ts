import { describe, expect, it } from 'vitest'
import { encodeBase64Url } from './crypto/base64url'
import { buildShareLink, parseShareFragment } from './link'

const TOKEN = encodeBase64Url(new Uint8Array(32).fill(7))
const CEK = encodeBase64Url(new Uint8Array(32).fill(9))
const VALID = `#v=1&t=${TOKEN}&k=${CEK}`

describe('buildShareLink', () => {
  it('puts token and key only in the fragment', () => {
    const link = buildShareLink('http://app.localhost:3000', TOKEN, CEK)
    expect(link).toBe(`http://app.localhost:3000/s#v=1&t=${TOKEN}&k=${CEK}`)
    expect(new URL(link).pathname).toBe('/s')
    expect(new URL(link).search).toBe('')
  })

  it('round-trips through the parser', () => {
    const link = buildShareLink('http://app.localhost:3000', TOKEN, CEK)
    expect(parseShareFragment(new URL(link).hash)).toEqual({ version: 1, token: TOKEN, cek: CEK })
  })
})

describe('parseShareFragment', () => {
  it('accepts a valid fragment with or without the leading #', () => {
    expect(parseShareFragment(VALID)).toEqual({ version: 1, token: TOKEN, cek: CEK })
    expect(parseShareFragment(VALID.slice(1))).toEqual({ version: 1, token: TOKEN, cek: CEK })
  })

  it('accepts parameters in any order', () => {
    expect(parseShareFragment(`#k=${CEK}&v=1&t=${TOKEN}`)).not.toBeNull()
  })

  it.each([
    ['empty', ''],
    ['only hash', '#'],
    ['missing version', `#t=${TOKEN}&k=${CEK}`],
    ['missing token', `#v=1&k=${CEK}`],
    ['missing key', `#v=1&t=${TOKEN}`],
    ['unsupported version', `#v=2&t=${TOKEN}&k=${CEK}`],
    ['padded version', `#v=01&t=${TOKEN}&k=${CEK}`],
    ['short token', `#v=1&t=${TOKEN.slice(1)}&k=${CEK}`],
    ['long token', `#v=1&t=${TOKEN}A&k=${CEK}`],
    ['padded key', `#v=1&t=${TOKEN}&k=${CEK}=`],
    ['standard alphabet', `#v=1&t=${TOKEN.replace(/.$/, '+')}&k=${CEK}`],
    ['non-canonical key', `#v=1&t=${TOKEN}&k=${CEK.slice(0, 42)}B`],
    ['trailing period from chat apps', `${VALID}.`],
    ['trailing parenthesis', `${VALID})`],
    ['duplicate key', `${VALID}&k=${CEK}`],
    ['extra parameter', `${VALID}&x=1`],
    ['missing value separator', `#v=1&t${TOKEN}&k=${CEK}`],
    ['whitespace', `#v=1&t=${TOKEN} &k=${CEK}`],
  ])('rejects %s', (_name, hash) => {
    expect(parseShareFragment(hash)).toBeNull()
  })
})
