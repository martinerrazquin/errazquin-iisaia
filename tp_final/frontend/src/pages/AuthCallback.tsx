import { CircleAlert, LoaderCircle } from 'lucide-react'
import type { UserManager } from 'oidc-client-ts'
import { useEffect, useRef, useState } from 'react'
import { Alert, AlertDescription } from '@/components/ui/alert'

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
    <main className="mx-auto flex min-h-svh max-w-md flex-col justify-center px-4 py-10">
      {failed ? (
        <Alert variant="destructive">
          <CircleAlert />
          <AlertDescription>
            No se pudo completar el inicio de sesión. Cerrá esta ventana e intentá nuevamente.
          </AlertDescription>
        </Alert>
      ) : (
        <p role="status" className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
          <LoaderCircle className="size-4 animate-spin" />
          Completando el inicio de sesión…
        </p>
      )}
    </main>
  )
}
