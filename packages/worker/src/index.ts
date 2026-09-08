import { Hono } from 'hono';
import { authRoutes } from './auth/routes';
import { ssiRoutes } from './ssi/routes';
import { telemetryRoutes } from './telemetry/routes';

type Env = {
  DB: D1Database;
  SSI_TOKEN_CACHE: KVNamespace;
  SSI_ENCRYPTION_KEY: string;
  CONNECT_TELEMETRY: AnalyticsEngineDataset;
};

const app = new Hono<{ Bindings: Env }>();

app.get('/health', (c) => c.json({ ok: true }));
app.route('/api/auth', authRoutes);
app.route('/api/ssi', ssiRoutes);
app.route('/api/telemetry', telemetryRoutes);

export default app;
