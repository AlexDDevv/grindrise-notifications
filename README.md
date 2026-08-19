# Grindrise — service de notifications

Microservice indépendant de l'API Grindrise. Il ne sert **aucune** route métier :
il consomme une queue [BullMQ](https://docs.bullmq.io/) adossée à Redis et envoie
les emails transactionnels via [Brevo](https://developers.brevo.com/).

```
API NestJS ──Queue.add──▶ Redis / BullMQ ──consume──▶ ce service ──▶ API Brevo
```

Aucun appel HTTP entre l'API et ce service, dans aucun sens. Ils ne se
connaissent que par le nom d'une queue et la forme d'un message. Ce service n'a
**aucun** accès à Supabase : tout ce dont il a besoin arrive dans le payload du
job.

## Lancer en local

```bash
pnpm install
cp .env.example .env    # renseigner BREVO_API_KEY et BREVO_SENDER_EMAIL
pnpm run redis:up       # Redis sur 127.0.0.1:6379
pnpm run dev
```

Le service **refuse de démarrer** si une variable requise manque — c'est voulu :
un container mal configuré doit crasher au boot, pas au premier envoi.

Vérification : `curl http://localhost:3001/health` → `{"status":"ok"}`

Pour envoyer un vrai email sans passer par l'API :

```bash
pnpm run sample joueur@exemple.fr
```

Sous WSL, `pnpm run redis:up` exige que l'intégration WSL soit activée dans les
paramètres de Docker Desktop.

## Tests

```bash
pnpm test
```

Aucun test ne parle à un vrai Redis ni à Brevo : `fetch` est bouchonné et la
partie BullMQ testée à travers `processJob`, isolée du câblage exprès.

## Variables d'environnement

Requises — l'absence de l'une empêche le démarrage :

| Variable | Valeur |
|---|---|
| `REDIS_URL` | `redis://127.0.0.1:6379` en local, `redis://:<mot-de-passe>@srv-captain--redis:6379` en production |
| `BREVO_API_KEY` | Brevo > SMTP & API > API Keys |
| `BREVO_SENDER_EMAIL` | adresse validée dans Brevo > Senders & IP > Senders |

Optionnelles :

| Variable | Défaut | Rôle |
|---|---|---|
| `BREVO_SENDER_NAME` | `Grindrise` | nom affiché de l'expéditeur |
| `BREVO_REPLY_TO` | aucune | adresse de réponse |
| `NOTIFICATIONS_QUEUE_NAME` | `notifications` | doit correspondre à celle de l'API |
| `WORKER_CONCURRENCY` | `5` | jobs traités en parallèle |
| `PORT` | `3001` | sonde `/health`, jamais exposée publiquement |
| `LOG_LEVEL` | `info` | `debug`, `info`, `warn` ou `error` — voir la mise en garde ci-dessous pour `debug` |

En `debug`, les réponses d'erreur brutes de Brevo sont journalisées telles quelles, corps compris
— et ce corps peut contenir l'adresse email du destinataire pour un envoi refusé. À n'activer que
ponctuellement, le temps de diagnostiquer un incident précis, jamais en continu en production.

## Expéditeur et délivrabilité

Le plan gratuit Brevo impose de valider une adresse expéditrice dans le
dashboard — aucun domaine à posséder. Sans SPF/DKIM, la délivrabilité reste
moyenne et une part des messages tombe en indésirables : acceptable pour valider
la chaîne, à corriger avant un vrai lancement.

Le jour où un domaine authentifié existe, **seule `BREVO_SENDER_EMAIL` change**.
L'identité de l'expéditeur n'apparaît nulle part ailleurs : `EmailMessage` ne
porte pas de champ `from`, elle est injectée au constructeur du fournisseur.

## Changer de fournisseur d'email

Écrire une classe qui implémente `EmailProvider` (`src/email/email-provider.ts`)
et l'instancier dans `src/main.ts`. Aucun handler, aucun gabarit et aucun code de
queue ne mentionne Brevo.

## Le contrat de job

`src/queue/contract.ts` existe **à l'identique** dans le dépôt `GrindRise`, en
`backend/src/modules/notifications/contract.ts`. Il n'importe rien, pour pouvoir
être copié tel quel.

Toute évolution se porte dans les deux dépôts, et **le worker se déploie
toujours avant l'API** : un consommateur en avance sait traiter l'ancien format,
un producteur en avance empile des jobs que personne ne sait lire. Le champ
`version` du payload est le garde-fou — un worker qui ne reconnaît pas une
version abandonne le job avec un message explicite au lieu de l'interpréter de
travers.

`pnpm run check:contract` compare les deux fichiers octet pour octet et échoue
si l'un a divergé sans l'autre — à lancer après toute modification du contrat,
avant de commiter.

Le champ `unsubscribeUrl` illustre la règle : le producteur le renseigne
toujours, mais il est déclaré **facultatif** dans le contrat. C'est ce qui
permet au worker neuf — déployé en premier — de traiter les jobs empilés par
l'API d'avant, qui ne le connaissait pas. Le rendre obligatoire les tuerait en
`InvalidJobError`, donc sans reprise possible. Ce worker ne fabrique aucun
jeton : il recopie l'URL signée par l'API dans le pied de l'email.

## Déployer sur CapRover

**Tout est dans [`DEPLOIEMENT.md`](DEPLOIEMENT.md)** : le serveur, CapRover, le
DNS, Redis, Brevo, les variables et les pièges. En résumé :

```bash
caprover deploy -n grindrise -a notifications -b main        # production
caprover deploy -n grindrise -a notifications-test -b main   # test
```

Depuis la racine de ce dépôt, qui est une racine git. Passer `-b` explicitement :
le CLI mémorise sinon la dernière source utilisée, qui peut être périmée.

Vérifier après déploiement que les logs affichent `Worker à l'écoute`.
