import { defineConfig } from 'vite'

// Fixed port so the deck never contends with the app stack (3000 proxy, 5173 Vite, 5433 db, 8080 Keycloak).
const server = { host: '127.0.0.1', port: 4300, strictPort: true }

export default defineConfig({
  base: './',
  server,
  preview: server,
})
