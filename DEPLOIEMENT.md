# Déploiement du service de notifications

Checklist de reprise, écrite le 2026-08-16 et révisée le 2026-08-17. Le code est
terminé et revu des deux côtés. Le compte Brevo existe, les deux dépôts sont
poussés, **le VPS est commandé et durci**. Ce qui reste tient à un nom de
domaine : sans lui, CapRover ne peut ni servir de sous-domaines ni obtenir de
certificat.

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

**Ce qui n'a jamais été fait** : aucun email réel n'a été envoyé, et aucune app
n'est déployée. Le serveur, lui, est prêt — voir l'étape 4. Il ne lui manque que
CapRover, bloqué par l'absence de nom de domaine.

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

## 4. Le serveur

**Fait le 2026-08-17**, sauf CapRover lui-même. Le VPS est commandé, durci et
prêt à recevoir l'installation.

### Ce qui tourne

| | |
|---|---|
| Hébergeur | OVH, VPS `vps-9528c445` |
| IPv4 | `92.222.80.54` |
| IPv6 | `2001:41d0:404:200::8e56` |
| Système | **Ubuntu 26.04 LTS** (« resolute »), noyau 7.0 |
| Ressources | 2 vCPU, 3,7 Go RAM, 38 Go disque |
| Swap | 2 Go, dans `/etc/fstab` |
| Docker | 29.7.2, actif au démarrage |
| Pare-feu | `ufw` actif : 22, 80, 443 |
| Anti-intrusion | `fail2ban`, prison `sshd` |
| Utilisateur | `ubuntu`, `sudo` sans mot de passe |

Ubuntu 26.04 et non 24.04 : le script officiel de Docker la gère sans problème,
vérifié. Le disque fait 38 Go et non 80 — sans conséquence, 2,6 Go étaient
utilisés après installation de Docker.

Le swap n'est pas décoratif : les VPS OVH n'en ont aucun, la stack au repos tient
dans ~1 Go mais **le build en réclame jusqu'à 2**. CapRover compile les images
sur le serveur ; sans swap, un `pnpm install` + `tsc` se fait tuer par l'OOM
killer au lieu de ralentir.

### Accès

```bash
ssh grindrise    # via ~/.ssh/config
```

Les deux clés qui ouvrent aujourd'hui ce serveur viennent de l'ordinateur du
travail et **sont à remplacer** — voir « Migrer vers l'ordinateur personnel ».

L'authentification par mot de passe **reste active**, et c'est volontaire : c'est
elle qui permettra d'installer la clé de la machine personnelle. Ne désactiver
`PasswordAuthentication` qu'une fois cette migration faite.

`fail2ban` gère le bruit : 188 tentatives d'intrusion détectées et des bannis dès
la première journée. C'est ce qui rend inutile le changement de port SSH souvent
recommandé — voir « Pièges rencontrés ».

En cas de perte d'accès IPv4, **l'IPv6 est un accès de secours indépendant** :

```powershell
ssh ubuntu@2001:41d0:404:200::8e56
```

Il a servi. Attention toutefois : ce secours repose sur une clé du travail, il
disparaîtra donc à la migration.

La console KVM d'OVH (menu « ... » sur la fiche du VPS) reste le recours ultime,
mais son clavier est en QWERTY et elle est bloquée par les bloqueurs de fenêtres
surgissantes.

### Installer CapRover

Il ne reste que cette étape, et **elle exige d'ouvrir les ports d'abord** :

```bash
sudo ufw allow 80,443,3000,996,7946,4789,2377/tcp
sudo ufw allow 7946,4789,2377/udp
```

```bash
sudo docker run -e ACCEPTED_TERMS=true \
  -p 80:80 -p 443:443 -p 3000:3000 \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -v /captain:/captain caprover/caprover
```

7946, 4789 et 2377 ne servent qu'à Swarm entre plusieurs machines : refermables
après l'installation sur un nœud unique.

### DNS et HTTPS

- [ ] **Un seul domaine suffit** pour tous les services — CapRover fabrique un
      sous-domaine par app
- [ ] **Enregistrement A** chez OVH : `*.apps.tondomaine.fr` → `92.222.80.54`
- [ ] Attendre la propagation — quelques minutes à quelques heures
- [ ] `npm install -g caprover` sur la machine de développement
- [ ] `caprover serversetup` : domaine racine, **changer le mot de passe
      `captain42`**, activer HTTPS et la redirection forcée
- [ ] Refermer le port 3000 une fois le tableau de bord servi en HTTPS

L'astérisque répond pour n'importe quel sous-domaine : aucune modification DNS ne
sera nécessaire en ajoutant des apps. Le worker `notifications`, lui, n'a besoin
d'aucun sous-domaine — il n'est joignable que par le réseau interne de Docker.

Attention aux extensions `.app` : elles imposent le HTTPS au niveau des
navigateurs (préchargement HSTS), donc aucun accès en HTTP clair. Un `.fr` ou un
`.com` est plus souple pour une première installation.

### Pièges rencontrés

**`ufw` bloque l'installation de CapRover.** L'installateur teste le port 3000 en
posant un écouteur ordinaire sur l'hôte — pas un port publié par Docker — donc
`ufw` s'y applique pleinement et l'installation échoue sur `Port timed out: 3000`.
D'où les règles à poser avant. Cela ne contredit pas le point suivant : ce sont
deux mécanismes distincts.

**`ufw` ne protège pas les ports publiés par Docker.** Docker insère ses règles
de redirection en amont de la chaîne où `ufw` opère : un `ufw deny 3000`
s'afficherait « actif » avec le port grand ouvert. Le seul levier correct est la
chaîne `DOCKER-USER`. À garder en tête pour refermer le port 3000.

**Ne pas changer le port SSH sur Ubuntu 24.04+.** `ssh.socket` remplace le démon
classique : une directive `Port` dans `sshd_config` est ignorée, il faut
surcharger l'unité systemd. Et surtout, `ListenStream=` (vide) **annule les
adresses d'écoute par défaut** — redéclarer `ListenStream=22` seul produit une
socket IPv6 uniquement, qui n'accepte aucune connexion IPv4. Résultat : accès
coupé sur tous les ports à la fois, alors que le service tourne. Si le changement
est vraiment souhaité, déclarer les quatre adresses explicitement
(`0.0.0.0:22`, `[::]:22`, `0.0.0.0:<port>`, `[::]:<port>`) et garder une session
de secours ouverte. Le gain reste marginal face à `fail2ban`.

### Migrer vers l'ordinateur personnel — à faire

**Le serveur a été configuré depuis un ordinateur du travail.** Rien de ce qui
précède n'en dépend : le swap, Docker, `ufw`, `fail2ban` vivent sur le VPS et
ignorent tout de la machine qui les a installés. Il n'y a donc rien à refaire.

**Sauf les clés SSH.** Elles sont la seule trace, et il y en a deux, toutes deux
issues de l'ordinateur du travail — les deux doivent disparaître :

| Empreinte | Commentaire | Origine |
|---|---|---|
| `SHA256:GPOv…` | `alexis.delporte@likewatt.com` | posée par OVH à la commande ; sert aussi à GitHub |
| `SHA256:9C0i…` | `dalexis@LIKEWATT-ADP` | générée pendant la configuration |

La marche à suivre, **depuis l'ordinateur personnel** :

```bash
# 1. generer une cle neuve, sur la machine perso
ssh-keygen -t ed25519 -f ~/.ssh/grindrise

# 2. l'installer (demande le mot de passe : c'est pour ca qu'il reste actif)
ssh-copy-id -i ~/.ssh/grindrise.pub ubuntu@92.222.80.54

# 3. VERIFIER qu'elle fonctionne — ne rien supprimer avant d'avoir vu ce prompt
ssh -i ~/.ssh/grindrise ubuntu@92.222.80.54

# 4. ecraser authorized_keys : les deux cles du travail disparaissent ici
cat ~/.ssh/grindrise.pub | ssh -i ~/.ssh/grindrise ubuntu@92.222.80.54 \
  'cat > ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys'

# 5. controler qu'il ne reste que la nouvelle
ssh -i ~/.ssh/grindrise ubuntu@92.222.80.54 'ssh-keygen -lf ~/.ssh/authorized_keys'

# 6. seulement alors, couper le mot de passe
ssh -i ~/.ssh/grindrise ubuntu@92.222.80.54 \
  "echo 'PasswordAuthentication no' | sudo tee /etc/ssh/sshd_config.d/99-durcissement.conf && sudo systemctl reload ssh"
```

L'ordre n'est pas négociable : l'étape 4 retire les seules clés qui donnent accès
au serveur, et l'étape 6 retire le mot de passe qui sert de filet. Inverser, c'est
se retrouver dehors avec pour seul recours la console KVM d'OVH.

> **L'étape 4 supprime aussi l'accès de secours par IPv6 depuis PowerShell.**
> C'est la clé `SHA256:GPOv…` qui l'autorisait — celle qui a permis de rattraper
> l'incident du port SSH. Après migration, le secours redevient la console KVM.

Recréer `~/.ssh/config` sur la machine perso :

```
Host grindrise
    HostName 92.222.80.54
    User ubuntu
    IdentityFile ~/.ssh/grindrise
    IdentitiesOnly yes
```

**GitHub est un lien distinct**, que la manœuvre ci-dessus ne coupe pas : le
compte personnel `AlexDDevv` s'authentifie aujourd'hui avec la clé du travail.
Générer une seconde clé sur la machine perso, l'ajouter dans *Settings → SSH and
GPG keys*, puis y supprimer l'ancienne.

**Sur l'ordinateur du travail**, avant de le rendre : `~/.ssh/grindrise` et
`~/.ssh/grindrise.pub`, l'entrée dans `~/.ssh/config`, la ligne du VPS dans
`~/.ssh/known_hosts`, et les deux clones — ils contiennent le `.env`, donc la clé
API Brevo, qu'il vaut mieux régénérer depuis le tableau de bord une fois chez
soi.

Restent alors deux traces mineures côté serveur : `/var/log/auth.log`, qui expire
de lui-même en quatre semaines, et `~/.bash_history`.

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
