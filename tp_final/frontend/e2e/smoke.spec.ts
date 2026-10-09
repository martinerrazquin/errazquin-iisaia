import { expect, test } from '@playwright/test'
import { createShare, instrumentedPage, loginViaPopup, reveal } from './support'

test('serves the static bundle with the strict production headers', async ({ request }) => {
  const response = await request.get('/')
  expect(response.status()).toBe(200)
  const csp = response.headers()['content-security-policy']
  expect(csp).toContain("script-src 'self';")
  expect(csp).toContain("style-src 'self';")
  expect(csp).toContain("frame-ancestors 'none'")
  expect(csp).not.toContain('unsafe-inline')
  expect(response.headers()['referrer-policy']).toBe('no-referrer')
  expect(response.headers()['x-content-type-options']).toBe('nosniff')
  expect(response.headers()['cache-control']).toBe('no-store')
  expect(await response.text()).not.toContain('/@vite/client')

  const deepLink = await request.get('/admin')
  expect(deepLink.status()).toBe(200)
})

test('create and reveal work under the strict CSP with no violations', async ({ browser }) => {
  // Both contexts are watched from before their first navigation: initial load, login popup, callback and reveal.
  const violations: string[] = []
  const sender = await instrumentedPage(browser, violations)
  await sender.goto('/')
  await loginViaPopup(sender, 'aperez')
  const secret = `smoke ${Date.now()} ñ`
  const links = await createShare(sender, { plaintext: secret, recipients: ['bgonzalez'], label: `smoke ${Date.now()}` })

  const recipient = await instrumentedPage(browser, violations)
  await recipient.goto(links.bgonzalez)
  await loginViaPopup(recipient, 'bgonzalez')
  await reveal(recipient)
  await expect(recipient.getByLabel('Secreto revelado')).toHaveValue(secret)
  expect(violations).toEqual([])
})
