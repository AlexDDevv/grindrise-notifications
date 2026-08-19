import {
  InvalidJobError,
  LEVEL_UP_JOB_VERSION,
  assertLevelUpJob,
  levelUpJobId,
} from './contract';

const valid = {
  version: LEVEL_UP_JOB_VERSION,
  profileId: '11111111-1111-1111-1111-111111111111',
  email: 'joueur@exemple.fr',
  username: 'Ferrum',
  levelBefore: 4,
  levelAfter: 5,
  occurredAt: '2026-08-16T09:30:00.000Z',
};

describe('levelUpJobId', () => {
  it('est déterministe pour un même palier', () => {
    // C'est ce qui fait que deux séances franchissant le même niveau
    // n'envoient qu'un seul email : BullMQ ignore un jobId déjà connu.
    expect(levelUpJobId('abc', 5)).toBe('level-up:abc:5');
    expect(levelUpJobId('abc', 5)).toBe(levelUpJobId('abc', 5));
  });

  it("diffère d'un palier à l'autre", () => {
    expect(levelUpJobId('abc', 5)).not.toBe(levelUpJobId('abc', 6));
  });
});

describe('assertLevelUpJob', () => {
  it('accepte un job conforme', () => {
    expect(assertLevelUpJob(valid)).toEqual(valid);
  });

  it('accepte un pseudo absent', () => {
    expect(assertLevelUpJob({ ...valid, username: null }).username).toBeNull();
  });

  it('rejette une version inconnue en la nommant', () => {
    // Le worker doit dire « je ne sais pas lire ça » plutôt que d'interpréter
    // de travers un champ qui a changé de sens.
    expect(() => assertLevelUpJob({ ...valid, version: 2 })).toThrow(InvalidJobError);
    expect(() => assertLevelUpJob({ ...valid, version: 2 })).toThrow(/version 2/);
  });

  it("rejette une valeur qui n'est pas un objet", () => {
    expect(() => assertLevelUpJob(null)).toThrow(InvalidJobError);
    expect(() => assertLevelUpJob('level-up')).toThrow(InvalidJobError);
  });

  it('rejette un email vide', () => {
    expect(() => assertLevelUpJob({ ...valid, email: '' })).toThrow(/email/);
  });

  it('rejette un profileId vide', () => {
    expect(() => assertLevelUpJob({ ...valid, profileId: '' })).toThrow(/profileId/);
  });

  it('rejette des niveaux non entiers', () => {
    expect(() => assertLevelUpJob({ ...valid, levelAfter: 5.5 })).toThrow(/levelAfter/);
  });

  it('rejette une progression qui ne monte pas', () => {
    // Un job « palier franchi » où le niveau n'a pas augmenté est un bug du
    // producteur : l'envoyer quand même ferait un email absurde.
    expect(() => assertLevelUpJob({ ...valid, levelBefore: 5, levelAfter: 5 })).toThrow(
      /levelAfter/,
    );
  });

  it('rejette une date absente', () => {
    expect(() => assertLevelUpJob({ ...valid, occurredAt: '' })).toThrow(/occurredAt/);
  });
});

describe('assertLevelUpJob — lien de désabonnement', () => {
  const url = 'https://api.exemple.test/notifications/unsubscribe?token=abc.def';

  it('conserve le lien quand le producteur en fournit un', () => {
    expect(assertLevelUpJob({ ...valid, unsubscribeUrl: url }).unsubscribeUrl).toBe(url);
  });

  it("accepte un job sans lien — l'ancien format reste traitable", () => {
    // L'invariant de déploiement : le worker part AVANT l'API, il consomme donc
    // des jobs empilés par une API qui ne connaissait pas ce champ. Les refuser
    // les tuerait en InvalidJobError, donc sans reprise possible.
    expect(assertLevelUpJob(valid).unsubscribeUrl).toBeUndefined();
  });

  it('rejette un lien vide, qui trahit un producteur incohérent', () => {
    expect(() => assertLevelUpJob({ ...valid, unsubscribeUrl: '   ' })).toThrow(
      InvalidJobError,
    );
    expect(() => assertLevelUpJob({ ...valid, unsubscribeUrl: 42 })).toThrow(
      /unsubscribeUrl/,
    );
  });
});
