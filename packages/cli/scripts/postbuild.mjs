// Ensure the built entrypoint is a runnable Node script:
//   1. a leading `#!/usr/bin/env node` shebang (tsc >=5 preserves the one in
//      src/cli.ts, but re-add it defensively if a future tsc drops it)
//   2. the executable bit (npm/npx re-set this from `bin` on install, but set
//      it here so `./dist/cli.js` works straight from a local build too)
import { chmodSync, readFileSync, writeFileSync } from 'node:fs';

const entry = new URL('../dist/cli.js', import.meta.url);
const SHEBANG = '#!/usr/bin/env node\n';

let src = readFileSync(entry, 'utf8');
if (!src.startsWith('#!')) {
  writeFileSync(entry, SHEBANG + src);
  src = SHEBANG + src;
}
chmodSync(entry, 0o755);
