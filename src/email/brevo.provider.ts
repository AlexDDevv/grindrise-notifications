import {
  PermanentEmailError,
  TransientEmailError,
  type EmailMessage,
  type EmailProvider,
} from './email-provider';

export type BrevoSender = {
  email: string;
  name: string;
  replyTo?: string;
};

const ENDPOINT = 'https://api.brevo.com/v3/smtp/email';

/**
 * Envoi transactionnel via l'API HTTP de Brevo.
 *
 * Pas de SDK : le paquet officiel est lourd et mal typé pour ce qui tient en un
 * `fetch`. Node 22 fournit `fetch` nativement, donc zéro dépendance ajoutée.
 *
 * L'identité de l'expéditeur est injectée au constructeur et jamais dans un
 * message : passer à un domaine authentifié SPF/DKIM ne touchera que la
 * configuration.
 */
export class BrevoEmailProvider implements EmailProvider {
  readonly name = 'brevo';

  constructor(
    private readonly apiKey: string,
    private readonly sender: BrevoSender,
  ) {}

  async send(message: EmailMessage): Promise<void> {
    const payload: Record<string, unknown> = {
      sender: { email: this.sender.email, name: this.sender.name },
      to: [
        message.to.name
          ? { email: message.to.email, name: message.to.name }
          : { email: message.to.email },
      ],
      subject: message.subject,
      htmlContent: message.html,
      textContent: message.text,
    };

    if (this.sender.replyTo) {
      payload.replyTo = { email: this.sender.replyTo };
    }

    let response: Response;
    try {
      response = await fetch(ENDPOINT, {
        method: 'POST',
        headers: {
          'api-key': this.apiKey,
          'content-type': 'application/json',
          accept: 'application/json',
        },
        body: JSON.stringify(payload),
      });
    } catch (cause) {
      throw new TransientEmailError(
        `Brevo injoignable : ${cause instanceof Error ? cause.message : String(cause)}`,
      );
    }

    if (response.ok) return;

    const body = await response.text().catch(() => '');

    // 429 = quota atteint, 5xx = panne du fournisseur. Les deux se rattrapent.
    if (response.status === 429 || response.status >= 500) {
      throw new TransientEmailError(`Brevo a répondu ${response.status} : ${body}`);
    }

    // 4xx restants : clé invalide, expéditeur non validé, message refusé.
    throw new PermanentEmailError(
      `Brevo a refusé l'envoi (${response.status}) : ${body}`,
    );
  }
}
