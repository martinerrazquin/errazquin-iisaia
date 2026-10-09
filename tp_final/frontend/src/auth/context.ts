import type { User } from 'oidc-client-ts'
import { createContext, useContext } from 'react'

export interface AuthContextValue {
  user: User | null
  /** Access token if present and not (about to be) expired; otherwise null. */
  getAccessToken: () => string | null
  /** Opens the Keycloak popup. Call it directly from a click handler. Resolves false on failure/close. */
  login: () => Promise<boolean>
  logout: () => Promise<void>
  /** Forget the user, e.g. after the API answered 401. */
  expireSession: () => void
}

export const AuthContext = createContext<AuthContextValue | null>(null)

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext)
  if (!value) throw new Error('useAuth must be used inside an AuthProvider')
  return value
}
