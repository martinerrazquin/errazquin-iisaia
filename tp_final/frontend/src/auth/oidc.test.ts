// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { config } from '../config'
import { createUserManager } from './oidc'

describe('createUserManager', () => {
  it('uses Authorization Code + PKCE via popup with memory-only stores', async () => {
    const manager = createUserManager('http://app.localhost:3000')
    const settings = manager.settings
    expect(settings.authority).toBe(config.oidcIssuer)
    expect(settings.client_id).toBe(config.oidcClientId)
    expect(settings.popup_redirect_uri).toBe('http://app.localhost:3000/auth/callback')
    expect(settings.redirect_uri).toBe('http://app.localhost:3000/auth/callback')
    expect(settings.response_type).toBe('code')
    expect(settings.disablePKCE).toBeFalsy()
    expect(settings.scope).toBe('openid')
    expect(settings.automaticSilentRenew).toBe(false)
    expect(settings.monitorSession).toBe(false)

    await settings.userStore.set('probe', 'user')
    await settings.stateStore.set('probe', 'state')
    expect(await settings.userStore.get('probe')).toBe('user')
    expect(localStorage.length).toBe(0)
    expect(sessionStorage.length).toBe(0)
  })
})
