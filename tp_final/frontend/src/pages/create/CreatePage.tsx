import { type FormEvent, useState } from 'react'
import { ApiError, createShare } from '../../api'
import { useAuth } from '../../auth/context'
import { CopyButton } from '../../components/CopyButton'
import { LoginPrompt } from '../../components/LoginPrompt'
import { config } from '../../config'
import { CRYPTO_VERSION, encryptV1 } from '../../crypto/v1'
import { formatDateTime } from '../../i18n/format'
import { errorMessage } from '../../i18n/messages'
import { buildShareLink } from '../../link'
import { CUSTOM_EXPIRY, DEFAULT_EXPIRY_MINUTES, EXPIRY_PRESETS, parseCustomMinutes } from './expiry'
import { parseRecipients } from './recipients'

interface CreatedLinks {
  expiresAt: string
  shared: boolean
  links: { recipient: string; link: string }[]
}

const utf8 = new TextEncoder()

export function CreatePage() {
  const { getAccessToken, expireSession } = useAuth()
  const [plaintext, setPlaintext] = useState('')
  const [recipientsInput, setRecipientsInput] = useState('')
  const [label, setLabel] = useState('')
  const [sharedToken, setSharedToken] = useState(false)
  const [expiry, setExpiry] = useState(String(DEFAULT_EXPIRY_MINUTES))
  const [customMinutes, setCustomMinutes] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [sessionExpired, setSessionExpired] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [created, setCreated] = useState<CreatedLinks | null>(null)

  const plaintextBytes = utf8.encode(plaintext).length
  const tooLarge = plaintextBytes > config.maxPlaintextBytes
  const loggedIn = getAccessToken() !== null

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
    const accessToken = getAccessToken()
    if (accessToken === null) {
      // Keep everything typed; the user logs in and submits again.
      setSessionExpired(true)
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
      setSessionExpired(false)
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        expireSession()
        setSessionExpired(true)
      } else {
        setError(errorMessage(err instanceof ApiError ? err.code : 'internal_error'))
      }
    } finally {
      setSubmitting(false)
    }
  }

  if (created) return <CreatedLinksView created={created} onReset={resetForm} />

  return (
    <section>
      <h1>Compartir un secreto</h1>
      <p className="hint">El secreto se cifra en tu navegador. El servidor nunca recibe el texto ni la clave.</p>
      {!loggedIn && (
        <LoginPrompt
          message={
            sessionExpired
              ? 'Tu sesión expiró. Iniciá sesión nuevamente para crear los enlaces; lo que escribiste se conserva.'
              : 'Iniciá sesión para compartir un secreto.'
          }
          onLoggedIn={() => setSessionExpired(false)}
        />
      )}
      <form onSubmit={(event) => void handleSubmit(event)} noValidate>
        <label htmlFor="plaintext">Secreto</label>
        <textarea
          id="plaintext"
          rows={6}
          value={plaintext}
          onChange={(event) => setPlaintext(event.target.value)}
          autoComplete="off"
          spellCheck={false}
        />
        <p className={tooLarge ? 'hint error' : 'hint'}>
          {plaintextBytes} / {config.maxPlaintextBytes} bytes
          {tooLarge && ' — el secreto supera el tamaño máximo permitido.'}
        </p>

        <label htmlFor="recipients">Destinatarios</label>
        <input
          id="recipients"
          type="text"
          value={recipientsInput}
          onChange={(event) => setRecipientsInput(event.target.value)}
          autoComplete="off"
        />
        <p className="hint">Nombres de usuario separados por comas o espacios (por ejemplo: bgonzalez, csaul).</p>

        <label htmlFor="label">Etiqueta (opcional)</label>
        <input id="label" type="text" value={label} onChange={(event) => setLabel(event.target.value)} />
        <p className="hint">La ven los administradores. No incluyas información secreta.</p>

        <label htmlFor="expiry">Vencimiento</label>
        <select id="expiry" value={expiry} onChange={(event) => setExpiry(event.target.value)}>
          {EXPIRY_PRESETS.map((preset) => (
            <option key={preset.minutes} value={String(preset.minutes)}>
              {preset.label}
            </option>
          ))}
          <option value={CUSTOM_EXPIRY}>Personalizado</option>
        </select>
        {expiry === CUSTOM_EXPIRY && (
          <>
            <label htmlFor="custom-minutes">Minutos</label>
            <input
              id="custom-minutes"
              type="number"
              min={1}
              step={1}
              inputMode="numeric"
              value={customMinutes}
              onChange={(event) => setCustomMinutes(event.target.value)}
            />
          </>
        )}

        <label className="checkbox">
          <input type="checkbox" checked={sharedToken} onChange={(event) => setSharedToken(event.target.checked)} />{' '}
          Usar un único enlace para todos los destinatarios
        </label>

        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        <button type="submit" disabled={submitting || tooLarge}>
          {submitting ? 'Cifrando…' : 'Cifrar y crear enlaces'}
        </button>
      </form>
    </section>
  )
}

function CreatedLinksView({ created, onReset }: { created: CreatedLinks; onReset: () => void }) {
  return (
    <section>
      <h1>Enlaces creados</h1>
      <p>
        Enviá cada enlace únicamente a su destinatario, por el canal que prefieras. Chismoso no envía los enlaces y no
        puede volver a mostrarlos.
      </p>
      {created.shared && (
        <p className="hint">
          Enlace único: todos los destinatarios reciben el mismo enlace, pero cada uno puede usarlo una sola vez con su
          propio usuario.
        </p>
      )}
      <p className="hint">Vence: {formatDateTime(created.expiresAt)}</p>
      <ul className="links" data-testid="share-links">
        {created.links.map(({ recipient, link }) => (
          <li key={recipient} data-recipient={recipient}>
            <strong>{recipient}</strong>
            <code>{link}</code>
            <CopyButton value={link} label="Copiar enlace" />
          </li>
        ))}
      </ul>
      <button type="button" onClick={onReset}>
        Compartir otro secreto
      </button>
    </section>
  )
}
