import { useState } from 'react'
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
    <div className="notice">
      <p>{message}</p>
      <button type="button" onClick={handleClick} disabled={busy}>
        Iniciar sesión
      </button>
      {failed && (
        <p role="alert" className="error">
          No se pudo iniciar sesión. Si el navegador bloqueó la ventana emergente, permitila e intentá nuevamente.
        </p>
      )}
    </div>
  )
}
