// Copies the compiled WASM engine from @divesend/libdivecomputer-wasm into
// public/ so Vite serves it at /libdivecomputer.js. Runs as predev/prebuild.
//
// The engine artifacts are gitignored and built on demand: if the package's
// dist/ is missing, this runs its build first (which needs the Emscripten SDK).
// It does not detect staleness -- after changing the engine's C sources, run
// `npm run build -w @divesend/libdivecomputer-wasm` (or `... run clean ...`)
// yourself.

import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const appDir = dirname(dirname(fileURLToPath(import.meta.url)))
const enginePkgDir = dirname(require.resolve('@divesend/libdivecomputer-wasm/package.json'))
const distDir = join(enginePkgDir, 'dist')
const publicDir = join(appDir, 'public')
const files = ['libdivecomputer.js', 'libdivecomputer.wasm']

if (files.some((f) => !existsSync(join(distDir, f)))) {
  console.log('[sync-engine] engine not built -- running @divesend/libdivecomputer-wasm build...')
  try {
    execFileSync('npm', ['run', 'build'], { cwd: enginePkgDir, stdio: 'inherit' })
  } catch {
    console.error(
      '[sync-engine] engine build failed. If emcc is missing, install and activate the ' +
        'Emscripten SDK (e.g. `source ~/Code/emsdk/emsdk_env.sh`) and retry.',
    )
    process.exit(1)
  }
}

mkdirSync(publicDir, { recursive: true })
for (const f of files) {
  const src = join(distDir, f)
  if (!existsSync(src)) {
    console.error(`[sync-engine] expected ${src} after build, but it is missing.`)
    process.exit(1)
  }
  copyFileSync(src, join(publicDir, f))
  console.log(`[sync-engine] ${f} -> public/${f}`)
}
