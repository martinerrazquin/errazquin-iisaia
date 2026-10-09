import { useState } from 'react'
import { ApiError, type ConsumeResponse, consumeShare } from '../../api'
import { useAuth } from '../../auth/context'
import { CopyButton } from '../../components/CopyButton'
import { LoginPrompt } from '../../components/LoginPrompt'
import { decryptV1 } from '../../crypto/v1'
import { errorMessage } from '../../i18n/messages'
import { parseShareFragment, type ShareLink } from '../../link'

type Phase =
  | { kind: 'idle' }
  | { kind: 'consuming' }
  | { kind: 'revealed'; plaintext: string }
  | { kind: 'decrypt_failed' }
  | { kind: 'failed'; message: string; canRetry: boolean }

const DECRYPT_FAILED_MESSAGE =
  'El secreto se obtuvo del servidor, pero no se pudo descifrar: el enlace parece alterado o incompleto. ' +
  'Este acceso de un solo uso ya fue consumido; pedile al remitente que comparta el secreto nuevamente.'

const UNCERTAIN_MESSAGE =
  'No se pudo confirmar la respuesta del servidor. Es posible que el secreto ya se haya obtenido; ' +
  'si al reintentar figura como ya obtenido, pedile al remitente un enlace nuevo.'

export function OpenPage() {
  const { user, getAccessToken, expireSession } = useAuth()
  // Parsed once, kept in memory for this tab only. Nothing here is sent anywhere until the explicit click.
  const [link] = useState<ShareLink | null>(() => parseShareFragment(window.location.hash))
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' })

  if (link === null) {
    return (
      <section>
        <h1>Enlace no válido</h1>
        <p role="alert" className="error">
          El enlace está incompleto o no es válido. Verificá que lo hayas copiado completo o pedile al remitente que lo
          envíe nuevamente.
        </p>
      </section>
    )
  }

  async function reveal(current: ShareLink) {
    const accessToken = getAccessToken()
    if (accessToken === null) {
      expireSession()
      setPhase({ kind: 'idle' })
      return
    }
    setPhase({ kind: 'consuming' })
    let payload: ConsumeResponse
    try {
      payload = await consumeShare(accessToken, current.token)
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        expireSession()
        setPhase({ kind: 'idle' })
      } else if (err instanceof ApiError && err.status > 0 && err.status < 500) {
        setPhase({ kind: 'failed', message: errorMessage(err.code), canRetry: false })
      } else {
        // Response lost or server failed: the grant may have been consumed. Never retry automatically.
        setPhase({ kind: 'failed', message: UNCERTAIN_MESSAGE, canRetry: true })
      }
      return
    }
    if (payload.crypto_version !== current.version) {
      setPhase({ kind: 'decrypt_failed' })
      return
    }
    try {
      const plaintext = await decryptV1({ cek: current.cek, nonce: payload.nonce, ciphertext: payload.ciphertext })
      setPhase({ kind: 'revealed', plaintext })
    } catch {
      setPhase({ kind: 'decrypt_failed' })
    }
  }

  const loggedIn = getAccessToken() !== null
  const loginPrompt = <LoginPrompt message="Iniciá sesión con tu usuario para acceder al secreto." />

  return (
    <section>
      <h1>Secreto compartido</h1>

      {phase.kind === 'revealed' && (
        <>
          <label htmlFor="revealed">Secreto revelado</label>
          <textarea id="revealed" readOnly rows={6} value={phase.plaintext} />
          <CopyButton value={phase.plaintext} />
          <p className="hint">Guardalo en un lugar seguro: no vas a poder volver a verlo con este enlace.</p>
        </>
      )}

      {phase.kind === 'decrypt_failed' && (
        <p role="alert" className="error">
          {DECRYPT_FAILED_MESSAGE}
        </p>
      )}

      {phase.kind === 'failed' && (
        <>
          <p role="alert" className="error">
            {phase.message}
          </p>
          {phase.canRetry &&
            (loggedIn ? (
              <button type="button" onClick={() => void reveal(link)}>
                Intentar nuevamente
              </button>
            ) : (
              loginPrompt
            ))}
        </>
      )}

      {(phase.kind === 'idle' || phase.kind === 'consuming') &&
        (loggedIn ? (
          <div className="notice">
            <p>
              Ingresaste como <strong>{user?.profile.preferred_username}</strong>.
            </p>
            <p>
              Este secreto se puede obtener <strong>una sola vez</strong>. Al revelarlo, este enlace deja de funcionar
              para tu usuario.
            </p>
            <button type="button" onClick={() => void reveal(link)} disabled={phase.kind === 'consuming'}>
              {phase.kind === 'consuming' ? 'Obteniendo…' : 'Revelar secreto'}
            </button>
          </div>
        ) : (
          loginPrompt
        ))}
    </section>
  )
}
