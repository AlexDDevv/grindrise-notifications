import type { LevelUpJob } from '../../queue/contract';

export type RenderedEmail = {
  subject: string;
  html: string;
  text: string;
};

/** Le pseudo est une saisie utilisateur : il ne part jamais brut dans du HTML. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Email de palier franchi.
 *
 * Styles en attributs inline : les clients mail ignorent largement les
 * feuilles de style, y compris une balise `<style>` dans le `<head>`.
 */
export function renderLevelUpEmail(job: LevelUpJob): RenderedEmail {
  const greeting = job.username ? `Bravo ${job.username}` : 'Bravo';
  const subject = `Niveau ${job.levelAfter} atteint`;

  const text = [
    `${greeting},`,
    '',
    `Tu viens de franchir le niveau ${job.levelAfter}.`,
    'La forge ne retient que ce qui a été frappé. Continue.',
    '',
    '— Grindrise',
    ...(job.unsubscribeUrl
      ? ['', 'Ne plus recevoir ces emails de palier :', job.unsubscribeUrl]
      : []),
  ].join('\n');

  const html = [
    '<div style="font-family:Georgia,serif;font-size:16px;line-height:1.6;color:#2b2019;">',
    `  <p>${escapeHtml(greeting)},</p>`,
    `  <p>Tu viens de franchir le <strong>niveau ${job.levelAfter}</strong>.</p>`,
    '  <p>La forge ne retient que ce qui a été frappé. Continue.</p>',
    '  <p style="color:#7a6a5a;">— Grindrise</p>',
    ...(job.unsubscribeUrl ? [footerHtml(job.unsubscribeUrl)] : []),
    '</div>',
  ].join('\n');

  return { subject, html, text };
}

/**
 * Pied de désabonnement de la version HTML.
 *
 * La version texte porte la même URL, en clair : certains clients mail
 * n'affichent que celle-là, et un lien de désabonnement introuvable équivaut à
 * un lien absent.
 *
 * Il rappelle que les codes de connexion continuent d'arriver. Sans cette
 * phrase, se désabonner ressemble à couper tous les emails du service — et
 * personne ne cliquerait, ou pire, quelqu'un cliquerait puis ne pourrait plus
 * se connecter sans comprendre pourquoi.
 */
function footerHtml(unsubscribeUrl: string): string {
  const href = escapeHtml(unsubscribeUrl);

  return [
    '  <hr style="border:0;border-top:1px solid #ded2c4;margin:24px 0 12px;">',
    '  <p style="font-size:13px;color:#7a6a5a;">',
    '    Tu reçois cet email parce que tu progresses dans Grindrise.',
    `    <a href="${href}" style="color:#7a6a5a;">Ne plus recevoir ces emails de palier</a>.`,
    '    Les codes de connexion, eux, continueront d\'arriver.',
    '  </p>',
  ].join('\n');
}
