import {
  CircleAlert,
  CircleCheck,
  Clock,
  Link2,
  LoaderCircle,
  Lock,
  LogIn,
  Plus,
  ShieldCheck,
  UserRound,
  UsersRound,
} from 'lucide-react'
import { type FormEvent, type ReactNode, useState } from 'react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardFooter } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Field, FieldContent, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import { ApiError, createShare } from '../../api'
import { useAuth } from '../../auth/context'
import { CopyButton } from '../../components/CopyButton'
import { LoginPrompt } from '../../components/LoginPrompt'
import { BLURRED, RevealToggle } from '../../components/RevealToggle'
import { config } from '../../config'
import { CRYPTO_VERSION, encryptV1 } from '../../crypto/v1'
import { formatDateTime } from '../../i18n/format'
import { errorMessage } from '../../i18n/messages'
import { buildShareLink } from '../../link'
import { CUSTOM_EXPIRY, DEFAULT_EXPIRY_MINUTES, EXPIRY_PRESETS, parseCustomMinutes } from './expiry'
import { parseRecipients } from './recipients'

export interface CreatedLinks {
  expiresAt: string
  shared: boolean
  links: { recipient: string; link: string }[]
}

const utf8 = new TextEncoder()

export function CreatePage() {
  const { getAccessToken, login, expireSession } = useAuth()
  const [plaintext, setPlaintext] = useState('')
  const [recipientsInput, setRecipientsInput] = useState('')
  const [label, setLabel] = useState('')
  const [sharedToken, setSharedToken] = useState(false)
  const [expiry, setExpiry] = useState(String(DEFAULT_EXPIRY_MINUTES))
  const [customMinutes, setCustomMinutes] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loggingIn, setLoggingIn] = useState(false)
  const [loginFailed, setLoginFailed] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [created, setCreated] = useState<CreatedLinks | null>(null)

  const plaintextBytes = utf8.encode(plaintext).length
  const tooLarge = plaintextBytes > config.maxPlaintextBytes
  const loggedIn = getAccessToken() !== null
  // The login gate is shown only until a session is first seen. If the session lapses later, the form (and everything
  // typed) stays and the submit button logs in instead; unmounting the form like RequireLogin does would lose the text.
  const [hadSession, setHadSession] = useState(loggedIn)
  if (loggedIn && !hadSession) setHadSession(true)

  function resetForm() {
    setCreated(null)
    setRecipientsInput('')
    setLabel('')
    setSharedToken(false)
    setExpiry(String(DEFAULT_EXPIRY_MINUTES))
    setCustomMinutes('')
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    setLoginFailed(false)
    const accessToken = getAccessToken()
    if (accessToken === null) {
      // login() must open the popup synchronously inside this click/submit, so popup blockers allow it. It never
      // submits: once logged in, the user clicks "Cifrar y crear enlaces" again.
      setLoggingIn(true)
      void login().then((ok) => {
        setLoggingIn(false)
        setLoginFailed(!ok)
      })
      return
    }
    if (plaintext === '') {
      setError('Ingresá el secreto a compartir.')
      return
    }
    if (tooLarge) {
      setError('El secreto supera el tamaño máximo permitido.')
      return
    }
    const recipients = parseRecipients(recipientsInput)
    if (!recipients.ok) {
      setError(recipients.error)
      return
    }
    const minutes = expiry === CUSTOM_EXPIRY ? parseCustomMinutes(customMinutes) : Number(expiry)
    if (minutes === null) {
      setError('Ingresá una cantidad entera de minutos mayor a cero.')
      return
    }

    setSubmitting(true)
    try {
      const encrypted = await encryptV1(plaintext)
      const response = await createShare(accessToken, {
        ciphertext: encrypted.ciphertext,
        nonce: encrypted.nonce,
        crypto_version: CRYPTO_VERSION,
        expires_in_minutes: minutes,
        recipients: recipients.recipients,
        shared_token: sharedToken,
        label: label.trim() === '' ? null : label.trim(),
      })
      setCreated({
        expiresAt: response.expires_at,
        shared: sharedToken,
        links: response.grants.map((grant) => ({
          recipient: grant.recipient,
          link: buildShareLink(window.location.origin, grant.access_token, encrypted.cek),
        })),
      })
      setPlaintext('')
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        // Drops the user: the form stays filled and the submit button turns into the login button.
        expireSession()
      } else {
        setError(errorMessage(err instanceof ApiError ? err.code : 'internal_error'))
      }
    } finally {
      setSubmitting(false)
    }
  }

  if (created) return <CreatedLinksView created={created} onReset={resetForm} />

  const heading = (
    <div className="flex flex-col gap-1.5">
      <h1 className="font-heading text-2xl font-semibold tracking-tight">Compartir un secreto</h1>
      <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
        <ShieldCheck className="size-4 shrink-0" />
        El secreto se cifra en tu navegador. El servidor nunca recibe el texto ni la clave.
      </p>
    </div>
  )

  if (!loggedIn && !hadSession) {
    return (
      <section className="flex flex-col gap-6">
        {heading}
        <LoginPrompt message="Iniciá sesión para compartir un secreto." />
      </section>
    )
  }

  return (
    <section className="flex flex-col gap-6">
      {heading}
      <form onSubmit={(event) => void handleSubmit(event)} noValidate>
        <Card>
          <CardContent>
            <FieldGroup>
              <Field data-invalid={tooLarge || undefined}>
                <FieldLabel htmlFor="plaintext">Secreto</FieldLabel>
                <Textarea
                  id="plaintext"
                  rows={6}
                  className="min-h-36 font-mono"
                  value={plaintext}
                  onChange={(event) => setPlaintext(event.target.value)}
                  autoComplete="off"
                  spellCheck={false}
                  aria-invalid={tooLarge || undefined}
                />
                <FieldDescription className={cn('text-right tabular-nums', tooLarge && 'text-destructive')}>
                  {plaintextBytes} / {config.maxPlaintextBytes} bytes
                  {tooLarge && ' — el secreto supera el tamaño máximo permitido.'}
                </FieldDescription>
              </Field>

              <Field>
                <FieldLabel htmlFor="recipients">Destinatarios</FieldLabel>
                <Input
                  id="recipients"
                  type="text"
                  placeholder="bgonzalez, csaul"
                  value={recipientsInput}
                  onChange={(event) => setRecipientsInput(event.target.value)}
                  autoComplete="off"
                />
                <FieldDescription>Nombres de usuario separados por comas o espacios.</FieldDescription>
              </Field>

              <Field>
                <FieldLabel htmlFor="label">Etiqueta (opcional)</FieldLabel>
                <Input id="label" type="text" value={label} onChange={(event) => setLabel(event.target.value)} />
                <FieldDescription>La ven los administradores. No incluyas información secreta.</FieldDescription>
              </Field>

              <div className="grid gap-5 sm:grid-cols-2">
                <Field>
                  <FieldLabel htmlFor="expiry">Vencimiento</FieldLabel>
                  <NativeSelect id="expiry" className="w-full" value={expiry} onChange={(event) => setExpiry(event.target.value)}>
                    {EXPIRY_PRESETS.map((preset) => (
                      <NativeSelectOption key={preset.minutes} value={String(preset.minutes)}>
                        {preset.label}
                      </NativeSelectOption>
                    ))}
                    <NativeSelectOption value={CUSTOM_EXPIRY}>Personalizado</NativeSelectOption>
                  </NativeSelect>
                </Field>
                {expiry === CUSTOM_EXPIRY && (
                  <Field>
                    <FieldLabel htmlFor="custom-minutes">Minutos</FieldLabel>
                    <Input
                      id="custom-minutes"
                      type="number"
                      min={1}
                      step={1}
                      inputMode="numeric"
                      value={customMinutes}
                      onChange={(event) => setCustomMinutes(event.target.value)}
                    />
                  </Field>
                )}
              </div>

              <Field orientation="horizontal">
                <Checkbox
                  id="shared-token"
                  checked={sharedToken}
                  onCheckedChange={(checked) => setSharedToken(checked === true)}
                />
                <FieldContent>
                  <FieldLabel htmlFor="shared-token">Usar un único enlace para todos los destinatarios</FieldLabel>
                  <FieldDescription>Cada destinatario lo puede usar una sola vez, con su propio usuario.</FieldDescription>
                </FieldContent>
              </Field>

              {(error || loginFailed) && (
                <Alert variant="destructive">
                  <CircleAlert />
                  <AlertDescription>
                    {error ??
                      'No se pudo iniciar sesión. Si el navegador bloqueó la ventana emergente, permitila e intentá nuevamente.'}
                  </AlertDescription>
                </Alert>
              )}
            </FieldGroup>
          </CardContent>
          <CardFooter className="flex-col items-stretch gap-3 sm:flex-row sm:items-center sm:justify-end">
            {!loggedIn && (
              <p className="text-sm text-muted-foreground sm:mr-auto">
                Tu sesión expiró. Iniciá sesión para continuar; lo que escribiste se conserva.
              </p>
            )}
            {loggedIn ? (
              <Button type="submit" size="lg" disabled={submitting || tooLarge} className="sm:w-auto">
                {submitting ? <LoaderCircle className="animate-spin" /> : <Lock />}
                {submitting ? 'Cifrando…' : 'Cifrar y crear enlaces'}
              </Button>
            ) : (
              <Button type="submit" size="lg" disabled={loggingIn} className="sm:w-auto">
                <LogIn />
                Iniciar sesión para continuar
              </Button>
            )}
          </CardFooter>
        </Card>
      </form>
    </section>
  )
}

export function CreatedLinksView({ created, onReset }: { created: CreatedLinks; onReset: () => void }) {
  // Shared mode gives every recipient the same link; show it once. Fall back to one row each if they ever differ.
  const singleSharedLink = created.shared && created.links.every(({ link }) => link === created.links[0].link)
  return (
    <section className="flex flex-col gap-6">
      <div className="flex items-start gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-600">
          <CircleCheck className="size-5" />
        </span>
        <div className="flex flex-col gap-1.5">
          <h1 className="font-heading text-2xl font-semibold tracking-tight">Enlaces creados</h1>
          <p className="text-sm text-muted-foreground">
            Enviá cada enlace únicamente a su destinatario, por el canal que prefieras. Chismoso no envía los enlaces y
            no puede volver a mostrarlos.
          </p>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="secondary">
          <Clock />
          Vence: {formatDateTime(created.expiresAt)}
        </Badge>
        {created.shared && (
          <Badge variant="outline">
            <Link2 />
            Enlace único
          </Badge>
        )}
      </div>
      {created.shared && (
        <p className="text-sm text-muted-foreground">
          Enlace único: todos los destinatarios reciben el mismo enlace, pero cada uno puede usarlo una sola vez con su
          propio usuario.
        </p>
      )}
      <Card className="py-0">
        <ul className="divide-y" data-testid="share-links">
          {singleSharedLink ? (
            <li data-shared="" className="p-4">
              <LinkRow
                icon={<UsersRound />}
                title="Todos los destinatarios"
                detail={created.links.map(({ recipient }) => recipient).join(', ')}
                link={created.links[0].link}
              />
            </li>
          ) : (
            created.links.map(({ recipient, link }) => (
              <li key={recipient} data-recipient={recipient} className="p-4">
                <LinkRow icon={<UserRound />} title={recipient} link={link} />
              </li>
            ))
          )}
        </ul>
      </Card>
      <div>
        <Button type="button" variant="outline" onClick={onReset}>
          <Plus />
          Compartir otro secreto
        </Button>
      </div>
    </section>
  )
}

/** One link, blurred until revealed so it does not leak on a shared or recorded screen; copying works either way. */
function LinkRow({ icon, title, detail, link }: { icon: ReactNode; title: string; detail?: string; link: string }) {
  const [revealed, setRevealed] = useState(false)
  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="flex items-center gap-2 font-medium [&_svg]:size-4 [&_svg]:text-muted-foreground">
            {icon}
            {title}
          </span>
          {detail && <span className="text-sm text-muted-foreground">{detail}</span>}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <RevealToggle label="Mostrar enlace" revealed={revealed} onToggle={() => setRevealed((value) => !value)} />
          <CopyButton value={link} label="Copiar enlace" />
        </div>
      </div>
      <code
        className={cn(
          'block rounded-md bg-muted px-3 py-2 font-mono text-xs break-all text-muted-foreground transition-[filter]',
          !revealed && BLURRED,
        )}
      >
        {link}
      </code>
    </div>
  )
}
