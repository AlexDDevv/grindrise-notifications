import { createServer, type Server } from 'node:http';
import type { Worker } from 'bullmq';

import { logger } from './logger';

/**
 * Sonde de vie.
 *
 * Ce service ne publie aucune route métier — cocher « Do not expose as web-app »
 * dans CapRover. Ce serveur n'existe que pour donner un HEALTHCHECK Docker réel
 * et permettre une vérification manuelle après déploiement.
 */
export function startHealthServer(port: number, worker: Worker): Server {
  const server = createServer((req, res) => {
    if (req.url !== '/health') {
      res.writeHead(404).end();
      return;
    }

    const running = worker.isRunning();
    res.writeHead(running ? 200 : 503, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ status: running ? 'ok' : 'stopped' }));
  });

  server.listen(port, '0.0.0.0', () => {
    logger.info('Sonde de vie à l\'écoute', { port });
  });

  return server;
}
