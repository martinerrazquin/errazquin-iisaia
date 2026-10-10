import { type ReactNode, useEffect, useState } from 'react'
import type { AdminSharesPage } from '../api'
import { SharesTable } from '../pages/admin/AdminPage'
import { CreatedLinksView, CreatePage, type CreatedLinks } from '../pages/create/CreatePage'
import { NotFound } from '../pages/NotFound'
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
      <State title="Administración · tabla">
        <SharesTable data={adminPage} now={loadedAt} onPageChange={() => {}} />
      </State>
      <State title="Página no encontrada">
        <NotFound />
      </State>
    </div>
  )
}
