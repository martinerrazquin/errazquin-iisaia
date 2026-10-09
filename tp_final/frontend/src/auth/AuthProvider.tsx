import type { User, UserManager } from 'oidc-client-ts'
import { type ReactNode, useCallback, useMemo, useState } from 'react'
import { AuthContext, type AuthContextValue } from './context'

const MIN_TOKEN_LIFETIME_SECONDS = 10

export type PopupUserManager = Pick<UserManager, 'signinPopup' | 'removeUser'>

export function AuthProvider({ userManager, children }: { userManager: PopupUserManager; children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)

  const login = useCallback(async () => {
    try {
      // popupAbortOnClose is per-call only in oidc-client-ts 3.x; without it a closed/blocked popup never settles.
      setUser(await userManager.signinPopup({ popupAbortOnClose: true }))
      return true
    } catch {
      return false
    }
  }, [userManager])

  const logout = useCallback(async () => {
    setUser(null)
    await userManager.removeUser()
  }, [userManager])

  const expireSession = useCallback(() => {
    setUser(null)
    void userManager.removeUser()
  }, [userManager])

  const getAccessToken = useCallback(() => {
    if (!user || user.expired) return null
    if ((user.expires_in ?? 0) <= MIN_TOKEN_LIFETIME_SECONDS) return null
    return user.access_token
  }, [user])

  const value = useMemo<AuthContextValue>(
    () => ({ user, getAccessToken, login, logout, expireSession }),
    [user, getAccessToken, login, logout, expireSession],
  )
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
