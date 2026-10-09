import type { UserManager } from 'oidc-client-ts'
import { BrowserRouter, Route, Routes, useLocation } from 'react-router'
import { AuthProvider } from './auth/AuthProvider'
import { InsecureContext } from './components/InsecureContext'
import { Layout } from './components/Layout'
import { RequireLogin } from './components/RequireLogin'
import { AdminPage } from './pages/admin/AdminPage'
import { AuthCallback } from './pages/AuthCallback'
import { CreatePage } from './pages/create/CreatePage'
import { NotFound } from './pages/NotFound'
import { OpenPage } from './pages/open/OpenPage'
import { isSecureCryptoAvailable } from './secureContext'

/**
 * Pasting another link into an open /s tab changes only the fragment, so the page is not reloaded
 * (browsers fire popstate, which the router observes). Remount so no state of the previous link survives.
 */
function OpenRoute() {
  return <OpenPage key={useLocation().hash} />
}

export function App({ userManager }: { userManager: UserManager }) {
  if (!isSecureCryptoAvailable()) return <InsecureContext />
  return (
    <AuthProvider userManager={userManager}>
      <BrowserRouter>
        <Routes>
          <Route path="/auth/callback" element={<AuthCallback userManager={userManager} />} />
          <Route element={<Layout />}>
            <Route index element={<CreatePage />} />
            <Route path="s" element={<OpenRoute />} />
            <Route
              path="admin"
              element={
                <RequireLogin>
                  <AdminPage />
                </RequireLogin>
              }
            />
            <Route path="*" element={<NotFound />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  )
}
