import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    // payloadTransformer's golden snapshots hardcode wall-clock times formatted in this
    // zone (matching the dev machine); pin it so CI runners (which default to UTC) match.
    env: { TZ: 'America/Chicago' },
  },
});
