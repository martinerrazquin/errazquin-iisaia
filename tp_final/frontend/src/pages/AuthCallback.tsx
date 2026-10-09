import type { UserManager } from 'oidc-client-ts'
import { useEffect, useRef, useState } from 'react'

/** Runs inside the login popup: hands the authorization response back to the opener tab. Never consumes. */
export function AuthCallback({ userManager }: { userManager: Pick<UserManager, 'signinPopupCallback'> }) {
  const started = useRef(false)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    if (started.current) return
    started.current = true
    userManager.signinPopupCallback().catch(() => setFailed(true))
  }, [userManager])

  return (
    <main>
      {failed ? (
        <p role="alert" className="error">
          No se pudo completar el inicio de sesión. Cerrá esta ventana e intentá nuevamente.
        </p>
      ) : (
        <p role="status">Completando el inicio de sesión…</p>
      )}
    </main>
  )
}
