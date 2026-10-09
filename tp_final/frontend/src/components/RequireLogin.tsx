import type { ReactNode } from 'react'
import { useAuth } from '../auth/context'
import { LoginPrompt } from './LoginPrompt'

export function RequireLogin({ children }: { children: ReactNode }) {
  const { getAccessToken } = useAuth()
  if (getAccessToken() === null) return <LoginPrompt message="Iniciá sesión para continuar." />
  return <>{children}</>
}
