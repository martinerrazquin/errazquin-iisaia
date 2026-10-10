import { type ReactNode, useEffect, useState } from 'react'
import type { AdminSharesPage } from '../api'
import { errorMessages } from '../i18n/messages'
import { AdminView } from '../pages/admin/AdminPage'
import { CreatedLinksView, CreatePage, type CreatedLinks } from '../pages/create/CreatePage'
import { NotFound } from '../pages/NotFound'
import { OpenPage, type Phase, UNCERTAIN_MESSAGE } from '../pages/open/OpenPage'
import { TestAuthProvider } from '../test/auth'

/**
 * Dev-only page (/_estados) that renders each page state with fake data, so a restyle can be reviewed
 * without clicking through real flows and `npm run csp-check` can load every state under the prod CSP.
 * Never part of the production bundle (see App.tsx).
 */

const fakeLink = (token: string) => `${window.location.origin}/s#v=1&t=${token.repeat(43)}&k=${'q'.repeat(43)}`
const inOneHour = new Date(Date.now() + 60 * 60 * 1000).toISOString()

const individual: CreatedLinks = {
  expiresAt: inOneHour,
  shared: false,
  links: [
    { recipient: 'bgonzalez', link: fakeLink('B') },
    { recipient: 'csaul', link: fakeLink('C') },
  ],
}
const shared: CreatedLinks = { ...individual, shared: true, links: individual.links.map((l) => ({ ...l, link: fakeLink('S') })) }

const loadedAt = new Date()
const hoursAgo = (hours: number) => new Date(Date.now() - hours * 60 * 60 * 1000).toISOString()
const adminPage: AdminSharesPage = {
  page: 1,
  page_size: 50,
  total: 120,
  items: [
    {
      id: '1',
      creator_identity: 'aperez',
      label: 'Staging DB',
      created_at: hoursAgo(1),
      expires_at: inOneHour,
      revoked_at: null,
      payload_deleted_at: null,
      grants: [
        { recipient_identity: 'bgonzalez', consumed_at: hoursAgo(0.5) },
        { recipient_identity: 'csaul', consumed_at: null },
      ],
    },
    {
      id: '2',
      creator_identity: 'bgonzalez',
      label: null,
      created_at: hoursAgo(30),
      expires_at: hoursAgo(6),
      revoked_at: null,
      payload_deleted_at: null,
      grants: [{ recipient_identity: 'aperez', consumed_at: null }],
    },
    {
      id: '3',
      creator_identity: 'csaul',
      label: 'API key proveedor',
      created_at: hoursAgo(50),
      expires_at: inOneHour,
      revoked_at: null,
      payload_deleted_at: null,
      grants: [{ recipient_identity: 'dlopez', consumed_at: hoursAgo(49) }],
    },
    {
      id: '4',
      creator_identity: 'aperez',
      label: 'Certificado VPN',
      created_at: hoursAgo(72),
      expires_at: inOneHour,
      revoked_at: hoursAgo(70),
      payload_deleted_at: null,
      grants: [{ recipient_identity: 'flapinto', consumed_at: null }],
    },
  ],
}

/** Logged in for the first render, then the session lapses: the create form shows its "log in to continue" state. */
function LapsingSession({ children }: { children: ReactNode }) {
  const [expired, setExpired] = useState(false)
  useEffect(() => {
    const id = window.setTimeout(() => setExpired(true))
    return () => window.clearTimeout(id)
  }, [])
  return (
    <TestAuthProvider initialToken="fake-token" tokenExpired={expired}>
      {children}
    </TestAuthProvider>
  )
}

const validFragment = `#v=1&t=${'A'.repeat(43)}&k=${'A'.repeat(43)}`

function Open({ phase, loggedIn = true, fragment = validFragment }: { phase?: Phase; loggedIn?: boolean; fragment?: string }) {
  return (
    <TestAuthProvider initialToken={loggedIn ? 'fake-token' : null}>
      <OpenPage fragment={fragment} initialPhase={phase} />
    </TestAuthProvider>
  )
}

function State({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-4">
      <h2 className="border-b pb-2 font-mono text-xs tracking-wide text-muted-foreground uppercase">{title}</h2>
      {children}
    </div>
  )
}

export function StatesGallery() {
  return (
    <div className="flex flex-col gap-16">
      <State title="Crear · sin sesión">
        <TestAuthProvider>
          <CreatePage />
        </TestAuthProvider>
      </State>
      <State title="Crear · con sesión">
        <TestAuthProvider initialToken="fake-token">
          <CreatePage />
        </TestAuthProvider>
      </State>
      <State title="Crear · sesión vencida con el formulario abierto">
        <LapsingSession>
          <CreatePage />
        </LapsingSession>
      </State>
      <State title="Crear · enlaces individuales">
        <CreatedLinksView created={individual} onReset={() => {}} />
      </State>
      <State title="Crear · enlace único">
        <CreatedLinksView created={shared} onReset={() => {}} />
      </State>
      <State title="Abrir · enlace no válido">
        <Open fragment="#v=1&t=abc" />
      </State>
      <State title="Abrir · sin sesión">
        <Open loggedIn={false} />
      </State>
      <State title="Abrir · listo para revelar">
        <Open />
      </State>
      <State title="Abrir · obteniendo">
        <Open phase={{ kind: 'consuming' }} />
      </State>
      <State title="Abrir · revelado">
        <Open phase={{ kind: 'revealed', plaintext: 'postgres://app:S3cr3t-ñandú@db.internal:5432/staging' }} />
      </State>
      <State title="Abrir · no se pudo descifrar">
        <Open phase={{ kind: 'decrypt_failed' }} />
      </State>
      <State title="Abrir · error definitivo (p. ej. ya obtenido)">
        <Open phase={{ kind: 'failed', message: errorMessages.share_already_consumed, canRetry: false }} />
      </State>
      <State title="Abrir · respuesta incierta, se puede reintentar">
        <Open
          phase={{
            kind: 'failed',
            message: UNCERTAIN_MESSAGE,
            canRetry: true,
          }}
        />
      </State>
      {/* Admin uses a wider page (see Layout); these states break out of the gallery's narrow column to match. */}
      <div className="relative left-1/2 flex w-[min(72rem,100vw)] -translate-x-1/2 flex-col gap-16 px-4">
        <State title="Administración · tabla">
          <AdminView loaded={{ page: 1, ok: true, data: adminPage, loadedAt }} onRefresh={() => {}} onPageChange={() => {}} />
        </State>
        <State title="Administración · actualizando">
          <AdminView
            loaded={{ page: 1, ok: true, data: adminPage, loadedAt }}
            refreshing
            onRefresh={() => {}}
            onPageChange={() => {}}
          />
        </State>
        <State title="Administración · cargando">
          <AdminView loaded={null} onRefresh={() => {}} onPageChange={() => {}} />
        </State>
        <State title="Administración · sin datos">
          <AdminView
            loaded={{ page: 1, ok: true, data: { items: [], page: 1, page_size: 50, total: 0 }, loadedAt }}
            onRefresh={() => {}} onPageChange={() => {}}
          />
        </State>
        <State title="Administración · sin permisos">
          <AdminView
            loaded={{ page: 1, ok: false, message: errorMessages.admin_access_required }}
            onRefresh={() => {}} onPageChange={() => {}}
          />
        </State>
      </div>
      <State title="Página no encontrada">
        <NotFound />
      </State>
    </div>
  )
}
