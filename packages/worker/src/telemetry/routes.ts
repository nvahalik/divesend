// worker/src/telemetry/routes.ts
import { Hono } from 'hono';
import { requireMatchingOrigin } from '../auth/middleware';
import { MAX_BODY_BYTES, toDataPoint, validateConnectEvent } from './schema';

type Env = { CONNECT_TELEMETRY: AnalyticsEngineDataset };

export const telemetryRoutes = new Hono<{ Bindings: Env }>();

// Anonymous on purpose: guests hit connection problems too, and there is no
// user data in the payload. requireMatchingOrigin keeps it same-origin only.
// Always 200s on a well-formed request — the client treats this as
// fire-and-forget and must never see a telemetry error.
telemetryRoutes.post('/connect', requireMatchingOrigin, async (c) => {
  const declaredLen = Number(c.req.header('content-length') ?? '0');
  if (Number.isFinite(declaredLen) && declaredLen > MAX_BODY_BYTES) {
    return c.json({ ok: false }, 413);
  }

  const raw = await c.req.text();
  if (raw.length > MAX_BODY_BYTES) {
    return c.json({ ok: false }, 413);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return c.json({ ok: false }, 400);
  }

  const event = validateConnectEvent(parsed);
  if (!event) {
    return c.json({ ok: false }, 400);
  }

  try {
    c.env.CONNECT_TELEMETRY.writeDataPoint(toDataPoint(event));
  } catch {
    // Analytics Engine write failed (quota, transient) — nothing the caller
    // can do; the event is best-effort.
  }
  return c.json({ ok: true });
});
