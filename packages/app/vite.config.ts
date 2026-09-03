import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [react(), tailwindcss()],
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
