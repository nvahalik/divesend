import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import basicSsl from '@vitejs/plugin-basic-ssl'
import { defineConfig, type Plugin } from 'vitest/config'
import { execSync } from 'node:child_process'

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

// Stamped into the bundle as __APP_VERSION__ so diagnostics reports can name the
// exact build. Short git sha in CI/local git checkouts; 'dev' when git isn't
// available (e.g. a tarball build).
const appVersion = (() => {
  try {
    return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim() || 'dev'
  } catch {
    return 'dev'
  }
})()

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(appVersion),
  },
  build: {
    // Brand logos (packages/app/src/assets/brand-*) are looked up per dive and
    // most are <4kB, so Vite's default would base64-inline them into the main
    // bundle -- shipping every brand to every visitor. Force them to stay
    // separate files that load only when a dive of that brand is rendered.
    // Everything else keeps the default inlining behaviour.
    assetsInlineLimit: (filePath: string) =>
      /[\\/]assets[\\/]brand-(logos|favicons)[\\/]/.test(filePath) ? false : undefined,
  },
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
        // Keep the browser's Host header (dev-server origin) instead of
        // rewriting it to the target's host. The Worker's requireMatchingOrigin
        // CSRF check compares the request Host against the Origin header, and
        // rewriting Host to localhost:8787 makes every state-changing request
        // (login, /api/ssi/*) 403 with "Invalid request origin".
        changeOrigin: false,
      },
    },
  },
})
