import { createServer, get, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Worker } from 'bullmq';

import { logger } from './logger';
import { startHealthServer, type RedisConnectionLike } from './health';

/** Requête GET locale, pour lire le vrai code de statut renvoyé par la sonde. */
function getStatusCode(port: number): Promise<number | undefined> {
  return new Promise((resolve, reject) => {
    get(`http://127.0.0.1:${port}/health`, (res) => {
      res.resume();
      resolve(res.statusCode);
    }).on('error', reject);
  });
}

describe('startHealthServer', () => {
  let blocker: Server | undefined;
  let health: Server | undefined;

  afterEach(async () => {
    await Promise.all(
      [blocker, health].map(
        (server) =>
          new Promise<void>((resolve) => {
            if (server && server.listening) {
              server.close(() => resolve());
            } else {
              resolve();
            }
          }),
      ),
    );
    blocker = undefined;
    health = undefined;
    jest.restoreAllMocks();
  });

  it('journalise un port déjà occupé sans jamais faire planter le process', async () => {
    // On occupe le port avant même d'appeler `startHealthServer`, pour forcer
    // un vrai EADDRINUSE asynchrone — le même incident qu'un conflit de port
    // en production.
    blocker = createServer();
    await new Promise<void>((resolve) => blocker!.listen(0, '0.0.0.0', () => resolve()));
    const port = (blocker.address() as AddressInfo).port;

    const errorSpy = jest.spyOn(logger, 'error').mockImplementation(() => {});

    // Seul `isRunning` est susceptible d'être lu par le serveur de sonde ;
    // aucune requête HTTP n'est envoyée dans ce test.
    const fakeWorker = { isRunning: () => true } as unknown as Worker;
    const readyConnection: RedisConnectionLike = { status: 'ready' };

    let uncaught: unknown;
    const onUncaughtException = (error: unknown): void => {
      uncaught = error;
    };
    process.on('uncaughtException', onUncaughtException);

    health = startHealthServer(port, fakeWorker, readyConnection);

    // Un listener supplémentaire sur 'error', ajouté avant que l'échec de
    // bind ne survienne de façon asynchrone : il ne fait qu'observer, la
    // gestion réelle doit venir de `startHealthServer` lui-même.
    await new Promise<void>((resolve) => {
      health!.on('error', () => resolve());
    });

    process.off('uncaughtException', onUncaughtException);

    expect(uncaught).toBeUndefined();
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('Sonde de vie'),
      expect.objectContaining({ port }),
    );
  });

  it("répond 503 quand la connexion Redis n'est pas prête, même si le worker tourne", async () => {
    // Le scénario du premier déploiement : `worker.isRunning()` est vrai dès
    // que `run()` a été appelé, indépendamment de l'état de Redis. Sans la
    // vérification de `connection.status`, ce test recevrait 200.
    const fakeWorker = { isRunning: () => true } as unknown as Worker;
    const notReadyConnection: RedisConnectionLike = { status: 'connecting' };

    health = startHealthServer(0, fakeWorker, notReadyConnection);
    await new Promise<void>((resolve) => health!.on('listening', resolve));
    const port = (health!.address() as AddressInfo).port;

    await expect(getStatusCode(port)).resolves.toBe(503);
  });

  it('répond 200 quand le worker tourne et que la connexion Redis est prête', async () => {
    const fakeWorker = { isRunning: () => true } as unknown as Worker;
    const readyConnection: RedisConnectionLike = { status: 'ready' };

    health = startHealthServer(0, fakeWorker, readyConnection);
    await new Promise<void>((resolve) => health!.on('listening', resolve));
    const port = (health!.address() as AddressInfo).port;

    await expect(getStatusCode(port)).resolves.toBe(200);
  });
});
