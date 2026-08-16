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
  ].join('\n');

  const html = [
    '<div style="font-family:Georgia,serif;font-size:16px;line-height:1.6;color:#2b2019;">',
    `  <p>${escapeHtml(greeting)},</p>`,
    `  <p>Tu viens de franchir le <strong>niveau ${job.levelAfter}</strong>.</p>`,
    '  <p>La forge ne retient que ce qui a été frappé. Continue.</p>',
    '  <p style="color:#7a6a5a;">— Grindrise</p>',
    '</div>',
  ].join('\n');

  return { subject, html, text };
}
