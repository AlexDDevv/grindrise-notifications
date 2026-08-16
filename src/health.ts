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

  // Sans cet écouteur, un échec de bind (port déjà occupé, port privilégié
  // sans droits...) remonte comme exception non rattrapée et fait planter
  // tout le process — job en cours compris. La sonde n'est qu'un accessoire
  // de supervision : son échec ne doit jamais entraîner celui du worker, qui
  // continue de consommer la queue même sans elle.
  server.on('error', (error) => {
    logger.error('Sonde de vie indisponible', { port, reason: error.message });
  });

  server.listen(port, '0.0.0.0', () => {
    logger.info('Sonde de vie à l\'écoute', { port });
  });

  return server;
}
