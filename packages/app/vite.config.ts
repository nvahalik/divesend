import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import basicSsl from '@vitejs/plugin-basic-ssl'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  // Web Bluetooth requires a secure context: it works on http://localhost but is
  // blocked on any other http origin (e.g. hitting the dev server by LAN IP from a
  // phone). basic-ssl serves the dev server over https with a self-signed cert
  // (accept the one-time browser warning). It also keeps the Worker's `Secure`
  // session cookies working when the app is reached over the network.
  plugins: [react(), tailwindcss(), basicSsl()],
  test: {
    environment: 'node',
  },
  server: {
    // The Worker (packages/worker, `npm run dev` -> wrangler dev on :8787) owns
    // everything under /api -- both /api/auth/* and /api/ssi/* (it holds the
    // linked SSI credentials and proxies api.divessi.com server-side). Without
    // this, /api/auth/me falls through to the SPA fallback and the app hangs on
    // "Loading…".
    proxy: {
      '/api': {
        target: process.env.VITE_API_TARGET ?? 'http://localhost:8787',
        changeOrigin: true,
      },
    },
  },
})
