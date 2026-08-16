/**
 * Validation de l'environnement au démarrage.
 *
 * Même philosophie que l'API : un container mal configuré doit crasher au boot
 * pour que CapRover le signale immédiatement, jamais échouer silencieusement au
 * premier envoi.
 */
export type WorkerConfig = {
  redisUrl: string;
  brevoApiKey: string;
  brevoSenderEmail: string;
  brevoSenderName: string;
  brevoReplyTo?: string;
  queueName: string;
  concurrency: number;
  port: number;
};

export function validateEnv(raw: Record<string, unknown>): WorkerConfig {
  const missing: string[] = [];

  const required = (key: string): string => {
    const value = raw[key];
    if (typeof value !== 'string' || value.trim() === '') {
      missing.push(key);
      return '';
    }
    return value.trim();
  };

  const optional = (key: string, fallback: string): string => {
    const value = raw[key];
    return typeof value === 'string' && value.trim() !== '' ? value.trim() : fallback;
  };

  const redisUrl = required('REDIS_URL');
  const brevoApiKey = required('BREVO_API_KEY');
  const brevoSenderEmail = required('BREVO_SENDER_EMAIL');

  if (missing.length > 0) {
    throw new Error(
      `Variables d'environnement manquantes : ${missing.join(', ')}. Voir .env.example.`,
    );
  }

  const positiveInteger = (key: string, fallback: number): number => {
    const value = raw[key];
    if (typeof value !== 'string' || value.trim() === '') return fallback;
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      throw new Error(`${key} invalide : ${value}. Entier strictement positif attendu.`);
    }
    return parsed;
  };

  const replyTo = raw.BREVO_REPLY_TO;

  return {
    redisUrl,
    brevoApiKey,
    brevoSenderEmail,
    brevoSenderName: optional('BREVO_SENDER_NAME', 'Grindrise'),
    brevoReplyTo:
      typeof replyTo === 'string' && replyTo.trim() !== '' ? replyTo.trim() : undefined,
    queueName: optional('NOTIFICATIONS_QUEUE_NAME', 'notifications'),
    concurrency: positiveInteger('WORKER_CONCURRENCY', 5),
    port: positiveInteger('PORT', 3001),
  };
}
