import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import basicSsl from '@vitejs/plugin-basic-ssl'
import { defineConfig, type Plugin } from 'vitest/config'

// Vite's static file server doesn't know .fit/.uddf, so it serves them with no
// Content-Type -- Safari on iOS then tries to render them inline instead of
// downloading. Force a download for the sample-dive fixtures under public/.
function forceDownloadSampleDives(): Plugin {
  return {
    name: 'force-download-sample-dives',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url?.startsWith('/sample-dives/')) {
          const name = req.url.split('/').pop() ?? 'dive-file';
          res.setHeader('Content-Type', 'application/octet-stream');
          res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
        }
        next();
      });
    },
  };
}

export default defineConfig({
  // Web Bluetooth requires a secure context: it works on http://localhost but is
  // blocked on any other http origin (e.g. hitting the dev server by LAN IP from a
  // phone). basic-ssl serves the dev server over https with a self-signed cert
  // (accept the one-time browser warning, or trust the cert directly -- see
  // packages/app/node_modules/.vite/basic-ssl/_cert.pem). It also keeps the
  // Worker's `Secure` session cookies working when the app is reached over the
  // network. The LAN and Tailscale IPs are listed explicitly so the cert's SAN
  // covers them -- update this if either address changes.
  plugins: [
    react(),
    tailwindcss(),
    basicSsl({ domains: ['localhost', '127.0.0.1', '10.11.1.112', '100.123.215.92'] }),
    forceDownloadSampleDives(),
  ],
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
