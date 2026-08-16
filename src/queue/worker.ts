import { UnrecoverableError, Worker } from 'bullmq';
import IORedis from 'ioredis';

import type { WorkerConfig } from '../config/env.config';
import { PermanentEmailError, type EmailProvider } from '../email/email-provider';
import { handleLevelUp } from '../handlers/level-up';
import { logger } from '../logger';
import { InvalidJobError, LEVEL_UP_JOB_NAME } from './contract';

/** Ce dont `processJob` a besoin — un vrai `Job` BullMQ le satisfait. */
export type IncomingJob = {
  id?: string;
  name: string;
  data: unknown;
};

/**
 * Aiguillage et classification des erreurs.
 *
 * Séparé de `createWorker` pour être testable sans Redis : c'est ici que se
 * décide ce qui se retente et ce qui s'abandonne, la partie qui mérite des
 * tests.
 */
export async function processJob(job: IncomingJob, email: EmailProvider): Promise<void> {
  try {
    switch (job.name) {
      case LEVEL_UP_JOB_NAME:
        await handleLevelUp(job.data, email);
        return;
      default:
        throw new InvalidJobError(`Type de job inconnu : ${job.name}.`);
    }
  } catch (error) {
    if (error instanceof InvalidJobError || error instanceof PermanentEmailError) {
      logger.error('Job abandonné sans reprise', {
        jobId: job.id,
        jobName: job.name,
        reason: error.message,
      });
      throw new UnrecoverableError(error.message);
    }
    throw error;
  }
}

export function createWorker(config: WorkerConfig, email: EmailProvider): Worker {
  // `maxRetriesPerRequest: null` est exigé par BullMQ côté consommateur : le
  // worker doit attendre indéfiniment le retour de Redis plutôt qu'abandonner.
  const connection = new IORedis(config.redisUrl, { maxRetriesPerRequest: null });

  const worker = new Worker(config.queueName, (job) => processJob(job, email), {
    connection,
    concurrency: config.concurrency,
  });

  worker.on('failed', (job, error) => {
    logger.warn('Job en échec', {
      jobId: job?.id,
      attemptsMade: job?.attemptsMade,
      reason: error.message,
    });
  });

  worker.on('completed', (job) => {
    logger.debug('Job terminé', { jobId: job.id });
  });

  worker.on('error', (error) => {
    logger.error('Erreur du worker', { reason: error.message });
  });

  return worker;
}
