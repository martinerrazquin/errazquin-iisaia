import { type Browser, expect, type Page } from '@playwright/test'

/** Development-only Keycloak test users (password = lowercase first name). Never production credentials. */
export const PASSWORDS: Record<string, string> = {
  aperez: 'alicia',
  bgonzalez: 'boberto',
  csaul: 'carlitos',
  dlopez: 'daniel',
  efuseneco: 'elena',
  flapinto: 'franco',
}

/** Clicks "Iniciar sesión", completes the Keycloak popup if it asks for credentials, waits for the session. */
export async function loginViaPopup(page: Page, username: string): Promise<void> {
  const popupPromise = page.waitForEvent('popup')
  await page.getByRole('button', { name: 'Iniciar sesión' }).first().click()
  const popup = await popupPromise
  const closed = popup.waitForEvent('close')
  // With an existing Keycloak SSO cookie the popup completes and closes on its own.
  const needsForm = await Promise.race([
    popup
      .locator('#username')
      .waitFor({ timeout: 20_000 })
      .then(
        () => true,
        () => false,
      ),
    closed.then(() => false),
  ])
  if (needsForm) {
    await popup.locator('#username').fill(username)
    await popup.locator('#password').fill(PASSWORDS[username])
    await popup.locator('#kc-login').click()
    await closed
  }
  await expect(page.getByText(`Sesión: ${username}`)).toBeVisible()
}

export async function newUserPage(browser: Browser, username: string): Promise<Page> {
  const context = await browser.newContext()
  const page = await context.newPage()
  await page.goto('/')
  await loginViaPopup(page, username)
  return page
}

/** Fresh browser context (fresh tab memory), opens the link, logs in. Does NOT click reveal. */
export async function openLinkAs(browser: Browser, username: string, link: string): Promise<Page> {
  const context = await browser.newContext()
  const page = await context.newPage()
  await page.goto(link)
  await loginViaPopup(page, username)
  return page
}

export interface CreateOptions {
  plaintext: string
  recipients: string[]
  label: string
  shared?: boolean
}

export async function createShare(page: Page, options: CreateOptions): Promise<Record<string, string>> {
  await page.getByLabel('Secreto', { exact: true }).fill(options.plaintext)
  await page.getByLabel('Destinatarios', { exact: true }).fill(options.recipients.join(', '))
  await page.getByLabel('Etiqueta (opcional)').fill(options.label)
  if (options.shared) await page.getByLabel('Usar un único enlace para todos los destinatarios').check()
  await page.getByRole('button', { name: 'Cifrar y crear enlaces' }).click()
  const list = page.getByTestId('share-links')
  await expect(list).toBeVisible()
  const links: Record<string, string> = {}
  for (const recipient of options.recipients) {
    links[recipient] = ((await list.locator(`li[data-recipient="${recipient}"] code`).textContent()) ?? '').trim()
  }
  return links
}

export function fragmentParts(link: string): { t: string; k: string } {
  const params = new Map(new URL(link).hash.slice(1).split('&').map((p) => p.split('=') as [string, string]))
  return { t: params.get('t') ?? '', k: params.get('k') ?? '' }
}

export async function reveal(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Revelar secreto' }).click()
}
