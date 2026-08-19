import type { EmailProvider } from '../email/email-provider';
import { listUnsubscribeHeaders } from '../email/list-unsubscribe';
import { renderLevelUpEmail } from '../email/templates/level-up';
import { logger } from '../logger';
import { assertLevelUpJob } from '../queue/contract';

/**
 * Traite un job « palier franchi » : valider, rendre, envoyer.
 *
 * N'attrape rien. La distinction entre échec définitif et échec passager
 * appartient au worker, qui seul connaît BullMQ.
 */
export async function handleLevelUp(data: unknown, email: EmailProvider): Promise<void> {
  const job = assertLevelUpJob(data);
  const rendered = renderLevelUpEmail(job);

  await email.send({
    to: job.username
      ? { email: job.email, name: job.username }
      : { email: job.email },
    subject: rendered.subject,
    html: rendered.html,
    text: rendered.text,
    // Absents quand le job vient d'une API antérieure au désabonnement : sans
    // URL, promettre un désabonnement en un clic serait un mensonge.
    ...(job.unsubscribeUrl
      ? { headers: listUnsubscribeHeaders(job.unsubscribeUrl) }
      : {}),
  });

  // Ni l'adresse ni le pseudo dans les logs : le profileId suffit au support.
  logger.info('Email de palier envoyé', {
    profileId: job.profileId,
    level: job.levelAfter,
    provider: email.name,
  });
}
