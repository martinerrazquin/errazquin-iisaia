import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError, consumeShare, createShare, listAdminShares } from './api'

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('api client', () => {
  it('posts the share token in the JSON body with the OIDC bearer token', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { crypto_version: 1, ciphertext: 'c', nonce: 'n' }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(consumeShare('oidc-token', 'share-token')).resolves.toEqual({ crypto_version: 1, ciphertext: 'c', nonce: 'n' })

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/v1/access/consume')
    expect(init.method).toBe('POST')
    expect(init.cache).toBe('no-store')
    expect(init.headers).toMatchObject({ Authorization: 'Bearer oidc-token', 'Content-Type': 'application/json' })
    expect(JSON.parse(init.body as string)).toEqual({ access_token: 'share-token' })
  })

  it('posts create requests to /api/v1/shares', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(201, { share_id: 'x', grants: [] }))
    vi.stubGlobal('fetch', fetchMock)
    const body = {
      ciphertext: 'c', nonce: 'n', crypto_version: 1, expires_in_minutes: 60,
      recipients: ['bgonzalez'], shared_token: false, label: null,
    }
    await createShare('oidc-token', body)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/v1/shares')
    expect(JSON.parse(init.body as string)).toEqual(body)
  })

  it('requests admin pages with query parameters', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { items: [], page: 2, page_size: 50, total: 0 }))
    vi.stubGlobal('fetch', fetchMock)
    await listAdminShares('oidc-token', 2, 50)
    expect(fetchMock.mock.calls[0][0]).toBe('/api/v1/admin/shares?page=2&page_size=50')
  })

  it('maps the error envelope to ApiError', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(410, { error: { code: 'share_already_consumed', message: 'x' } })))
    await expect(consumeShare('t', 's')).rejects.toMatchObject({ status: 410, code: 'share_already_consumed' })
  })

  it('maps a non-JSON 413 from the proxy to invalid_request', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('Request Entity Too Large', { status: 413 })))
    await expect(createShare('t', {} as never)).rejects.toMatchObject({ status: 413, code: 'invalid_request' })
  })

  it('maps other non-JSON errors to internal_error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('Bad Gateway', { status: 502 })))
    await expect(consumeShare('t', 's')).rejects.toMatchObject({ status: 502, code: 'internal_error' })
  })

  it('maps network failures to status 0 network_error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))
    const error = await consumeShare('t', 's').catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ApiError)
    expect(error).toMatchObject({ status: 0, code: 'network_error' })
  })
})
