# Déploiement — la plateforme et le worker

Tout ce qu'il faut savoir pour déployer : le serveur, CapRover, le DNS, Redis,
Brevo, et ce service. Écrit entre le 2026-08-16 et le 2026-08-19, au fil d'un
chantier terminé — chaque commande ci-dessous a été exécutée.

**Ce qui est ailleurs.** La base Supabase, l'API NestJS et le mobile vivent dans
le monorepo `~/GrindRise`, dont le `DEPLOIEMENT.md` les couvre. Ce document-ci
porte l'infrastructure partagée, parce que c'est ici qu'elle a été construite.

**État : tout est déployé et la chaîne est prouvée de bout en bout.** Un joueur
qui franchit un palier reçoit son email — vérifié le 2026-08-19 sur
l'environnement de test, jusqu'au `delivered` côté Brevo.

---

## Ce qui tourne

| | |
|---|---|
| Hébergeur | OVH, VPS `vps-9528c445` |
| IPv4 | `92.222.80.54` |
| IPv6 | `2001:41d0:404:200::8e56` |
| Système | Ubuntu 26.04 LTS (« resolute ») |
| Ressources | 2 vCPU, 3,7 Go RAM, 38 Go disque |
| Swap | 2 Go, dans `/etc/fstab` |
| Docker | actif au démarrage |
| Pare-feu | `ufw` actif : 22, 80, 443, 3000, 996, 7946, 4789, 2377 |
| Port 3000 | fermé au trafic internet par l'unité `caprover-firewall.service` |
| Anti-intrusion | `fail2ban`, prison `sshd` |
| CapRover | 1.15.2, `https://captain.apps.grindrise.fr` |
| Domaine | `grindrise.fr`, acheté le 2026-08-18, expire le 2027-08-18 |
| Domaine racine CapRover | `apps.grindrise.fr` |

Six apps, sur deux environnements :

| | Production | Test (Project CapRover `test`) |
|---|---|---|
| Redis | `redis` (volume `redis-redis-data`) | `redis-test` (volume `redis-test-data`) |
| API | `api` → `api.apps.grindrise.fr` | `api-test` → `api-test.apps.grindrise.fr` |
| Worker | `notifications` | `notifications-test` |

Les deux Redis sont des instances distinctes : le nom de file `notifications`
peut être identique de part et d'autre sans qu'aucun job ne traverse.

**Le swap n'est pas décoratif.** Les VPS OVH n'en ont aucun. La stack au repos
tient dans ~1 Go, mais **le build en réclame jusqu'à 2** : CapRover compile les
images sur le serveur, et sans swap un `pnpm install` + `tsc` se fait tuer par
l'OOM killer au lieu de ralentir.

Ubuntu 26.04 et non 24.04 : le script officiel de Docker la gère sans problème.

---

## Accès au serveur

```bash
ssh grindrise    # via ~/.ssh/config
```

**L'authentification par mot de passe reste active, volontairement** : c'est elle
qui permettra d'installer la clé de la machine personnelle. Ne couper
`PasswordAuthentication` qu'après cette migration.

`fail2ban` gère le bruit — 188 tentatives d'intrusion et des bannis dès la
première journée. C'est ce qui rend inutile le changement de port SSH souvent
recommandé.

En cas de perte d'accès IPv4, **l'IPv6 est un accès de secours indépendant** ; il
a déjà servi :

```bash
ssh ubuntu@2001:41d0:404:200::8e56
```

La console KVM d'OVH (menu « … » sur la fiche du VPS) reste le recours ultime,
mais son clavier est en QWERTY et elle est bloquée par les bloqueurs de fenêtres
surgissantes.

### Dette ouverte — migrer les clés SSH

**Le serveur a été configuré depuis un ordinateur du travail.** Rien de ce qui
tourne n'en dépend : le swap, Docker, `ufw`, `fail2ban` vivent sur le VPS et
ignorent la machine qui les a installés. Il n'y a rien à refaire.

**Sauf les clés.** Il y en a deux, toutes deux issues de cet ordinateur, et les
deux doivent disparaître :

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

**L'ordre n'est pas négociable** : l'étape 4 retire les seules clés qui donnent
accès au serveur, et l'étape 6 retire le mot de passe qui sert de filet. Inverser,
c'est se retrouver dehors avec pour seul recours la console KVM.

> **L'étape 4 supprime aussi l'accès de secours par IPv6.** C'est la clé
> `SHA256:GPOv…` qui l'autorisait — celle qui a permis de rattraper l'incident du
> port SSH. Après migration, le secours redevient la console KVM.

Recréer `~/.ssh/config` sur la machine perso :

```
Host grindrise
    HostName 92.222.80.54
    User ubuntu
    IdentityFile ~/.ssh/grindrise
    IdentitiesOnly yes
```

**GitHub est un lien distinct** que cette manœuvre ne coupe pas : le compte
`AlexDDevv` s'authentifie aujourd'hui avec la clé du travail. Générer une seconde
clé, l'ajouter dans *Settings → SSH and GPG keys*, puis y supprimer l'ancienne.

**Sur l'ordinateur du travail**, avant de le rendre : `~/.ssh/grindrise*`,
l'entrée dans `~/.ssh/config`, la ligne du VPS dans `~/.ssh/known_hosts`, et les
deux clones — ils contiennent les `.env`, donc la clé API Brevo, qu'il vaut mieux
régénérer. Restent deux traces mineures côté serveur : `/var/log/auth.log`, qui
expire de lui-même en quatre semaines, et `~/.bash_history`.

---

## CapRover

### Réinstaller, le cas échéant

**Ouvrir les ports d'abord**, sans quoi l'installation échoue sur `Port timed
out: 3000` :

```bash
sudo ufw allow 80,443,3000,996,7946,4789,2377/tcp
sudo ufw allow 7946,4789,2377/udp

sudo docker run -e ACCEPTED_TERMS=true \
  -p 80:80 -p 443:443 -p 3000:3000 \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -v /captain:/captain caprover/caprover
```

7946, 4789 et 2377 ne servent qu'à Swarm entre plusieurs machines : refermables
après installation sur un nœud unique.

Puis, depuis la machine de développement, `caprover serversetup` avec
**`apps.grindrise.fr`** comme domaine racine — commande interactive, qui demande
un mot de passe (changer `captain42`) et une adresse pour Let's Encrypt. Activer
HTTPS et la redirection forcée, puis refermer le port 3000.

### Le CLI

```bash
pnpm add -g caprover
caprover login          # captain.apps.grindrise.fr
caprover list
```

Le CLI devient parfois interactif à l'étape « Ensuring authentication » alors que
son token est encore valide. L'API répond en direct, ce qui débloque toute
automatisation :

```bash
CAP=https://captain.apps.grindrise.fr/api/v2
TOKEN=$(python3 -c "import json;print(json.load(open('$HOME/.config/configstore/caprover.json'))['CapMachines'][0]['authToken'])")
curl -s -H "x-captain-auth: $TOKEN" -H 'x-namespace: captain' "$CAP/user/apps/appDefinitions"
```

Deux surprises de cette API : `POST /user/projects/register` attend
`{"name":"…"}` **à la racine** du corps — sous `projectDefinition` il répond
« Project name is not allowed », ce qui envoie chercher un problème de nom qui
n'existe pas. Et `/user/apps/appDefinitions/update` attend la définition
**complète** : reconstruire le corps depuis un `GET`, sinon les champs omis sont
perdus.

> **Le CLI mémorise la source de déploiement, pas la branche.**
> `~/.config/configstore/caprover.json` (`DeployedDirs`) garde par répertoire
> courant ce qu'on lui a donné la dernière fois, et c'est ce que rejoue
> `caprover deploy -d`. Deux façons de se faire piéger, les deux silencieuses :
> une branche `test` restée mémorisée après une fusion ; et surtout un chemin
> d'archive dans un `/tmp` de session terminée, dont le fichier existait toujours,
> figé — `-d` y serait reparti **sans jamais lire le dépôt**. Toujours passer
> `-b <branche>` explicitement : une branche ne peut pas être périmée, un fichier
> sur disque oui.

### Redis

**Redis ne s'installe pas par « Create New App ».** Une app ainsi créée tourne
l'image `caprover/caprover-placeholder-app` — la page d'attente — et aucun serveur
Redis n'existe derrière. Il faut le catalogue **One-Click Apps/Databases**. Le
symptôme est trompeur : le worker démarre, échoue à se connecter, et rien ne dit
que Redis n'existe pas.

L'instance de test a été créée à la main, par nom d'image `redis:7.2.4`, avec un
volume persistant sur `/data` et cette surcharge de commande (*Service Update
Override*) :

```yaml
TaskTemplate:
  ContainerSpec:
    Command:
      - sh
      - -c
      - redis-server --requirepass $REDIS_PASSWORD
```

**Générer le mot de passe en alphanumérique pur** — `openssl rand -hex 24` —
plutôt qu'encoder des caractères spéciaux : voir le piège `REDIS_URL` plus bas.
Ne jamais exposer ces apps ; cocher « Do not expose as web-app ». Les autres apps
les atteignent par `srv-captain--redis:6379` sur le réseau interne.

### DNS et HTTPS

`grindrise.fr` chez OVH, serveurs de noms `ns106.ovh.net` / `dns106.ovh.net`, avec
un enregistrement **A** sur le sous-domaine **`*.apps`** vers `92.222.80.54`.

Un `.fr` plutôt qu'un `.app` : ce dernier impose le HTTPS au niveau des
navigateurs (préchargement HSTS), donc aucun accès en HTTP clair — gênant
justement pendant l'installation, avant que Let's Encrypt ait délivré le
certificat. Le `.fr` est aussi moins cher. `grindrise.com` était déjà pris par une
marque de vêtements ; les recherches INPI et EUIPO sur « grindrise » n'ont rien
donné.

Le wildcard sur `*.apps` et non sur `*` laisse `grindrise.fr` et `www` libres pour
un futur site vitrine, et évite de repeindre le DNS à chaque app ajoutée. Les
workers n'ont besoin d'aucun sous-domaine.

**Diagnostiquer le DNS sans dépendre de la propagation.** `dig` est installé sur
le VPS, donc la zone d'OVH est consultable avant publication par l'AFNIC :

```bash
ssh grindrise "dig +short @ns106.ovh.net captain.apps.grindrise.fr A"
curl -s 'https://dns.google/resolve?name=captain.apps.grindrise.fr&type=A'   # "Status":3 = NXDOMAIN
curl -s https://rdap.nic.fr/domain/grindrise.fr                              # domaine enregistré ?
```

Le dernier distingue une délégation en attente d'une erreur de saisie.

`grindrise.fr` est authentifié chez Brevo, DKIM et DMARC posés dans la zone OVH.

### Pièges — serveur et réseau

**`ufw` bloque l'installation de CapRover.** L'installateur teste le port 3000 en
posant un écouteur ordinaire sur l'hôte — pas un port publié par Docker — donc
`ufw` s'y applique pleinement. D'où les règles à poser avant.

**`ufw` ne protège pas les ports publiés par Docker.** Docker insère ses règles de
redirection en amont de la chaîne où `ufw` opère : un `ufw deny 3000` s'afficherait
« actif » avec le port grand ouvert. Le seul levier correct est la chaîne
`DOCKER-USER` — c'est ce que fait `caprover-firewall.service`. Ce n'est pas en
contradiction avec le point précédent : deux mécanismes distincts.

**Ne pas changer le port SSH sur Ubuntu 24.04+.** `ssh.socket` remplace le démon
classique : une directive `Port` dans `sshd_config` est ignorée. Et surtout,
`ListenStream=` vide **annule les adresses d'écoute par défaut** — redéclarer
`ListenStream=22` seul produit une socket IPv6 uniquement, qui n'accepte aucune
connexion IPv4. Résultat : accès coupé sur tous les ports à la fois, alors que le
service tourne. Si le changement est vraiment souhaité, déclarer les quatre
adresses explicitement et garder une session de secours ouverte. Le gain reste
marginal face à `fail2ban`.

### Pièges — apps CapRover

**Le port du container n'est pas celui qu'on croit.** CapRover proxie vers le port
**80** par défaut ; l'API écoute sur **3000**. Sans `Container HTTP Port` réglé,
on obtient une 502 sans explication.

**Activer « Force HTTPS ».** Une app exposée répond en HTTP clair tant que la case
n'est pas cochée. Pour l'API, cela signifie l'en-tête `Authorization: Bearer` en
clair sur le réseau. Le certificat du sous-domaine demande une activation
explicite.

**Des erreurs au démarrage sont normales.** Quand Redis et un consommateur
redémarrent ensemble, l'alias `srv-captain--redis` n'est pas immédiatement
résolvable et le worker journalise quelques `ENOTFOUND` avant de se connecter.
Elles tiennent dans la première seconde ; ce qui compte est qu'elles cessent.

---

## Déployer ce service

```bash
cd ~/grindrise-notifications
caprover deploy -n grindrise -a notifications -b main        # production
caprover deploy -n grindrise -a notifications-test -b main   # test
```

La racine du dépôt est une racine git, donc `-b` fonctionne sans réglage
particulier. Le `captain-definition` et le `Dockerfile` sont à la racine.

Configuration de l'app : **sans** « Has Persistent Data », **avec** « Do not
expose as web-app » — ce service ne publie rien.

**Vérifier après déploiement** que les logs affichent `Worker à l'écoute`, avec la
bonne file et le bon fournisseur.

### Variables

Requises — le service **refuse de démarrer** si l'une manque, c'est voulu :

| Variable | Valeur |
|---|---|
| `REDIS_URL` | `redis://:<mot-de-passe>@srv-captain--redis:6379` |
| `BREVO_API_KEY` | onglet **API** de Brevo, pas SMTP |
| `BREVO_SENDER_EMAIL` | adresse validée dans Brevo |

Optionnelles :

| Variable | Défaut | Rôle |
|---|---|---|
| `BREVO_SENDER_NAME` | `Grindrise` | nom affiché de l'expéditeur |
| `BREVO_REPLY_TO` | aucune | adresse de réponse |
| `NOTIFICATIONS_QUEUE_NAME` | `notifications` | **doit correspondre à celle de l'API** — un nom divergent produit un worker qui ne consomme rien, sans erreur visible |
| `WORKER_CONCURRENCY` | `5` | jobs traités en parallèle |
| `PORT` | `3001` | sonde `/health`, jamais exposée publiquement |
| `LOG_LEVEL` | `info` | `debug`, `info`, `warn` ou `error` |

> **Ne pas laisser `LOG_LEVEL=debug` en continu.** Ce niveau journalise le corps
> brut des réponses d'erreur de Brevo, qui peut contenir l'adresse email du
> destinataire. À n'activer que le temps d'un diagnostic.

### Brevo : deux canaux, deux clés

Brevo expose sous deux onglets voisins la clé **API**, dont ce service se sert
pour parler à `api.brevo.com`, et la clé **SMTP**, dont Supabase Auth se sert pour
les codes de connexion. **Passer l'une pour l'autre échoue à l'authentification
d'une façon qui ressemble à un mot de passe erroné**, et cette confusion a déjà
coûté du temps.

Le **quota de 300 emails/jour du plan gratuit est commun** à tout : emails
d'authentification et de palier, production et test confondus.

Une adresse d'expédition n'a **pas besoin d'exister** comme boîte : Brevo vérifie
qu'on possède le domaine, pas qu'un courrier y arrive. D'où `BREVO_REPLY_TO`
renseigné avec une adresse réelle.

Le détour valait la peine d'être compris : `gmail.com` publie une politique DMARC,
donc un `From:` en `@gmail.com` expédié par les serveurs de Brevo échoue
l'alignement — la signature ne peut pas porter sur un domaine qu'on ne contrôle
pas. Authentifier son domaine ne sert à rien tant que l'expéditeur reste ailleurs.
Le changement a coûté **une seule variable**, `BREVO_SENDER_EMAIL`, sans toucher
au code : c'était la promesse de la conception, elle a tenu.

---

## Vérifier sans se fier aux logs

Les logs affichent l'historique : une erreur ancienne y reste visible. Trois
contrôles factuels, depuis le serveur :

```bash
# la sonde du worker — 503 si Redis n'est pas joignable
docker run --rm --network <reseau> curlimages/curl -s \
  http://srv-captain--notifications:3001/health

# le producteur a-t-il vraiment une connexion ouverte ? (6379 = 0x18EB)
docker exec <container-api> sh -c 'cat /proc/net/tcp' | awk '$3 ~ /:18EB$/ && $4=="01"'

# erreurs des 2 dernieres minutes seulement
docker service logs notifications --since 2m | grep '"level":"error"'
```

Le `CLIENT LIST` de Redis, lui, **induit en erreur** : sur un réseau overlay il
montre l'adresse de la répartition de charge, pas celle des containers.

Le **journal d'événements Brevo** est le contrôle le plus direct de tout envoi —
il distingue `requests` (accepté) de `delivered` (arrivé) :

```bash
curl -s -H "api-key: $BREVO_API_KEY" \
  'https://api.brevo.com/v3/smtp/statistics/events?email=destinataire@exemple.fr&limit=5'
```

Un succès local est silencieux : `Job terminé` est journalisé en `debug`, donc
invisible avec le `LOG_LEVEL=info` par défaut. Seuls les échecs parlent.

**Piège du script d'injection :** `pnpm run sample` **sans argument écrit à
`BREVO_SENDER_EMAIL`**, derrière laquelle aucune boîte n'existe. Passer le
destinataire explicitement : `pnpm run sample mon.adresse@exemple.fr`.

---

## La leçon la plus coûteuse : un `try/catch` ne protège pas d'une attente

Corrigé le 2026-08-19 par le commit `dd36349` du monorepo. Conservé ici parce que
le raisonnement resservira à chaque fois qu'un appel réseau entrera dans le chemin
d'une requête.

**Une `REDIS_URL` erronée figeait `POST /workouts`.** Mesuré avec les options
exactes de `notifications.queue.ts` :

| Situation | `queue.add()` | Effet sur la requête |
|---|---|---|
| Redis joignable au démarrage, coupé ensuite | rejette en ~90 ms | aucun, le `try/catch` fait son travail |
| Redis **jamais** joignable | ne rend jamais la main | la requête pend indéfiniment |

BullMQ attend un Redis « prêt » avant d'empiler, et ioredis retente la connexion
sans fin. `maxRetriesPerRequest: 1` et `enableOfflineQueue: false` ne bornent que
les commandes sur une connexion **déjà établie** — pas son établissement initial.

Concrètement : un mot de passe Redis mal recopié laisse l'API démarrer,
`/health` répondre, tout paraître sain — jusqu'à ce que la première séance qui
fait franchir un niveau fige la requête du joueur.

Le correctif tient dans `enqueueLevelUp` : un `Promise.race` avec un délai de
garde autour du `add`, l'appel étant best-effort de toute façon. Borner les
tentatives de connexion d'ioredis aurait été pire — la queue serait restée morte
après le retour de Redis.

**`REDIS_URL` a d'ailleurs produit trois pannes différentes pour un même
symptôme.** Le log `ECONNREFUSED 127.0.0.1:6379` signifie seulement qu'ioredis
n'a pas su lire l'adresse et s'est rabattu sur son défaut. Causes rencontrées :
la valeur locale du `.env` recopiée telle quelle ; Redis inexistant ; et un **mot
de passe contenant `#`**, qui ouvre un fragment d'URL et rend l'adresse
illisible.

---

## Ce qui reste en dette

Rien de bloquant, mais à connaître.

- **Aucune intégration continue.** L'invariant central de l'architecture — les
  deux `contract.ts` identiques octet pour octet entre les deux dépôts — ne tient
  que sur `pnpm run check:contract`, à lancer à la main. À automatiser avant de
  brancher un déploiement sur push. Le script suppose le monorepo en
  `~/GrindRise` ; ailleurs, lui passer le chemin en argument ou par
  `GRINDRISE_API_PATH`.
- **Migrer les clés SSH** vers l'ordinateur personnel — voir plus haut. C'est la
  seule dette qui ait une échéance externe.
- **Aucune boîte derrière l'adresse d'expédition.** L'envoi n'en a pas besoin,
  mais un joueur qui y écrirait n'atteindrait personne. `BREVO_REPLY_TO` couvre
  les réponses ; une redirection OVH gratuite rendrait l'adresse joignable.
- **Pas de désabonnement.** Un email de palier n'est pas strictement
  transactionnel : le joueur ne l'a pas demandé. Ni lien de désinscription, ni
  en-tête `List-Unsubscribe`, ni préférence en base. À prévoir avant un vrai
  lancement, autant pour le RGPD que pour la délivrabilité.
- **Livraison at-least-once.** Un container tué entre l'acceptation par Brevo et
  la clôture du job renverra l'email. Inhérent au modèle, acceptable pour une
  notification de félicitations.
- **Données personnelles au repos dans Redis.** L'adresse email vit dans le
  payload du job : 24 h après un succès, 7 jours après un échec. Contrepartie
  assumée d'un worker sans accès à la base.
- **Un email définitivement échoué ne se rejoue pas tout seul.** La fenêtre de
  reprise couvre environ deux heures ; au-delà, le job garde son identifiant
  réservé 7 jours et doit être relancé à la main depuis un tableau de bord
  BullMQ. Documenté dans `src/queue/contract.ts`.
