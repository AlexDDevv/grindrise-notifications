import { validateEnv } from './config/env.config';
import { BrevoEmailProvider } from './email/brevo.provider';
import { startHealthServer } from './health';
import { logger } from './logger';
import { createWorker } from './queue/worker';

function main(): void {
  // Échoue au boot si une variable manque : CapRover signale immédiatement un
  // container mal configuré.
  const config = validateEnv(process.env);

  const email = new BrevoEmailProvider(config.brevoApiKey, {
    email: config.brevoSenderEmail,
    name: config.brevoSenderName,
    replyTo: config.brevoReplyTo,
  });

  const worker = createWorker(config, email);
  const health = startHealthServer(config.port, worker);

  logger.info('Worker à l\'écoute', {
    queue: config.queueName,
    provider: email.name,
    concurrency: config.concurrency,
  });

  // Sans arrêt propre, un redéploiement CapRover coupe un envoi en cours.
  // `worker.close()` laisse le job courant aller au bout.
  const shutdown = (signal: string): void => {
    logger.info('Arrêt demandé', { signal });
    health.close();
    worker
      .close()
      .then(() => process.exit(0))
      .catch((error: unknown) => {
        logger.error('Arrêt en erreur', { reason: String(error) });
        process.exit(1);
      });
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

try {
  main();
} catch (error) {
  logger.error('Démarrage impossible', {
    reason: error instanceof Error ? error.message : String(error),
  });
  process.exit(1);
}
