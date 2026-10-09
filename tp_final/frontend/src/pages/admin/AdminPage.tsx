import { type ReactNode, useEffect, useState } from 'react'
import { type AdminSharesPage, ApiError, listAdminShares } from '../../api'
import { useAuth } from '../../auth/context'
import { formatDateTime } from '../../i18n/format'
import { errorMessage } from '../../i18n/messages'
import { shareStatus } from './status'

const PAGE_SIZE = 50

type Loaded =
  | { page: number; ok: true; data: AdminSharesPage; loadedAt: Date }
  | { page: number; ok: false; message: string }

export function AdminPage() {
  const { getAccessToken, expireSession } = useAuth()
  const [page, setPage] = useState(1)
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const accessToken = getAccessToken()

  useEffect(() => {
    if (accessToken === null) {
      // Token expired (or about to): hand control back to RequireLogin instead of spinning forever.
      expireSession()
      return
    }
    let cancelled = false
    listAdminShares(accessToken, page, PAGE_SIZE).then(
      (data) => {
        if (!cancelled) setLoaded({ page, ok: true, data, loadedAt: new Date() })
      },
      (err: unknown) => {
        if (cancelled) return
        if (err instanceof ApiError && err.status === 401) {
          expireSession()
          return
        }
        setLoaded({ page, ok: false, message: errorMessage(err instanceof ApiError ? err.code : 'internal_error') })
      },
    )
    return () => {
      cancelled = true
    }
  }, [accessToken, page, expireSession])

  let content: ReactNode
  if (loaded === null || loaded.page !== page) {
    content = <p role="status">Cargando…</p>
  } else if (!loaded.ok) {
    content = (
      <p role="alert" className="error">
        {loaded.message}
      </p>
    )
  } else {
    content = <SharesTable data={loaded.data} now={loaded.loadedAt} onPageChange={setPage} />
  }

  return (
    <section>
      <h1>Administración</h1>
      <p className="hint">Solo metadatos de auditoría: el contenido de los secretos nunca es visible.</p>
      {content}
    </section>
  )
}

function SharesTable({
  data,
  now,
  onPageChange,
}: {
  data: AdminSharesPage
  now: Date
  onPageChange: (page: number) => void
}) {
  if (data.total === 0) return <p>Todavía no se compartieron secretos.</p>
  const totalPages = Math.max(1, Math.ceil(data.total / data.page_size))
  return (
    <>
      <table>
        <thead>
          <tr>
            <th>Creado</th>
            <th>Creador</th>
            <th>Etiqueta</th>
            <th>Vence</th>
            <th>Estado</th>
            <th>Destinatarios</th>
          </tr>
        </thead>
        <tbody>
          {data.items.map((item) => (
            <tr key={item.id}>
              <td>{formatDateTime(item.created_at)}</td>
              <td>{item.creator_identity}</td>
              <td>{item.label ?? '—'}</td>
              <td>{formatDateTime(item.expires_at)}</td>
              <td>{shareStatus(item, now)}</td>
              <td>
                <ul>
                  {item.grants.map((grant) => (
                    <li key={grant.recipient_identity}>
                      {grant.recipient_identity}:{' '}
                      {grant.consumed_at ? `obtenido ${formatDateTime(grant.consumed_at)}` : 'pendiente'}
                    </li>
                  ))}
                </ul>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <nav aria-label="Paginación">
        <button type="button" disabled={data.page <= 1} onClick={() => onPageChange(data.page - 1)}>
          Anterior
        </button>{' '}
        <span>
          Página {data.page} de {totalPages} ({data.total} en total)
        </span>{' '}
        <button type="button" disabled={data.page >= totalPages} onClick={() => onPageChange(data.page + 1)}>
          Siguiente
        </button>
      </nav>
    </>
  )
}
