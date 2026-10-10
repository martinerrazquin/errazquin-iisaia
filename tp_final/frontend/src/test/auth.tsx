import type { User } from 'oidc-client-ts'
import { type ReactNode, useState } from 'react'
import { AuthContext, type AuthContextValue } from '../auth/context'

interface TestAuthProviderProps {
  initialToken?: string | null
  /** Treat initialToken as expired (user kept, getAccessToken() → null), like the real provider; login() fixes it. */
  tokenExpired?: boolean
  username?: string
  loginSucceeds?: boolean
  onExpire?: () => void
  children: ReactNode
}

/** Auth double for component tests: login() "succeeds" by setting the token 'fresh-token'. */
export function TestAuthProvider({
  initialToken = null,
  tokenExpired = false,
  username = 'bgonzalez',
  loginSucceeds = true,
  onExpire,
  children,
}: TestAuthProviderProps) {
  const [token, setToken] = useState<string | null>(initialToken)
  const value: AuthContextValue = {
    user: token ? ({ access_token: token, profile: { preferred_username: username } } as unknown as User) : null,
    getAccessToken: () => (tokenExpired && token === initialToken ? null : token),
    login: async () => {
      if (loginSucceeds) setToken('fresh-token')
      return loginSucceeds
    },
    logout: async () => setToken(null),
    expireSession: () => {
      onExpire?.()
      setToken(null)
    },
  }
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
