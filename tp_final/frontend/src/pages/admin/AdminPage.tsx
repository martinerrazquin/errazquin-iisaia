import { ChevronLeft, ChevronRight, CircleAlert } from 'lucide-react'
import { type ReactNode, useEffect, useState } from 'react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
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
    content = (
      <p role="status" className="text-sm text-muted-foreground">
        Cargando…
      </p>
    )
  } else if (!loaded.ok) {
    content = (
      <Alert variant="destructive">
        <CircleAlert />
        <AlertDescription>{loaded.message}</AlertDescription>
      </Alert>
    )
  } else {
    content = <SharesTable data={loaded.data} now={loaded.loadedAt} onPageChange={setPage} />
  }

  return (
    <section className="flex flex-col gap-6">
      <div className="flex flex-col gap-1.5">
        <h1 className="font-heading text-2xl font-semibold tracking-tight">Administración</h1>
        <p className="text-sm text-muted-foreground">
          Solo metadatos de auditoría: el contenido de los secretos nunca es visible.
        </p>
      </div>
      {content}
    </section>
  )
}

export function SharesTable({
  data,
  now,
  onPageChange,
}: {
  data: AdminSharesPage
  now: Date
  onPageChange: (page: number) => void
}) {
  if (data.total === 0) return <p className="text-sm text-muted-foreground">Todavía no se compartieron secretos.</p>
  const totalPages = Math.max(1, Math.ceil(data.total / data.page_size))
  return (
    <div className="flex flex-col gap-4">
      <Card className="py-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-muted-foreground">
              <tr className="[&>th]:h-10 [&>th]:px-3 [&>th]:font-medium [&>th]:whitespace-nowrap">
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
                <tr key={item.id} className="border-t align-top [&>td]:px-3 [&>td]:py-2.5">
                  <td className="whitespace-nowrap">{formatDateTime(item.created_at)}</td>
                  <td>{item.creator_identity}</td>
                  <td>{item.label ?? '—'}</td>
                  <td className="whitespace-nowrap">{formatDateTime(item.expires_at)}</td>
                  <td>
                    <StatusBadge status={shareStatus(item, now)} />
                  </td>
                  <td>
                    <ul className="flex flex-col gap-0.5">
                      {item.grants.map((grant) => (
                        <li key={grant.recipient_identity} className="whitespace-nowrap">
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
        </div>
      </Card>
      <nav aria-label="Paginación" className="flex items-center justify-between gap-3 text-sm">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={data.page <= 1}
          onClick={() => onPageChange(data.page - 1)}
        >
          <ChevronLeft />
          Anterior
        </Button>
        <span className="text-muted-foreground">
          Página {data.page} de {totalPages} ({data.total} en total)
        </span>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={data.page >= totalPages}
          onClick={() => onPageChange(data.page + 1)}
        >
          Siguiente
          <ChevronRight />
        </Button>
      </nav>
    </div>
  )
}

function StatusBadge({ status }: { status: string }) {
  return <Badge variant={status === 'Activo' ? 'default' : 'secondary'}>{status}</Badge>
}
