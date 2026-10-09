export interface CreateShareRequest {
  ciphertext: string
  nonce: string
  crypto_version: number
  expires_in_minutes: number
  recipients: string[]
  shared_token: boolean
  label: string | null
}

export interface CreateShareResponse {
  share_id: string
  crypto_version: number
  created_at: string
  expires_at: string
  grants: { recipient: string; access_token: string }[]
}

export interface ConsumeResponse {
  crypto_version: number
  ciphertext: string
  nonce: string
}

export interface AdminShareItem {
  id: string
  creator_identity: string
  label: string | null
  created_at: string
  expires_at: string
  revoked_at: string | null
  payload_deleted_at: string | null
  grants: { recipient_identity: string; consumed_at: string | null }[]
}

export interface AdminSharesPage {
  items: AdminShareItem[]
  page: number
  page_size: number
  total: number
}

export class ApiError extends Error {
  readonly status: number
  readonly code: string

  constructor(status: number, code: string) {
    super(code)
    this.name = 'ApiError'
    this.status = status
    this.code = code
  }
}

async function request<T>(path: string, accessToken: string, init: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = { Authorization: `Bearer ${accessToken}` }
  if (init.body !== undefined) headers['Content-Type'] = 'application/json'
  let response: Response
  try {
    response = await fetch(path, { ...init, headers, cache: 'no-store' })
  } catch {
    throw new ApiError(0, 'network_error')
  }
  if (!response.ok) {
    let code = response.status === 413 ? 'invalid_request' : 'internal_error'
    try {
      const body: unknown = await response.json()
      const envelopeCode = (body as { error?: { code?: unknown } })?.error?.code
      if (typeof envelopeCode === 'string') code = envelopeCode
    } catch {
      // Non-JSON error body (e.g. from the proxy): keep the status-based code.
    }
    throw new ApiError(response.status, code)
  }
  try {
    return (await response.json()) as T
  } catch {
    // The request may have taken effect, but the client cannot confirm it: treat as uncertain.
    throw new ApiError(0, 'network_error')
  }
}

export function createShare(accessToken: string, body: CreateShareRequest): Promise<CreateShareResponse> {
  return request('/api/v1/shares', accessToken, { method: 'POST', body: JSON.stringify(body) })
}

export function consumeShare(accessToken: string, shareToken: string): Promise<ConsumeResponse> {
  return request('/api/v1/access/consume', accessToken, {
    method: 'POST',
    body: JSON.stringify({ access_token: shareToken }),
  })
}

export function listAdminShares(accessToken: string, page: number, pageSize: number): Promise<AdminSharesPage> {
  return request(`/api/v1/admin/shares?page=${page}&page_size=${pageSize}`, accessToken)
}
