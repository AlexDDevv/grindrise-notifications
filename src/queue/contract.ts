/**
 * Contrat de la queue de notifications — FICHIER JUMEAU.
 *
 * Ce fichier existe à l'identique dans deux dépôts :
 *   - grindrise-notifications : src/queue/contract.ts                      (ici)
 *   - GrindRise               : backend/src/modules/notifications/contract.ts
 *
 * Toute modification doit être portée dans les deux, et le worker déployé AVANT
 * l'API : un consommateur en avance sait traiter l'ancien format, un producteur
 * en avance empile des jobs que personne ne sait lire.
 *
 * Il n'importe rien, volontairement : c'est ce qui permet de le copier tel quel
 * d'un dépôt à l'autre sans rien réécrire.
 */

export const DEFAULT_QUEUE_NAME = 'notifications';
export const LEVEL_UP_JOB_NAME = 'level-up';
export const LEVEL_UP_JOB_VERSION = 1;

/**
 * Options de reprise du job.
 *
 * Elles vivent ici, dans le contrat, bien que BullMQ les lise à l'ajout du job
 * — donc côté producteur. Les laisser côté API donnerait l'illusion que la
 * politique de reprise du worker se règle dans l'API.
 *
 * `attempts` et `backoff` couvrent environ deux heures avant abandon
 * (60 + 120 + 240 + 480 + 960 + 1920 + 3840 s ≈ 2 h 07). Ce n'est pas pour
 * absorber un simple hoquet réseau — quelques secondes suffiraient — mais une
 * vraie panne côté Brevo ou un dépassement du quota de 300 emails/jour du plan
 * gratuit, qui se résorbe en minutes ou en heures, pas en secondes.
 *
 * `removeOnFail.age` (7 jours) est un choix assumé : garder le job en échec
 * permet de le rejouer à la main depuis un tableau de bord BullMQ et de
 * diagnostiquer ce qui a coincé. Mais ce choix a un effet de bord auquel il
 * faut penser : le `jobId` d'un palier est déterministe (`levelUpJobId`), et
 * tant qu'un job — même définitivement échoué — existe encore sous cet id,
 * BullMQ ignore silencieusement tout nouvel `add` portant le même id. Un job
 * qui a épuisé ses `attempts` garde donc son identifiant réservé pendant ces
 * 7 jours : il ne se reproduit jamais tout seul, même si le joueur refranchit
 * le même palier entre-temps. Il se rejoue à la main.
 *
 * `removeOnComplete.age` en secondes : la déduplication par jobId ne tient que
 * tant que BullMQ garde trace du job. 24 h, très au-delà du plausible.
 */
export const LEVEL_UP_JOB_OPTIONS = {
  attempts: 8,
  backoff: { type: 'exponential' as const, delay: 60_000 },
  removeOnComplete: { age: 86_400 },
  removeOnFail: { age: 604_800 },
};

/**
 * Payload auto-suffisant : le worker n'a aucune connexion Supabase, donc tout
 * ce dont il a besoin pour écrire l'email est ici.
 */
export type LevelUpJob = {
  version: typeof LEVEL_UP_JOB_VERSION;
  /** Pour les logs et le support — jamais relu en base. */
  profileId: string;
  email: string;
  username: string | null;
  levelBefore: number;
  levelAfter: number;
  /** ISO 8601. */
  occurredAt: string;
  /**
   * Lien de désabonnement signé, à placer en pied de l'email.
   *
   * Composé par l'API, qui seule détient le secret de signature : le worker ne
   * fabrique aucun jeton, il recopie une URL. C'est la même règle que pour
   * l'adresse email — tout ce qu'il faut pour écrire le message est dans le
   * payload, le worker ne consulte rien.
   *
   * **Facultatif dans le type, toujours présent en pratique.** Le producteur le
   * renseigne systématiquement, et refuse d'empiler le job s'il ne peut pas le
   * composer. Il reste optionnel ici pour tenir l'invariant de déploiement
   * énoncé en tête de fichier : le worker part AVANT l'API, il doit donc savoir
   * traiter les jobs empilés par l'API précédente, qui ne connaissait pas ce
   * champ. Le rendre obligatoire ferait mourir ces jobs-là en `InvalidJobError`
   * — donc sans reprise, définitivement.
   */
  unsubscribeUrl?: string;
};

/** Job illisible ou incohérent : à ne jamais retenter. */
export class InvalidJobError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidJobError';
  }
}

export function levelUpJobId(profileId: string, levelAfter: number): string {
  return `${LEVEL_UP_JOB_NAME}:${profileId}:${levelAfter}`;
}

export function assertLevelUpJob(data: unknown): LevelUpJob {
  if (typeof data !== 'object' || data === null) {
    throw new InvalidJobError(`Payload attendu sous forme d'objet, reçu ${typeof data}.`);
  }

  const job = data as Record<string, unknown>;

  if (job.version !== LEVEL_UP_JOB_VERSION) {
    throw new InvalidJobError(
      `Job ${LEVEL_UP_JOB_NAME} en version ${String(job.version)}, ` +
        `ce worker ne sait lire que la version ${LEVEL_UP_JOB_VERSION}.`,
    );
  }

  const text = (key: string): string => {
    const value = job[key];
    if (typeof value !== 'string' || value.trim() === '') {
      throw new InvalidJobError(`Champ ${key} absent ou vide.`);
    }
    return value;
  };

  const level = (key: string): number => {
    const value = job[key];
    if (!Number.isInteger(value) || (value as number) < 1) {
      throw new InvalidJobError(`Champ ${key} invalide : ${String(value)}.`);
    }
    return value as number;
  };

  if (job.username !== null && typeof job.username !== 'string') {
    throw new InvalidJobError(`Champ username invalide : ${String(job.username)}.`);
  }

  // Absent : job produit par une API antérieure au désabonnement, à traiter
  // quand même. Présent mais vide ou d'un autre type : incohérence de
  // producteur, à ne pas retenter.
  if (
    job.unsubscribeUrl !== undefined &&
    (typeof job.unsubscribeUrl !== 'string' || job.unsubscribeUrl.trim() === '')
  ) {
    throw new InvalidJobError(`Champ unsubscribeUrl invalide : ${String(job.unsubscribeUrl)}.`);
  }

  const levelBefore = level('levelBefore');
  const levelAfter = level('levelAfter');

  if (levelAfter <= levelBefore) {
    throw new InvalidJobError(
      `Champ levelAfter (${levelAfter}) doit dépasser levelBefore (${levelBefore}).`,
    );
  }

  return {
    version: LEVEL_UP_JOB_VERSION,
    profileId: text('profileId'),
    email: text('email'),
    username: job.username as string | null,
    levelBefore,
    levelAfter,
    occurredAt: text('occurredAt'),
    unsubscribeUrl: job.unsubscribeUrl as string | undefined,
  };
}
