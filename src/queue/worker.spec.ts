import { UnrecoverableError } from 'bullmq';

import {
  PermanentEmailError,
  TransientEmailError,
  type EmailProvider,
} from '../email/email-provider';
import { LEVEL_UP_JOB_NAME, LEVEL_UP_JOB_VERSION } from './contract';
import { processJob } from './worker';

const data = {
  version: LEVEL_UP_JOB_VERSION,
  profileId: '11111111-1111-1111-1111-111111111111',
  email: 'joueur@exemple.fr',
  username: 'Ferrum',
  levelBefore: 4,
  levelAfter: 5,
  occurredAt: '2026-08-16T09:30:00.000Z',
};

const ok: EmailProvider = { name: 'fake', send: () => Promise.resolve() };

describe('processJob', () => {
  it('route un job de palier vers son handler', async () => {
    const sent: string[] = [];
    const provider: EmailProvider = {
      name: 'fake',
      send: (message) => {
        sent.push(message.to.email);
        return Promise.resolve();
      },
    };

    await processJob({ id: '1', name: LEVEL_UP_JOB_NAME, data }, provider);

    expect(sent).toEqual(['joueur@exemple.fr']);
  });

  it('abandonne sans reprise un type de job inconnu', async () => {
    await expect(
      processJob({ id: '1', name: 'inconnu', data }, ok),
    ).rejects.toBeInstanceOf(UnrecoverableError);
  });

  it('abandonne sans reprise un payload illisible', async () => {
    await expect(
      processJob({ id: '1', name: LEVEL_UP_JOB_NAME, data: { version: 99 } }, ok),
    ).rejects.toBeInstanceOf(UnrecoverableError);
  });

  it('abandonne sans reprise un refus définitif du fournisseur', async () => {
    // Cinq tentatives sur une clé API invalide ne feraient que retarder le
    // diagnostic.
    const provider: EmailProvider = {
      name: 'fake',
      send: () => Promise.reject(new PermanentEmailError('clé invalide')),
    };

    await expect(
      processJob({ id: '1', name: LEVEL_UP_JOB_NAME, data }, provider),
    ).rejects.toBeInstanceOf(UnrecoverableError);
  });

  it('laisse BullMQ retenter un échec passager', async () => {
    const provider: EmailProvider = {
      name: 'fake',
      send: () => Promise.reject(new TransientEmailError('429')),
    };

    const failure = processJob({ id: '1', name: LEVEL_UP_JOB_NAME, data }, provider);

    await expect(failure).rejects.toBeInstanceOf(TransientEmailError);
    await expect(failure).rejects.not.toBeInstanceOf(UnrecoverableError);
  });
});
