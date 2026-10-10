// Builds the app, serves it with the exact production CSP from infra/caddy/Caddyfile.prod and loads every
// route (including the dev-only /_estados states page) in headless Chromium. Fails on any CSP violation.
// Dev mode cannot catch these: Vite injects CSS as <style> tags, so the dev proxy allows inline styles.
import { readFileSync } from 'node:fs'
import { chromium } from '@playwright/test'
import { build, preview } from 'vite'

const outDir = 'node_modules/.csp-check'
const issuer = process.env.VITE_OIDC_ISSUER || 'http://idp.localhost:8080/realms/chismoso'
const caddyfile = readFileSync(new URL('../../infra/caddy/Caddyfile.prod', import.meta.url), 'utf8')
const csp = caddyfile.match(/Content-Security-Policy "([^"]+)"/)[1].replace('{$OIDC_ORIGIN}', new URL(issuer).origin)
const fragment = `v=1&t=${'A'.repeat(43)}&k=${'A'.repeat(43)}`
const routes = ['/', '/_estados', '/s', `/s#${fragment}`, '/admin', '/no-existe']

await build({ mode: 'csp-check', logLevel: 'warn', build: { outDir, emptyOutDir: true } })
const server = await preview({
  mode: 'csp-check',
  logLevel: 'warn',
  build: { outDir },
  preview: { port: 4317, strictPort: false, headers: { 'Content-Security-Policy': csp } },
})
const base = server.resolvedUrls.local[0].replace(/\/$/, '')

const browser = await chromium.launch()
let failures = 0
try {
  for (const route of routes) {
    const page = await browser.newPage()
    const problems = []
    await page.addInitScript(() => {
      document.addEventListener('securitypolicyviolation', (e) => {
        console.error(`CSP violation: ${e.violatedDirective} blocked ${e.blockedURI || 'inline'} "${e.sample}"`)
      })
    })
    page.on('console', (m) => {
      if (m.type() === 'error' && /CSP violation|Content Security Policy/.test(m.text())) problems.push(m.text())
    })
    page.on('pageerror', (e) => problems.push(`page error: ${e.message}`))
    const response = await page.goto(base + route)
    if (response?.headers()['content-security-policy'] !== csp) problems.push('CSP header missing or different')
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(300)
    const unique = [...new Set(problems)]
    failures += unique.length
    console.log(`${unique.length ? '✗' : '✓'} ${route}`)
    for (const p of unique) console.log(`    ${p}`)
    await page.close()
  }
} finally {
  await browser.close()
  await new Promise((resolve) => server.httpServer.close(resolve))
}
console.log(failures ? `\n${failures} CSP problem(s).` : '\nNo CSP violations.')
process.exit(failures ? 1 : 0)
