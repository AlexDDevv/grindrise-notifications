import { LEVEL_UP_JOB_VERSION, type LevelUpJob } from '../../queue/contract';
import { renderLevelUpEmail } from './level-up';

const job: LevelUpJob = {
  version: LEVEL_UP_JOB_VERSION,
  profileId: '11111111-1111-1111-1111-111111111111',
  email: 'joueur@exemple.fr',
  username: 'Ferrum',
  levelBefore: 4,
  levelAfter: 5,
  occurredAt: '2026-08-16T09:30:00.000Z',
};

describe('renderLevelUpEmail', () => {
  it('annonce le niveau atteint dans le sujet', () => {
    expect(renderLevelUpEmail(job).subject).toContain('5');
  });

  it('nomme le joueur quand il a un pseudo', () => {
    const { text, html } = renderLevelUpEmail(job);

    expect(text).toContain('Ferrum');
    expect(html).toContain('Ferrum');
  });

  it('reste lisible sans pseudo', () => {
    // `username` est nullable en base : la saisie du pseudo n'existe pas encore
    // dans l'app. « Bravo null » serait le bug le plus visible possible.
    const { subject, text, html } = renderLevelUpEmail({ ...job, username: null });

    expect(subject).not.toContain('null');
    expect(text).not.toContain('null');
    expect(html).not.toContain('null');
    expect(text).toContain('Bravo');
  });

  it('échappe le pseudo dans la version HTML', () => {
    // Le pseudo est une saisie utilisateur : sans échappement, il s'injecte
    // dans le corps de l'email.
    const { html } = renderLevelUpEmail({ ...job, username: '<script>x</script>' });

    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('fournit une version texte non vide', () => {
    // Certains clients mail n'affichent que le texte, et son absence pèse sur
    // le classement anti-spam.
    expect(renderLevelUpEmail(job).text.trim().length).toBeGreaterThan(0);
  });
});
