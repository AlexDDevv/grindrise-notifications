/**
 * Injecte un job de palier dans la queue — outil de mise au point local.
 *
 * C'est le seul moyen de valider la chaîne complète Redis → worker → Brevo sans
 * faire tourner l'API ni enregistrer une vraie séance. Il ne sert qu'en local :
 * `scripts/` n'entre pas dans l'image Docker, et le `.env` est chargé par le
 * flag `--env-file` du script pnpm, jamais par le code.
 *
 * Usage :
 *   pnpm run sample                       vers BREVO_SENDER_EMAIL, palier 2 → 3
 *   pnpm run sample joueur@exemple.fr     vers une autre adresse
 *   pnpm run sample joueur@exemple.fr 4   palier 4 → 5
 *   pnpm run sample joueur@exemple.fr 4 7 plusieurs niveaux d'un coup
 *
 * Le `profileId` est tiré au hasard à chaque exécution, et c'est délibéré :
 * `levelUpJobId` est déterministe, donc réutiliser le même identifiant ferait
 * ignorer le second job par BullMQ, silencieusement. On croirait le worker en
 * panne alors qu'il n'a jamais rien reçu.
 *
 * La sortie passe par `console` plutôt que par `logger` : ce script parle à un
 * humain dans un terminal, pas à l'agrégateur de logs de CapRover.
 */
import { randomUUID } from 'node:crypto';

import { Queue } from 'bullmq';
import IORedis from 'ioredis';

import {
  LEVEL_UP_JOB_NAME,
  LEVEL_UP_JOB_OPTIONS,
  LEVEL_UP_JOB_VERSION,
  assertLevelUpJob,
  levelUpJobId,
  type LevelUpJob,
} from '../src/queue/contract';

function fail(message: string): never {
  console.error(`✗ ${message}`);
  process.exit(1);
}

/**
 * Hôte et port seuls, jamais l'URL entière : elle porte le mot de passe dès
 * qu'on pointe autre chose que le docker-compose local.
 */
function redisHost(): string {
  try {
    const url = new URL(process.env.REDIS_URL ?? '');
    return `${url.hostname}:${url.port || '6379'}`;
  } catch {
    return 'la cible configurée';
  }
}

function level(raw: string | undefined, fallback: number, label: string): number {
  if (raw === undefined) return fallback;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1) {
    fail(`${label} invalide : « ${raw} ». Entier supérieur ou égal à 1 attendu.`);
  }
  return parsed;
}

async function main(): Promise<void> {
  const [emailArg, beforeArg, afterArg] = process.argv.slice(2);

  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) {
    fail("REDIS_URL absente de l'environnement. Copier .env.example vers .env.");
  }

  const email = emailArg ?? process.env.BREVO_SENDER_EMAIL;
  if (!email) {
    fail(
      'Aucun destinataire. Renseigner BREVO_SENDER_EMAIL dans .env, ou passer ' +
        "l'adresse en argument : pnpm run sample vous@exemple.fr",
    );
  }
  // Garde-fou de frappe : sans lui, un niveau passé en première position
  // partirait chez Brevo comme adresse et n'échouerait que là-bas.
  if (!email.includes('@')) {
    fail(`« ${email} » ne ressemble pas à une adresse email.`);
  }

  const levelBefore = level(beforeArg, 2, 'levelBefore');
  const levelAfter = level(afterArg, levelBefore + 1, 'levelAfter');

  const payload: LevelUpJob = {
    version: LEVEL_UP_JOB_VERSION,
    profileId: randomUUID(),
    email,
    username: 'Testeur',
    levelBefore,
    levelAfter,
    occurredAt: new Date().toISOString(),
  };

  // Même validation que le producteur, avec la même fonction : une incohérence
  // dans les arguments se voit ici plutôt que dans les logs du worker.
  assertLevelUpJob(payload);

  // Réglages du producteur, et pour la même raison : échouer vite plutôt que
  // laisser la commande pendre sans rien dire.
  //
  // `retryStrategy` en plus, propre à ce script : les deux autres options ne
  // couvrent que le cas d'un Redis joignable puis perdu. Tant que la connexion
  // n'a jamais abouti, ioredis retente indéfiniment et `queue.add` attend un
  // Redis « prêt » qui ne viendra pas — mesuré, ça pend sans fin. Rendre `null`
  // fait abandonner dès le premier échec, ce qu'on veut d'une commande lancée à
  // la main.
  const connection = new IORedis(redisUrl, {
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
    retryStrategy: () => null,
  });
  connection.on('error', () => undefined);

  const queueName = process.env.NOTIFICATIONS_QUEUE_NAME ?? 'notifications';
  const queue = new Queue(queueName, { connection });
  // Sans ce gestionnaire, BullMQ déverse la trace brute de chaque échec de
  // connexion sur la sortie d'erreur, noyant le message lisible plus bas.
  queue.on('error', () => undefined);

  try {
    const job = await queue.add(LEVEL_UP_JOB_NAME, payload, {
      ...LEVEL_UP_JOB_OPTIONS,
      jobId: levelUpJobId(payload.profileId, levelAfter),
    });

    console.log(`✓ Job déposé dans « ${queueName} » : ${job.id}`);
    console.log(`  destinataire ${email}, palier ${levelBefore} → ${levelAfter}`);

    const counts = await queue.getJobCounts('waiting', 'active', 'completed', 'failed');
    console.log(
      `  queue : ${counts.waiting} en attente, ${counts.active} en cours, ` +
        `${counts.completed} terminés, ${counts.failed} en échec`,
    );

    // Un job qui reste en attente veut presque toujours dire qu'aucun worker ne
    // consomme cette queue — l'erreur la plus fréquente est d'oublier `pnpm run
    // dev`, la seconde d'avoir désaligné NOTIFICATIONS_QUEUE_NAME.
    if (counts.waiting > 0) {
      console.log('  → personne ne consomme cette queue. Le worker tourne-t-il ?');
    }
  } finally {
    // `disconnect()` et pas `quit()` : si Redis est injoignable, un arrêt
    // gracieux attendrait une réponse qui ne viendra jamais.
    await queue.close().catch(() => undefined);
    connection.disconnect();
  }
}

main().catch((error: unknown) => {
  const reason = error instanceof Error ? error.message : String(error);

  // ioredis et BullMQ annoncent une connexion morte par des messages qui ne
  // disent rien à qui n'a pas lu leur code source. Les traduire ici évite un
  // quart d'heure perdu.
  const dead = [
    'ECONNREFUSED',
    'Connection is closed',
    "Stream isn't writeable",
    'max retries per request',
  ];
  if (dead.some((needle) => reason.includes(needle))) {
    fail(`Redis injoignable sur ${redisHost()}. Lancer « pnpm run redis:up », puis réessayer.`);
  }

  fail(reason);
});
