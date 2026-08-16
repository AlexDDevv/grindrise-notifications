import { PermanentEmailError, type EmailMessage, type EmailProvider } from '../email/email-provider';
import { InvalidJobError, LEVEL_UP_JOB_VERSION } from '../queue/contract';
import { handleLevelUp } from './level-up';

const job = {
  version: LEVEL_UP_JOB_VERSION,
  profileId: '11111111-1111-1111-1111-111111111111',
  email: 'joueur@exemple.fr',
  username: 'Ferrum',
  levelBefore: 4,
  levelAfter: 5,
  occurredAt: '2026-08-16T09:30:00.000Z',
};

function fakeProvider(): { provider: EmailProvider; sent: EmailMessage[] } {
  const sent: EmailMessage[] = [];
  return {
    sent,
    provider: {
      name: 'fake',
      send: (message) => {
        sent.push(message);
        return Promise.resolve();
      },
    },
  };
}

describe('handleLevelUp', () => {
  it('envoie au destinataire du job', async () => {
    const { provider, sent } = fakeProvider();

    await handleLevelUp(job, provider);

    expect(sent).toHaveLength(1);
    expect(sent[0].to).toEqual({ email: 'joueur@exemple.fr', name: 'Ferrum' });
    expect(sent[0].subject).toContain('5');
  });

  it('omet le nom du destinataire sans pseudo', async () => {
    const { provider, sent } = fakeProvider();

    await handleLevelUp({ ...job, username: null }, provider);

    expect(sent[0].to).toEqual({ email: 'joueur@exemple.fr' });
  });

  it('rejette un job illisible sans rien envoyer', async () => {
    const { provider, sent } = fakeProvider();

    await expect(handleLevelUp({ ...job, version: 99 }, provider)).rejects.toBeInstanceOf(
      InvalidJobError,
    );
    expect(sent).toHaveLength(0);
  });

  it("laisse remonter l'erreur du fournisseur", async () => {
    // La classification permanent/passager appartient au worker, pas au
    // handler : il ne doit rien avaler.
    const provider: EmailProvider = {
      name: 'fake',
      send: () => Promise.reject(new PermanentEmailError('clé invalide')),
    };

    await expect(handleLevelUp(job, provider)).rejects.toBeInstanceOf(PermanentEmailError);
  });
});
