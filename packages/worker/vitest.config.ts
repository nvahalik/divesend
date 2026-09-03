import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-pool-workers';

const dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [
    cloudflareTest(async () => {
      const migrationsPath = path.join(dirname, 'migrations');
      const migrations = await readD1Migrations(migrationsPath);
      return {
        wrangler: { configPath: './wrangler.jsonc' },
        miniflare: {
          bindings: {
            // Test-only binding so migrations can be applied in a setup file.
            TEST_MIGRATIONS: migrations,
            // Dummy AES-256 key (32 zero bytes, base64) so crypto.ts can import a
            // key under test. The real value is a `wrangler secret`, never committed.
            SSI_ENCRYPTION_KEY: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
          },
        },
      };
    }),
  ],
  test: {
    setupFiles: ['./test/apply-migrations.ts'],
  },
});
