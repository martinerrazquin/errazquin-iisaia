import { expect, test } from '@playwright/test'
import { createShare, fragmentParts, instrumentedPage, loginViaPopup, newUserPage, openLinkAs, PASSWORDS, reveal } from './support'

const LINK_SHAPE = /^http:\/\/app\.localhost:3000\/s#v=1&t=[A-Za-z0-9_-]{43}&k=[A-Za-z0-9_-]{43}$/
const unique = (prefix: string) => `${prefix} ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

test('individual links: each recipient reveals exactly once', async ({ browser }) => {
  const sender = await newUserPage(browser, 'aperez')
  const secret = `${unique('db-pass')} ñandú 🔐`
  const links = await createShare(sender, { plaintext: secret, recipients: ['bgonzalez', 'csaul'], label: unique('e2e individual') })
  expect(links.bgonzalez).toMatch(LINK_SHAPE)
  expect(links.bgonzalez).not.toBe(links.csaul)

  for (const recipient of ['bgonzalez', 'csaul']) {
    const page = await openLinkAs(browser, recipient, links[recipient])
    await reveal(page)
    await expect(page.getByLabel('Secreto revelado')).toHaveValue(secret)

    await page.reload()
    await loginViaPopup(page, recipient)
    await reveal(page)
    await expect(page.getByRole('alert')).toContainText('Este secreto ya fue obtenido')
  }
})

test('shared link: same URL, independent one-time grants', async ({ browser }) => {
  const sender = await newUserPage(browser, 'aperez')
  const secret = unique('shared-secret')
  const links = await createShare(sender, {
    plaintext: secret,
    recipients: ['bgonzalez', 'csaul'],
    label: unique('e2e shared'),
    shared: true,
  })
  expect(links.bgonzalez).toBe(links.csaul)
  for (const recipient of ['bgonzalez', 'csaul']) {
    const page = await openLinkAs(browser, recipient, links[recipient])
    await reveal(page)
    await expect(page.getByLabel('Secreto revelado')).toHaveValue(secret)
  }
  const outsider = await openLinkAs(browser, 'dlopez', links.bgonzalez)
  await reveal(outsider)
  await expect(outsider.getByRole('alert')).toContainText('no está destinado a tu usuario')
})

test('wrong user gets 404 and does not consume the rightful grant', async ({ browser }) => {
  const sender = await newUserPage(browser, 'aperez')
  const secret = unique('wrong-user')
  const links = await createShare(sender, { plaintext: secret, recipients: ['bgonzalez'], label: unique('e2e wrong user') })

  const intruder = await openLinkAs(browser, 'csaul', links.bgonzalez)
  await reveal(intruder)
  await expect(intruder.getByRole('alert')).toContainText('no está destinado a tu usuario')

  const rightful = await openLinkAs(browser, 'bgonzalez', links.bgonzalez)
  await reveal(rightful)
  await expect(rightful.getByLabel('Secreto revelado')).toHaveValue(secret)
})

test('tampered key: grant is consumed once and decryption fails locally', async ({ browser }) => {
  const sender = await newUserPage(browser, 'aperez')
  const links = await createShare(sender, { plaintext: unique('tamper'), recipients: ['bgonzalez'], label: unique('e2e tamper') })
  const { k } = fragmentParts(links.bgonzalez)
  const replacement = k[0] === 'A' ? 'B' : 'A' // changing the first char keeps a valid 32-byte key
  const tampered = links.bgonzalez.replace(`k=${k}`, `k=${replacement}${k.slice(1)}`)

  const page = await openLinkAs(browser, 'bgonzalez', tampered)
  await reveal(page)
  await expect(page.getByRole('alert')).toContainText('ya fue consumido')

  const again = await openLinkAs(browser, 'bgonzalez', links.bgonzalez)
  await reveal(again)
  await expect(again.getByRole('alert')).toContainText('Este secreto ya fue obtenido')
})

test('login never auto-consumes; token and key never leave the fragment or reach Keycloak', async ({ browser }) => {
  const sender = await newUserPage(browser, 'aperez')
  const links = await createShare(sender, { plaintext: unique('leak-check'), recipients: ['bgonzalez'], label: unique('e2e leak') })
  const { t, k } = fragmentParts(links.bgonzalez)

  const context = await browser.newContext()
  const seen: { url: string; body: string }[] = []
  context.on('request', (request) => seen.push({ url: request.url(), body: request.postData() ?? '' }))
  const page = await context.newPage()
  await page.goto(links.bgonzalez)
  await loginViaPopup(page, 'bgonzalez')

  const isConsume = (url: string) => url.includes('/api/v1/access/consume')
  expect(seen.filter((r) => isConsume(r.url))).toHaveLength(0)

  // Memory-only OIDC: nothing persisted in web storage after a real Keycloak login.
  expect(await page.evaluate(() => localStorage.length + sessionStorage.length)).toBe(0)

  await reveal(page)
  await expect(page.getByLabel('Secreto revelado')).toBeVisible()
  expect(seen.filter((r) => isConsume(r.url))).toHaveLength(1)
  for (const request of seen) {
    expect(request.url).not.toContain(t)
    expect(request.url).not.toContain(k)
    expect(request.body).not.toContain(k)
    if (!isConsume(request.url)) expect(request.body).not.toContain(t)
  }
})

test('malformed link shows an error and never calls the API', async ({ page }) => {
  const calls: string[] = []
  page.on('request', (request) => {
    if (request.url().includes('/api/')) calls.push(request.url())
  })
  await page.goto('/s#v=1&t=abc&k=def')
  await expect(page.getByRole('alert')).toContainText('El enlace está incompleto o no es válido')
  expect(calls).toHaveLength(0)
})

test('admin sees metadata only; non-admin is refused', async ({ browser }) => {
  const sender = await newUserPage(browser, 'aperez')
  const label = unique('e2e admin')
  const secret = unique('admin-secret')
  await createShare(sender, { plaintext: secret, recipients: ['bgonzalez'], label })

  const admin = await newUserPage(browser, 'flapinto')
  const responsePromise = admin.waitForResponse((r) => r.url().includes('/api/v1/admin/shares'))
  await admin.getByRole('link', { name: 'Administración' }).click()
  const body = await (await responsePromise).json()
  const item = body.items.find((i: { label: string }) => i.label === label)
  expect(Object.keys(item).sort()).toEqual(
    ['created_at', 'creator_identity', 'expires_at', 'grants', 'id', 'label', 'payload_deleted_at', 'revoked_at'].sort(),
  )
  expect(JSON.stringify(body)).not.toMatch(/ciphertext|nonce|access_token/)
  expect(JSON.stringify(body)).not.toContain(secret)
  await expect(admin.getByText(label)).toBeVisible()

  const other = await newUserPage(browser, 'dlopez')
  await other.getByRole('link', { name: 'Administración' }).click()
  await expect(other.getByRole('alert')).toContainText('No tenés permisos de administración.')
})

test('MAX_PLAINTEXT_BYTES is enforced by the UI and a max-size secret is accepted by the backend', async ({ browser }) => {
  const max = Number(process.env.MAX_PLAINTEXT_BYTES ?? 65536)
  const page = await newUserPage(browser, 'aperez')
  await page.getByLabel('Secreto', { exact: true }).fill('a'.repeat(max + 1))
  await expect(page.getByText(/supera el tamaño máximo/)).toBeVisible()
  await expect(page.getByRole('button', { name: 'Cifrar y crear enlaces' })).toBeDisabled()

  const links = await createShare(page, { plaintext: 'a'.repeat(max), recipients: ['bgonzalez'], label: unique('e2e max') })
  expect(links.bgonzalez).toMatch(LINK_SHAPE)
})

test('dev server hot reload websocket connects through the proxy', async ({ page }) => {
  // 'websocket' fires before the handshake; only a frame from Vite proves Caddy forwarded the upgrade and Vite accepted it.
  let connected = false
  page.on('websocket', (ws) => {
    if (!ws.url().startsWith('ws://app.localhost:3000')) return
    ws.on('framereceived', (frame) => {
      if (typeof frame.payload === 'string' && frame.payload.includes('"type":"connected"')) connected = true
    })
  })
  await page.goto('/')
  await expect.poll(() => connected).toBe(true)
})

test('no CSP violations during a full dev flow', async ({ browser }) => {
  const violations: string[] = []
  const sender = await instrumentedPage(browser, violations)
  await sender.goto('/')
  await loginViaPopup(sender, 'aperez')
  const secret = unique('csp')
  const links = await createShare(sender, { plaintext: secret, recipients: ['bgonzalez'], label: unique('e2e csp') })

  const recipient = await instrumentedPage(browser, violations)
  await recipient.goto(links.bgonzalez)
  await loginViaPopup(recipient, 'bgonzalez')
  await reveal(recipient)
  await expect(recipient.getByLabel('Secreto revelado')).toHaveValue(secret)

  expect(violations).toEqual([])
})

test('copy-link button puts the exact link on the clipboard and the copied link works', async ({ browser }) => {
  const sender = await newUserPage(browser, 'aperez')
  await sender.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin: 'http://app.localhost:3000' })
  const secret = unique('copied-link')
  const links = await createShare(sender, { plaintext: secret, recipients: ['bgonzalez', 'csaul'], label: unique('e2e copy') })

  const row = sender.getByTestId('share-links').locator('li[data-recipient="csaul"]')
  await row.getByRole('button', { name: 'Copiar enlace' }).click()
  await expect(row.getByRole('button', { name: 'Copiado' })).toBeVisible()
  const copied = await sender.evaluate(() => navigator.clipboard.readText())
  expect(copied).toBe(links.csaul)
  expect(copied).not.toBe(links.bgonzalez)

  const page = await openLinkAs(browser, 'csaul', copied)
  await reveal(page)
  await expect(page.getByLabel('Secreto revelado')).toHaveValue(secret)
})

test('closing the login popup shows a Spanish error and keeps the page usable', async ({ browser }) => {
  const sender = await newUserPage(browser, 'aperez')
  const secret = unique('popup-closed')
  const links = await createShare(sender, { plaintext: secret, recipients: ['bgonzalez'], label: unique('e2e popup') })

  const context = await browser.newContext()
  const consumeCalls: string[] = []
  context.on('request', (request) => {
    if (request.url().includes('/api/v1/access/consume')) consumeCalls.push(request.url())
  })
  const page = await context.newPage()
  await page.goto(links.bgonzalez)
  // The header also has an "Iniciar sesión" button; the LoginPrompt one inside the notice is the last match.
  const promptLogin = page.getByRole('button', { name: 'Iniciar sesión' }).last()

  const abandonedPopup = page.waitForEvent('popup')
  await promptLogin.click()
  await (await abandonedPopup).close()

  await expect(page.getByRole('alert')).toContainText('bloqueó la ventana emergente')
  await expect(promptLogin).toBeEnabled()
  expect(consumeCalls).toHaveLength(0)

  // A normal popup login from the same prompt still completes afterwards.
  const popupPromise = page.waitForEvent('popup')
  await promptLogin.click()
  const popup = await popupPromise
  const closed = popup.waitForEvent('close')
  await popup.locator('#username').fill('bgonzalez')
  await popup.locator('#password').fill(PASSWORDS.bgonzalez)
  await popup.locator('#kc-login').click()
  await closed
  await expect(page.getByText('Sesión: bgonzalez')).toBeVisible()
  expect(consumeCalls).toHaveLength(0)

  await reveal(page)
  await expect(page.getByLabel('Secreto revelado')).toHaveValue(secret)
  expect(consumeCalls).toHaveLength(1)
})
