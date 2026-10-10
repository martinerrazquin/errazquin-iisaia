import { LockKeyhole, LogIn, LogOut, UserRound } from 'lucide-react'
import { Link, NavLink, Outlet, useMatch } from 'react-router'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useAuth } from '../auth/context'

function navLinkClass({ isActive }: { isActive: boolean }) {
  return cn(
    'rounded-md px-2.5 py-1.5 transition-colors hover:bg-muted hover:text-foreground',
    isActive ? 'bg-muted font-medium text-foreground' : 'text-muted-foreground',
  )
}

export function Layout() {
  const { user, login, logout } = useAuth()
  // The admin table needs room; forms and reading stay narrow. The header keeps the wide width so it does not jump.
  const width = useMatch('/admin') ? 'max-w-6xl' : 'max-w-3xl'
  return (
    <div className="min-h-svh bg-muted/40">
      <header className="border-b bg-background">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
          <Link to="/" className="flex items-center gap-2 font-semibold tracking-tight">
            <span className="flex size-7 items-center justify-center rounded-md bg-primary text-primary-foreground">
              <LockKeyhole className="size-4" />
            </span>
            Chismoso
          </Link>
          <nav className="flex items-center gap-1 text-sm">
            <NavLink to="/" end className={navLinkClass}>
              Crear
            </NavLink>
            <NavLink to="/admin" className={navLinkClass}>
              Administración
            </NavLink>
          </nav>
          <div className="ml-auto flex items-center gap-3 text-sm">
            {user ? (
              <>
                <span className="flex items-center gap-1.5 text-muted-foreground">
                  <UserRound className="size-4" />
                  <span>Sesión: {user.profile.preferred_username}</span>
                </span>
                <Button type="button" variant="outline" size="sm" onClick={() => void logout()}>
                  <LogOut />
                  Cerrar sesión
                </Button>
              </>
            ) : (
              <Button type="button" size="sm" onClick={() => void login()}>
                <LogIn />
                Iniciar sesión
              </Button>
            )}
          </div>
        </div>
      </header>
      <main className={cn('mx-auto px-4 py-8 sm:py-12', width)}>
        <Outlet />
      </main>
    </div>
  )
}
