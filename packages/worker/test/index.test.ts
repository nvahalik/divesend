import { describe, expect, it } from 'vitest';
import worker from '../src/index';
import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';

describe('health check', () => {
  it('GET /health returns ok', async () => {
    const request = new Request('http://localhost/health');
    const ctx = createExecutionContext();
    const response = await worker.fetch(request, env, ctx);
    await waitOnExecutionContext(ctx);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
  });
});
