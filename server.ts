import 'dotenv/config';
import express from 'express';
import type { Request, Response } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { aiUidLimiter, PORT, PROJECT_ROOT_DIR } from './server/config.ts';
import { createAiRouter } from './server/routes/aiRoutes.ts';
import { createWebhookRouter } from './server/routes/webhookRoutes.ts';

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '256kb' }));

  app.use('/api/ai', createAiRouter());
  app.use('/api/webhook', createWebhookRouter());

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(PROJECT_ROOT_DIR, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req: Request, res: Response) => {
      const indexPath = path.join(distDir, 'index.html');
      if (fs.existsSync(indexPath)) {
        res.sendFile(indexPath);
      } else {
        res.status(404).send('Build output not found.');
      }
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(
      `IT Helpdesk server running at http://localhost:${PORT} (rateLimiter=${aiUidLimiter.backend}, failurePolicy=${aiUidLimiter.failurePolicy})`
    );
    if (process.env.NODE_ENV === 'production' && aiUidLimiter.backend === 'memory') {
      console.warn(
        '[Security] Rate limiter is using single-instance in-memory storage; configure REDIS_URL or REDIS_REST_URL for multi-instance Cloud Run scaling.'
      );
    }
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
