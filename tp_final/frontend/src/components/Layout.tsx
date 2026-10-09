import { Link, NavLink, Outlet } from 'react-router'
import { useAuth } from '../auth/context'

export function Layout() {
  const { user, login, logout } = useAuth()
  return (
    <>
      <header className="app-header">
        <Link to="/" className="brand">
          Chismoso
        </Link>
        <nav>
          <NavLink to="/" end>
            Crear
          </NavLink>
          <NavLink to="/admin">Administración</NavLink>
        </nav>
        <div>
          {user ? (
            <>
              <span>Sesión: {user.profile.preferred_username}</span>{' '}
              <button type="button" onClick={() => void logout()}>
                Cerrar sesión
              </button>
            </>
          ) : (
            <button type="button" onClick={() => void login()}>
              Iniciar sesión
            </button>
          )}
        </div>
      </header>
      <main>
        <Outlet />
      </main>
    </>
  )
}
