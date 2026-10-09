import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { createUserManager } from './auth/oidc'
import './index.css'

const userManager = createUserManager()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App userManager={userManager} />
  </StrictMode>,
)
