function positiveInteger(raw: string | undefined, fallback: number): number {
  const value = Number(raw)
  return Number.isInteger(value) && value > 0 ? value : fallback
}

/** Values injected at build/dev-server start from .env (see compose files). */
export const config = {
  maxPlaintextBytes: positiveInteger(import.meta.env.VITE_MAX_PLAINTEXT_BYTES, 65536),
  oidcIssuer: import.meta.env.VITE_OIDC_ISSUER || 'http://idp.localhost:8080/realms/chismoso',
  oidcClientId: import.meta.env.VITE_OIDC_CLIENT_ID || 'chismoso',
}
