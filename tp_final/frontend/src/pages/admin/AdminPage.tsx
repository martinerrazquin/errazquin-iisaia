import { ChevronLeft, ChevronRight, CircleAlert, CornerDownRight, LoaderCircle, Minus, Plus } from 'lucide-react'
import { type ReactNode, useEffect, useState } from 'react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import { type AdminShareItem, type AdminSharesPage, ApiError, listAdminShares } from '../../api'
import { useAuth } from '../../auth/context'
import { formatDateTime } from '../../i18n/format'
import { errorMessage } from '../../i18n/messages'
import { grantStatus, shareStatus } from './status'

const PAGE_SIZE = 50

export type Loaded =
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

  return <AdminView loaded={loaded !== null && loaded.page === page ? loaded : null} onPageChange={setPage} />
}

/** What the page shows for a load result (null while loading); exported for the dev states page. */
export function AdminView({ loaded, onPageChange }: { loaded: Loaded | null; onPageChange: (page: number) => void }) {
  let content: ReactNode
  if (loaded === null) {
    content = (
      <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
        <LoaderCircle className="size-4 animate-spin" />
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
    content = <SharesTable data={loaded.data} now={loaded.loadedAt} onPageChange={onPageChange} />
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

function SharesTable({
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
            {data.items.map((item) => (
              <ShareRows key={item.id} item={item} now={now} />
            ))}
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

const STATUS_STYLES: Record<string, { variant: 'secondary' | 'outline' | 'destructive'; className?: string }> = {
  Activo: { variant: 'secondary', className: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400' },
  'Obtenido por todos': { variant: 'secondary' },
  Vencido: { variant: 'outline', className: 'text-muted-foreground' },
  Revocado: { variant: 'destructive' },
  'Contenido eliminado': { variant: 'destructive' },
  // Per recipient.
  Obtenido: { variant: 'secondary', className: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400' },
  Pendiente: { variant: 'secondary' },
  'No obtenido': { variant: 'destructive' },
}

/**
 * One share (its own tbody) plus a second tbody with its recipients, which the +/− button shows. Recipient rows reuse
 * the share columns: name under Creado–Etiqueta, date under Vence, status badge under Estado.
 */
function ShareRows({ item, now }: { item: AdminShareItem; now: Date }) {
  const [open, setOpen] = useState(false)
  const detailsId = `grants-${item.id}`
  const obtained = item.grants.filter((grant) => grant.consumed_at !== null).length
  return (
    <>
      <tbody className="border-t">
        <tr className="align-top [&>td]:px-3 [&>td]:py-2.5">
          <td className="whitespace-nowrap">{formatDateTime(item.created_at)}</td>
          <td>{item.creator_identity}</td>
          <td className={item.label === null ? 'text-muted-foreground' : undefined}>{item.label ?? '—'}</td>
          <td className="whitespace-nowrap">{formatDateTime(item.expires_at)}</td>
          <td>
            <StatusBadge status={shareStatus(item, now)} />
          </td>
          <td>
            <div className="flex items-center gap-2 whitespace-nowrap">
              <Button
                type="button"
                variant="outline"
                size="icon-xs"
                aria-label="Mostrar destinatarios"
                aria-expanded={open}
                aria-controls={detailsId}
                onClick={() => setOpen((value) => !value)}
              >
                {open ? <Minus /> : <Plus />}
              </Button>
              <span className="text-muted-foreground">
                Obtenidos: {obtained} de {item.grants.length}
              </span>
            </div>
          </td>
        </tr>
      </tbody>
      <tbody id={detailsId} hidden={!open} className="bg-muted/40">
        <tr className="border-t border-border/60 text-xs text-muted-foreground [&>td]:px-3 [&>td]:py-1.5 [&>td]:font-medium">
          <td colSpan={3} className="pl-10">
            Destinatario
          </td>
          <td>Obtenido el</td>
          <td colSpan={2}>Estado</td>
        </tr>
        {item.grants.map((grant) => (
          <tr key={grant.recipient_identity} className="border-t border-border/60 [&>td]:px-3 [&>td]:py-2">
            <td colSpan={3}>
              <span className="flex items-center gap-2 pl-7">
                <CornerDownRight className="size-3.5 shrink-0 text-muted-foreground" />
                <span>{grant.recipient_identity}</span>
              </span>
            </td>
            <td className={cn('whitespace-nowrap', grant.consumed_at === null && 'text-muted-foreground')}>
              {grant.consumed_at ? formatDateTime(grant.consumed_at) : '—'}
            </td>
            <td colSpan={2}>
              <StatusBadge status={grantStatus(item, grant, now)} />
            </td>
          </tr>
        ))}
      </tbody>
    </>
  )
}

function StatusBadge({ status }: { status: string }) {
  const style = STATUS_STYLES[status] ?? { variant: 'secondary' }
  return (
    <Badge variant={style.variant} className={style.className}>
      {status}
    </Badge>
  )
}
