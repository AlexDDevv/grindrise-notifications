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

  const { worker, connection } = createWorker(config, email);
  const health = startHealthServer(config.port, worker, connection);

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

    // Garde-fou : le timeout de 10 s sur l'appel Brevo borne un envoi normal,
    // mais `worker.close()` peut aussi attendre un job coincé ailleurs (DNS,
    // TCP qui ne répond jamais...). Sans cette limite, un arrêt qui traîne
    // dépasserait le délai de grâce Docker (10 s) et se terminerait en
    // SIGKILL — moins propre qu'un `process.exit(1)` volontaire et journalisé.
    // `unref()` est indispensable : sans lui, ce minuteur à lui seul
    // empêcherait le process de se terminer si l'arrêt réussit avant 15 s.
    const forceExit = setTimeout(() => {
      logger.error('Arrêt trop long, sortie forcée', { signal });
      process.exit(1);
    }, 15_000);
    forceExit.unref();

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
