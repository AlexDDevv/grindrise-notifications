import { validateEnv } from './env.config';

const complete = {
  REDIS_URL: 'redis://127.0.0.1:6379',
  BREVO_API_KEY: 'xkeysib-test',
  BREVO_SENDER_EMAIL: 'expediteur@exemple.fr',
};

describe('validateEnv', () => {
  it('accepte un environnement complet', () => {
    const config = validateEnv(complete);

    expect(config.redisUrl).toBe('redis://127.0.0.1:6379');
    expect(config.brevoApiKey).toBe('xkeysib-test');
    expect(config.brevoSenderEmail).toBe('expediteur@exemple.fr');
  });

  it('applique les valeurs par défaut des variables optionnelles', () => {
    const config = validateEnv(complete);

    expect(config.brevoSenderName).toBe('Grindrise');
    expect(config.brevoReplyTo).toBeUndefined();
    expect(config.queueName).toBe('notifications');
    expect(config.concurrency).toBe(5);
    expect(config.port).toBe(3001);
  });

  it('liste toutes les variables manquantes en une seule erreur', () => {
    // Une par une ferait redémarrer le container autant de fois qu'il manque
    // de variables : on veut le diagnostic complet du premier coup.
    expect(() => validateEnv({})).toThrow(
      /REDIS_URL.*BREVO_API_KEY.*BREVO_SENDER_EMAIL/s,
    );
  });

  it('refuse une variable présente mais vide', () => {
    expect(() => validateEnv({ ...complete, BREVO_API_KEY: '   ' })).toThrow(
      /BREVO_API_KEY/,
    );
  });

  it('refuse une concurrence non entière', () => {
    expect(() => validateEnv({ ...complete, WORKER_CONCURRENCY: 'beaucoup' })).toThrow(
      /WORKER_CONCURRENCY/,
    );
  });

  it('refuse un port hors bornes', () => {
    expect(() => validateEnv({ ...complete, PORT: '0' })).toThrow(/PORT/);
  });
});
