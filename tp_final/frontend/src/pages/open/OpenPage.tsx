import { CircleAlert, Eye, LoaderCircle, RotateCw, TriangleAlert, UserRound } from 'lucide-react'
import { type ReactNode, useState } from 'react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardFooter } from '@/components/ui/card'
import { Field, FieldLabel } from '@/components/ui/field'
import { Textarea } from '@/components/ui/textarea'
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
      <section className="flex flex-col gap-6">
        <h1 className="font-heading text-2xl font-semibold tracking-tight">Enlace no válido</h1>
        <ErrorAlert>
          El enlace está incompleto o no es válido. Verificá que lo hayas copiado completo o pedile al remitente que lo
          envíe nuevamente.
        </ErrorAlert>
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
    <section className="flex flex-col gap-6">
      <h1 className="font-heading text-2xl font-semibold tracking-tight">Secreto compartido</h1>

      {phase.kind === 'revealed' && (
        <Card>
          <CardContent>
            <Field>
              <FieldLabel htmlFor="revealed">Secreto revelado</FieldLabel>
              <Textarea id="revealed" readOnly rows={6} className="min-h-36 font-mono" value={phase.plaintext} />
            </Field>
          </CardContent>
          <CardFooter className="flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
              <TriangleAlert className="size-4 shrink-0 text-amber-600" />
              Guardalo en un lugar seguro: no vas a poder volver a verlo con este enlace.
            </p>
            <CopyButton value={phase.plaintext} />
          </CardFooter>
        </Card>
      )}

      {phase.kind === 'decrypt_failed' && <ErrorAlert>{DECRYPT_FAILED_MESSAGE}</ErrorAlert>}

      {phase.kind === 'failed' && (
        <>
          <ErrorAlert>{phase.message}</ErrorAlert>
          {phase.canRetry &&
            (loggedIn ? (
              <div>
                <Button type="button" variant="outline" onClick={() => void reveal(link)}>
                  <RotateCw />
                  Intentar nuevamente
                </Button>
              </div>
            ) : (
              loginPrompt
            ))}
        </>
      )}

      {(phase.kind === 'idle' || phase.kind === 'consuming') &&
        (loggedIn ? (
          <Card>
            <CardContent className="flex flex-col gap-3">
              <p className="flex items-center gap-2 text-muted-foreground">
                <UserRound className="size-4 shrink-0" />
                <span>
                  Ingresaste como <strong className="font-medium text-foreground">{user?.profile.preferred_username}</strong>.
                </span>
              </p>
              <p className="flex gap-2">
                <TriangleAlert className="mt-0.5 size-4 shrink-0 text-amber-600" />
                <span>
                  Este secreto se puede obtener <strong className="font-semibold">una sola vez</strong>. Al revelarlo, este
                  enlace deja de funcionar para tu usuario.
                </span>
              </p>
            </CardContent>
            <CardFooter className="justify-end">
              <Button
                type="button"
                size="lg"
                className="w-full sm:w-auto"
                onClick={() => void reveal(link)}
                disabled={phase.kind === 'consuming'}
              >
                {phase.kind === 'consuming' ? <LoaderCircle className="animate-spin" /> : <Eye />}
                {phase.kind === 'consuming' ? 'Obteniendo…' : 'Revelar secreto'}
              </Button>
            </CardFooter>
          </Card>
        ) : (
          loginPrompt
        ))}
    </section>
  )
}

function ErrorAlert({ children }: { children: ReactNode }) {
  return (
    <Alert variant="destructive">
      <CircleAlert />
      <AlertDescription>{children}</AlertDescription>
    </Alert>
  )
}
