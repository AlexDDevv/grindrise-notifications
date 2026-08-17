# Déploiement du service de notifications

Checklist de reprise, écrite le 2026-08-16 et révisée le 2026-08-17. Le code est
terminé et revu des deux côtés. Le compte Brevo existe, les deux dépôts sont
poussés : ce qui reste demande un serveur. CapRover n'est pas un service
hébergé, il s'installe sur une machine à soi.

Ce document se lit sans rien avoir en tête : il rappelle où en est le chantier
avant de dire quoi faire.

---

## Où en est le chantier

Deux dépôts sont concernés.

| Dépôt | Chemin local | Branche | État |
|---|---|---|---|
| Service de notifications | `~/grindrise-notifications` | `test` | 48 tests verts, poussé |
| Monorepo Grindrise | `~/GrindRise` | `test` | 4 commits ajoutés, 90 tests verts, poussé |

Dans les deux dépôts, `main` est en retard sur `test`.

**Ce qui fonctionne déjà**, vérifié et non supposé :

- le service consomme une queue BullMQ et envoie par l'API Brevo, derrière une
  interface `EmailProvider` qui rend un changement de fournisseur trivial ;
- l'image Docker se construit (60 Mo, sans aucun secret dedans — vérifié en
  inspectant l'image) ;
- l'API NestJS produit un job quand un joueur franchit un niveau, en best-effort :
  une panne de Redis survenue **après** le démarrage n'a aucun effet sur
  `POST /workouts`. Le cas d'un Redis jamais joignable, lui, n'est pas couvert —
  voir « À corriger avant de déployer » ;
- le `/health` **du worker** répond 503 si Redis n'est pas joignable, donc un mot
  de passe Redis mal recopié s'y voit immédiatement. L'API n'a pas cet
  équivalent.

**Ce qui n'a jamais été fait** : aucun email réel n'a été envoyé, et rien n'est
déployé — ni serveur, ni CapRover, ni Redis, ni API.

---

## 1. Créer le compte Brevo

**Fait le 2026-08-17.**

- [x] Créer le compte sur [brevo.com](https://www.brevo.com)
- [x] **Senders & IP → Senders → Add a sender** : renseigner une adresse
      personnelle, puis cliquer le lien de validation reçu par email
- [x] **SMTP & API → API Keys → Generate a new API key**, copier la valeur —
      elle n'est affichée qu'une seule fois

Le plan gratuit plafonne à 300 emails/jour, largement suffisant.

`BREVO_SENDER_EMAIL` attend **une adresse d'expédition**, pas le relais SMTP.
`smtp-relay.brevo.com` ne sert nulle part ici : ce service parle à l'API HTTP de
Brevo, jamais en SMTP. Le relais SMTP concernera Supabase Auth, sujet séparé en
fin de document.

Il n'y a pas d'expéditeur par défaut chez Brevo : sans domaine authentifié, les
emails partent de l'adresse validée ci-dessus. Aujourd'hui c'est une adresse
`@gmail.com`, et il faut savoir ce que ça implique : `gmail.com` publie une
politique DMARC, donc un `From:` en `@gmail.com` expédié par les serveurs de
Brevo échoue l'alignement DMARC. Ce n'est pas « une partie des emails en
indésirables » — c'est structurellement pénalisé. Acceptable pour un test vers
soi-même, pas pour de vrais joueurs.

Le jour où un domaine authentifié existe — celui de l'étape 4 fera l'affaire —
**seule la variable `BREVO_SENDER_EMAIL` change** : aucun code à toucher,
l'identité de l'expéditeur n'apparaît nulle part ailleurs.

---

## 2. Pousser le service sur GitHub

**Fait.** Le dépôt est poussé en SSH sur
`git@github.com:AlexDDevv/grindrise-notifications.git`, branches `main` et `test`
à jour côté distant, et l'accès fonctionne.

Reste une décision à prendre avant l'étape 5 : `caprover deploy` demande quelle
branche déployer, et `main` est en retard sur `test` dans les deux dépôts. Soit
fusionner `test` dans `main` d'abord, soit déployer `test` en l'assumant.

---

## 3. Valider la chaîne en local

Cette étape est la seule qui prouve que tout fonctionne bout en bout, et le seul
moyen de voir partir un vrai email sans serveur. Ses deux prérequis manquants —
le script d'injection et une clé Brevo — existent maintenant.

- [x] Renseigner `.env` à partir de `.env.example` (clé Brevo + adresse validée)
- [ ] `pnpm install` si `node_modules` est absent
- [ ] `pnpm run redis:up` — Redis local via Docker
- [ ] `pnpm run dev` dans un terminal, attendre `Worker à l'écoute`
- [ ] `pnpm run sample` dans un second terminal
- [ ] Vérifier la réception de l'email
- [ ] `pnpm run redis:down` en fin de séance

Un succès est silencieux : `Job terminé` est journalisé en `debug`, donc invisible
avec le `LOG_LEVEL=info` par défaut. Seuls les échecs parlent. Pour suivre le
worker pas à pas pendant un diagnostic, passer `LOG_LEVEL=debug` dans `.env` — et
l'y laisser est sans risque en local, contrairement à la production.

Prérequis : Docker Desktop doit tourner **et** son intégration WSL être active,
sinon `docker` reste introuvable dans la distribution.

### Le script d'injection

`pnpm run sample` dépose un job de palier dans la queue, sans l'API ni Supabase.

```bash
pnpm run sample                        # vers BREVO_SENDER_EMAIL, palier 2 → 3
pnpm run sample joueur@exemple.fr      # autre destinataire
pnpm run sample joueur@exemple.fr 7    # palier 7 → 8
```

Il valide son payload avec `assertLevelUpJob`, la fonction même dont se sert le
worker : une incohérence se voit dans le terminal plutôt que dans les logs d'un
autre service. Le `profileId` est tiré au hasard à chaque exécution, et c'est
délibéré — `levelUpJobId` étant déterministe, un identifiant fixe ferait ignorer
le second job par BullMQ, silencieusement.

**N'envoyer que vers des adresses réelles.** Un `joueur@exemple.fr` rebondit, et
les rebonds abîment la réputation d'expédition du compte Brevo. Une queue de test
se vide avec `docker compose exec redis redis-cli flushall`.

Un job qui reste « en attente » signale que personne ne consomme la queue : le
plus souvent `pnpm run dev` n'a pas été lancé, sinon `NOTIFICATIONS_QUEUE_NAME`
a été désaligné entre les deux côtés.

### Le `.env` n'est lu qu'en local

Aucune dépendance `dotenv` dans ce dépôt, volontairement : `dev` et `sample`
chargent le fichier par le flag `--env-file` de Node, visible dans
`package.json`. `pnpm start` ne le lit pas — en production les variables
viennent de CapRover, et le code ne doit jamais dépendre d'un fichier absent de
l'image.

---

## 4. Provisionner le serveur et installer CapRover

CapRover s'installe sur une machine à soi. Il faut donc un VPS et un nom de
domaine — le domaine n'est pas optionnel : sans wildcard DNS, ni sous-domaine par
app ni HTTPS automatique.

### Commander

- [ ] **VPS OVH**, gamme *Essential* : 2 vCore, 4 Go RAM, ~80 Go NVMe
- [ ] **Datacenter** Gravelines, Strasbourg ou Roubaix — OVH propose aussi
      Francfort, Londres et Varsovie, à ne pas prendre au hasard
- [ ] **Ubuntu 24.04 LTS**, sans panneau de contrôle (ni Plesk, ni cPanel)
- [ ] **Clé SSH** ajoutée à la commande — `~/.ssh/id_ed25519.pub` existe déjà
- [ ] **Nom de domaine**, chez OVH aussi pour tout regrouper

Sur le dimensionnement : la stack au repos tient dans ~1 Go (CapRover ~450 Mo,
Ubuntu ~200, API ~200, worker ~120, Redis ~50). Ce n'est pas le repos qui dicte
les 4 Go, c'est le **build** : CapRover compile les images sur le serveur, et
`pnpm install` + `tsc` peuvent réclamer 2 Go le temps d'un déploiement. Le
palier à 2 Go échouerait là.

### Préparer la machine

- [ ] Se connecter — les images OVH récentes ouvrent la session en `ubuntu`, pas
      en `root` : `sudo -i` ensuite
- [ ] `apt update && apt upgrade -y`
- [ ] **Ajouter 2 Go de swap** — les VPS OVH n'en ont aucun, et un build sans
      swap se fait tuer par l'OOM killer plutôt que ralentir :

```bash
fallocate -l 2G /swapfile && chmod 600 /swapfile
mkswap /swapfile && swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab
```

- [ ] **Docker** — `curl -fsSL https://get.docker.com | sh`
- [ ] **Ports** — 80, 443, 3000, 996, 7946, 4789, 2377 ouverts. Le pare-feu OVH
      est désactivé par défaut ; si `ufw` est actif sur la machine, ces ports
      doivent y être autorisés.
- [ ] **CapRover** :

```bash
docker run -p 80:80 -p 443:443 -p 3000:3000 -v /var/run/docker.sock:/var/run/docker.sock \
  -v /captain:/captain caprover/caprover
```

### DNS et HTTPS

- [ ] **Enregistrement A** chez OVH : `*.apps.tondomaine.fr` → IP du VPS
- [ ] Attendre la propagation — quelques minutes à quelques heures
- [ ] `npm install -g caprover` sur la machine de développement
- [ ] `caprover serversetup` : domaine racine, **changer le mot de passe
      `captain42`**, activer HTTPS et la redirection forcée

---

## 5. Déployer les apps

**L'ordre compte.** Le worker doit consommer la queue avant que l'API n'y dépose
quoi que ce soit : un consommateur en avance sait traiter l'ancien format, un
producteur en avance empile des jobs que personne ne sait lire.

L'API se déploie pourtant en premier ici, et ce n'est pas une contradiction :
**sans `REDIS_URL`, elle ne produit rien** et le signale au démarrage. C'est
l'ajout de cette variable, en dernier, qui ouvre le robinet.

- [ ] **Redis** — Apps → One-Click Apps → Redis, nommée `redis`. Noter le mot de
      passe généré, ne pas exposer publiquement. Les deux apps l'atteignent par
      `srv-captain--redis:6379` sur le réseau interne.
- [ ] **API** — créer l'app, renseigner ses variables **sans `REDIS_URL`**, puis
      `caprover deploy` depuis `~/GrindRise/backend`
- [ ] **Créer l'app** `notifications`, **sans** cocher « Has Persistent Data »
- [ ] **Variables** — App Configs, tableau ci-dessous, puis Save & Update
- [ ] **Cocher « Do not expose as web-app »** — ce service ne publie rien sur
      internet
- [ ] **Déployer** — `caprover deploy` depuis `~/grindrise-notifications`, en
      choisissant l'app `notifications`
- [ ] **Vérifier les logs** — le worker doit annoncer `Worker à l'écoute`
- [ ] **Seulement ensuite**, ajouter `REDIS_URL` sur l'app de l'API →
      Save & Update (l'API redémarre)
- [ ] **Test réel** — enregistrer une séance qui fait franchir un niveau, et
      vérifier la réception de l'email

Un mot de passe Redis mal recopié se voit tout de suite côté worker : `/health`
répond 503. Côté API, non — d'où le correctif de la section suivante.

### Variables de l'app `notifications`

Requises — le service refuse de démarrer si l'une manque, c'est voulu :

| Variable | Valeur |
|---|---|
| `REDIS_URL` | `redis://:<mot-de-passe>@srv-captain--redis:6379` |
| `BREVO_API_KEY` | la clé générée à l'étape 1 |
| `BREVO_SENDER_EMAIL` | l'adresse validée à l'étape 1 |

Optionnelles :

| Variable | Défaut | Rôle |
|---|---|---|
| `BREVO_SENDER_NAME` | `Grindrise` | nom affiché de l'expéditeur |
| `BREVO_REPLY_TO` | aucune | adresse de réponse |
| `NOTIFICATIONS_QUEUE_NAME` | `notifications` | doit correspondre à celle de l'API |
| `WORKER_CONCURRENCY` | `5` | jobs traités en parallèle |
| `PORT` | `3001` | sonde `/health`, jamais exposée publiquement |
| `LOG_LEVEL` | `info` | `debug`, `info`, `warn` ou `error` |

> **Ne pas laisser `LOG_LEVEL=debug` en continu.** Ce niveau journalise le corps
> brut des réponses d'erreur de Brevo, qui peut contenir l'adresse email du
> destinataire. À n'activer que ponctuellement, le temps d'un diagnostic.

### Variables à ajouter sur l'app de l'API

| Variable | Effet |
|---|---|
| `REDIS_URL` | même valeur que ci-dessus. Absente, l'API ne produit aucune notification et le signale au démarrage |
| `NOTIFICATIONS_QUEUE_NAME` | seulement si le nom par défaut a été changé côté worker |

---

## À corriger avant de déployer

**Une `REDIS_URL` erronée fige `POST /workouts` côté API.** Mesuré le
2026-08-17, avec les options exactes de `notifications.queue.ts` :

| Situation | `queue.add()` | Effet sur la requête |
|---|---|---|
| Redis joignable au démarrage, coupé ensuite | rejette en ~90 ms | aucun, le `try/catch` fait son travail |
| Redis **jamais** joignable | ne rend jamais la main | la requête pend indéfiniment |

BullMQ attend un Redis « prêt » avant d'empiler, et ioredis retente la connexion
sans fin. `maxRetriesPerRequest: 1` et `enableOfflineQueue: false` ne bornent que
les commandes sur une connexion **déjà établie** — pas son établissement
initial. Et un `try/catch` protège d'une erreur, pas d'une attente.

Concrètement : un mot de passe Redis mal recopié dans `REDIS_URL` laisse l'API
démarrer normalement, `/health` répondre, tout paraître sain — jusqu'à ce que la
première séance qui fait franchir un niveau fige la requête du joueur.

Le correctif tient dans `enqueueLevelUp` : un `Promise.race` avec un délai de
garde de quelques secondes autour du `add`, l'appel étant best-effort de toute
façon. Borner les tentatives de connexion serait pire — la queue resterait morte
après le retour de Redis.

À faire dans le monorepo, avant l'étape 5.

---

## Ce qui reste en dette

Rien de bloquant pour un premier déploiement, mais à connaître.

- **Aucune intégration continue.** L'invariant central de l'architecture — les
  deux fichiers `contract.ts` identiques octet pour octet entre les deux dépôts —
  ne tient aujourd'hui que sur `pnpm run check:contract`, à lancer à la main. À
  automatiser avant de brancher le déploiement automatique sur push. Le script
  suppose le monorepo en `~/GrindRise` ; ailleurs, lui passer le chemin en
  argument ou par `GRINDRISE_API_PATH`.
- **Le nom d'expéditeur n'est pas aligné sur un domaine.** Voir l'étape 1 : tant
  que `BREVO_SENDER_EMAIL` reste une adresse `@gmail.com`, la délivrabilité est
  structurellement dégradée. Le domaine de l'étape 4 résout les deux.
- **Pas de désabonnement.** Un email de palier n'est pas strictement
  transactionnel : le joueur ne l'a pas demandé. Ni lien de désinscription, ni
  en-tête `List-Unsubscribe`, ni préférence en base. À prévoir avant un vrai
  lancement, autant pour le RGPD que pour la délivrabilité.
- **Livraison at-least-once.** Un container tué entre l'acceptation par Brevo et
  la clôture du job renverra l'email. Inhérent au modèle, acceptable pour une
  notification de félicitations.
- **Données personnelles au repos dans Redis.** L'adresse email vit dans le
  payload du job : 24 h après un succès, 7 jours après un échec. C'est la
  contrepartie assumée d'un worker sans accès à la base.
- **Un email définitivement échoué ne se rejoue pas tout seul.** La fenêtre de
  reprise couvre environ deux heures ; au-delà, le job garde son identifiant
  réservé 7 jours et doit être relancé à la main depuis un tableau de bord
  BullMQ. C'est documenté dans `src/queue/contract.ts`.

---

## Sans rapport avec ce chantier, mais à ne pas confondre

La limite de **2 emails par heure** rencontrée en test vient du service email
intégré de **Supabase Auth** (les codes de connexion), pas de ce service. Ce
déploiement ne la lève pas.

Elle se lève en configurant un SMTP tiers dans Supabase → Authentication → SMTP
Settings. Le compte Brevo créé à l'étape 1 peut servir aux deux — c'est là, et
seulement là, que `smtp-relay.brevo.com` entre en jeu. Sujet séparé, à traiter
quand le flux d'authentification sera stabilisé.

---

## Pour reprendre avec Claude

Le journal complet du chantier — chaque tâche, chaque revue, chaque constat
différé avec son arbitrage — est dans le monorepo, en
`.superpowers/sdd/2026-08-16-notifications-microservice/progress.md`. Il n'est pas
versionné (`.superpowers/` est ignoré par git), il ne vit donc que sur la machine
où le travail a été fait.

La spécification et le plan d'implémentation sont dans `docs/superpowers/` du
monorepo, également non versionnés.
