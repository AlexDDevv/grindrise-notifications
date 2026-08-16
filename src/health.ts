import { createServer, type Server } from 'node:http';
import type { Worker } from 'bullmq';

import { logger } from './logger';

/**
 * Ce dont la sonde a besoin de la connexion Redis — un vrai `IORedis` le
 * satisfait. `status` vaut `'ready'` quand la connexion est opérationnelle ;
 * toute autre valeur (`'wait'`, `'connecting'`, `'reconnecting'`, `'close'`,
 * `'end'`...) veut dire que rien ne sera consommé sur la queue.
 */
export type RedisConnectionLike = { readonly status: string };

/**
 * Sonde de vie.
 *
 * Ce service ne publie aucune route métier — cocher « Do not expose as web-app »
 * dans CapRover. Ce serveur n'existe que pour donner un HEALTHCHECK Docker réel
 * et permettre une vérification manuelle après déploiement.
 *
 * `worker.isRunning()` dit seulement que `run()` a été appelé, jamais que
 * Redis répond : la connexion utilise `maxRetriesPerRequest: null`, donc un
 * mot de passe erroné ou un Redis injoignable laisse le worker « tourner »
 * indéfiniment sans jamais consommer un seul job. La sonde ne répond 200 que
 * si le worker tourne ET que la connexion Redis est prête ; sinon 503, pour
 * qu'un HEALTHCHECK Docker (ou une supervision externe) détecte l'incident au
 * lieu de le rater silencieusement.
 */
export function startHealthServer(
  port: number,
  worker: Worker,
  connection: RedisConnectionLike,
): Server {
  const server = createServer((req, res) => {
    if (req.url !== '/health') {
      res.writeHead(404).end();
      return;
    }

    const running = worker.isRunning();
    const redisReady = connection.status === 'ready';
    const healthy = running && redisReady;

    res.writeHead(healthy ? 200 : 503, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ status: healthy ? 'ok' : 'stopped', redis: connection.status }));
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
