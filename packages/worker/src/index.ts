import { Hono } from 'hono';
import { authRoutes } from './auth/routes';
import { ssiRoutes } from './ssi/routes';

type Env = {
  DB: D1Database;
  SSI_TOKEN_CACHE: KVNamespace;
  SSI_ENCRYPTION_KEY: string;
};

const app = new Hono<{ Bindings: Env }>();

app.get('/health', (c) => c.json({ ok: true }));
app.route('/api/auth', authRoutes);
app.route('/api/ssi', ssiRoutes);

export default app;
