import { LogIn } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { useAuth } from '../auth/context'

export function LoginPrompt({ message, onLoggedIn }: { message: string; onLoggedIn?: () => void }) {
  const { login } = useAuth()
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)

  function handleClick() {
    setBusy(true)
    setFailed(false)
    // login() opens the popup synchronously inside this click handler, so popup blockers allow it.
    void login().then((ok) => {
      setBusy(false)
      if (ok) onLoggedIn?.()
      else setFailed(true)
    })
  }

  return (
    <div className="rounded-xl border bg-card p-4 text-sm text-card-foreground">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p>{message}</p>
        <Button type="button" onClick={handleClick} disabled={busy} className="self-start sm:self-auto">
          <LogIn />
          Iniciar sesión
        </Button>
      </div>
      {failed && (
        <p role="alert" className="mt-3 text-destructive">
          No se pudo iniciar sesión. Si el navegador bloqueó la ventana emergente, permitila e intentá nuevamente.
        </p>
      )}
    </div>
  )
}
