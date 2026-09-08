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
//
// Unauthenticated by design (guests must be able to report; no PII in the
// payload). requireMatchingOrigin is an Origin-header check and is trivially
// curl-spoofable, so a well-formed flood costs billed writeDataPoint calls and
// attacker-chosen logTail storage. Add a Cloudflare Rate Limiting / WAF rule on
// this path before public deploy — that keys on IP at the edge and needs no
// Worker code change, preserving the "the Worker never reads the client IP"
// invariant. Treat `logTail` as attacker-controllable wherever it is rendered.
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
  } catch (e) {
    // Analytics Engine write failed (quota, transient, or a misconfigured
    // binding) — nothing the caller can do; the event is best-effort. Log it
    // so a permanently broken dataset shows up in Workers observability
    // instead of silently discarding every event forever.
    console.error('telemetry writeDataPoint failed', e);
  }
  return c.json({ ok: true });
});
