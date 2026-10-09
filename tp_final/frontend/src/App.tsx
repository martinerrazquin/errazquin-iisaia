import type { UserManager } from 'oidc-client-ts'
import { BrowserRouter, Route, Routes } from 'react-router'
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

export function App({ userManager }: { userManager: UserManager }) {
  if (!isSecureCryptoAvailable()) return <InsecureContext />
  return (
    <AuthProvider userManager={userManager}>
      <BrowserRouter>
        <Routes>
          <Route path="/auth/callback" element={<AuthCallback userManager={userManager} />} />
          <Route element={<Layout />}>
            <Route index element={<CreatePage />} />
            <Route path="s" element={<OpenPage />} />
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
