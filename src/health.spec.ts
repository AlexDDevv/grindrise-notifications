import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Worker } from 'bullmq';

import { logger } from './logger';
import { startHealthServer } from './health';

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

    let uncaught: unknown;
    const onUncaughtException = (error: unknown): void => {
      uncaught = error;
    };
    process.on('uncaughtException', onUncaughtException);

    health = startHealthServer(port, fakeWorker);

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
});
