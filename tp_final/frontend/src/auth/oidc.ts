import { InMemoryWebStorage, UserManager, WebStorageStateStore } from 'oidc-client-ts'
import { config } from '../config'

/**
 * Popup-based Authorization Code + PKCE (S256 by default in oidc-client-ts).
 * Tokens and protocol state live in memory only: no localStorage, no refresh tokens, no silent renew.
 */
export function createUserManager(origin: string = window.location.origin): UserManager {
  const callback = `${origin}/auth/callback`
  return new UserManager({
    authority: config.oidcIssuer,
    client_id: config.oidcClientId,
    redirect_uri: callback,
    popup_redirect_uri: callback,
    response_type: 'code',
    scope: 'openid',
    automaticSilentRenew: false,
    monitorSession: false,
    loadUserInfo: false,
    userStore: new WebStorageStateStore({ store: new InMemoryWebStorage() }),
    stateStore: new WebStorageStateStore({ store: new InMemoryWebStorage() }),
  })
}
