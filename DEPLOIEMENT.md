# Déploiement du service de notifications

Checklist de reprise, écrite le 2026-08-16, révisée le 2026-08-18. Le code est
terminé et revu des deux côtés.

Ce document se lit sans rien avoir en tête : il rappelle où en est le chantier
avant de dire quoi faire.

---

## État au 2026-08-19 — déployé

**Ce qui est fait et vérifié :**

- **Chaîne prouvée en local** — un email réel est parti et a été reçu (étape 3)
- **Serveur** — VPS OVH durci : swap, Docker, `ufw`, `fail2ban` (voir étape 4)
- **DNS** — `*.apps.grindrise.fr` → `92.222.80.54`, délégation AFNIC publiée
- **CapRover 1.15.2 installé et configuré** — tableau de bord en HTTPS sur
  `https://captain.apps.grindrise.fr`, certificat Let's Encrypt valide jusqu'au
  2026-11-16, mot de passe `captain42` remplacé, redirection HTTP forcée
- **Port 3000 fermé** au trafic internet par l'unité systemd
  `caprover-firewall.service` — le tout revérifié après redémarrage
- **Brevo** — `grindrise.fr` authentifié, expéditeur `notifications@grindrise.fr`
  créé, l'ancienne adresse `@gmail.com` supprimée
- **`POST /workouts` corrigé** — commit `dd36349` du monorepo, `contract.ts`
  vérifié identique au jumeau
- **Les trois apps tournent** — `redis`, `api`, `notifications`
- **Chaîne de production prouvée** — un job injecté dans le Redis de production a
  été consommé par le worker déployé et l'email est arrivé
- **Producteur connecté** — le container de l'API tient une connexion TCP
  établie vers `srv-captain--redis:6379`

**Le chantier est terminé.** Les deux derniers points ont été levés le
2026-08-19 :

- **La montée de niveau réelle est prouvée** — le maillon qui n'avait jamais été
  exercé. Une séance enregistrée par `POST /workouts` a fait passer un compte du
  niveau 1 au niveau 2 ; l'API a journalisé « Notification de palier 2
  produite », le worker « Email de palier envoyé » 172 ms plus tard, et Brevo a
  confirmé l'email « Niveau 2 atteint » en `delivered`.
- **`test` est fusionné dans `main`** dans les deux dépôts.

**Décisions prises :**

- Déploiement depuis **`main`** dans les deux dépôts, depuis la fusion du
  2026-08-19. Auparavant depuis `test`.
- Domaine racine CapRover : **`apps.grindrise.fr`** (l'outil préfixe `captain.`).
- **Le test réel n'a finalement pas eu lieu en production, et c'est mieux
  ainsi.** La décision initiale — le faire depuis l'app, contre la production,
  faute d'alternative — a été remplacée : un **environnement de test** complet a
  été monté le 2026-08-19 précisément pour lever l'interdit. Second projet
  Supabase, apps `redis-test` / `api-test` / `notifications-test` sous un Project
  CapRover `test`. De fausses séances en production auraient crédité de l'XP
  réelle, consommé une fenêtre anti-triche et débloqué des passages narratifs,
  sans retour en arrière ; le maillon est désormais exerçable autant de fois
  qu'on veut, sans conséquence.

**Un piège à retenir :** `pnpm run sample` **sans argument écrit à
`BREVO_SENDER_EMAIL`**, donc à `notifications@grindrise.fr`, derrière laquelle
aucune boîte n'existe. Passer le destinataire explicitement :
`pnpm run sample mon.adresse@exemple.fr`.

---

## Où en est le chantier

Deux dépôts sont concernés.

| Dépôt | Chemin local | Branche | État |
|---|---|---|---|
| Service de notifications | `~/grindrise-notifications` | `main` | 48 tests verts, poussé |
| Monorepo Grindrise | `~/GrindRise` | `main` | 92 tests verts, poussé |

Depuis la fusion du 2026-08-19, `main` et `test` portent le même arbre dans les
deux dépôts. C'est `main` qui fait foi.

**Ce qui fonctionne déjà**, vérifié et non supposé :

- **la chaîne complète a envoyé un vrai email**, le 2026-08-18 : job déposé dans
  Redis, consommé par le worker, accepté par l'API Brevo, reçu dans la boîte du
  destinataire. C'est la seule preuve qui compte, et elle est faite ;
- le service consomme une queue BullMQ et envoie par l'API Brevo, derrière une
  interface `EmailProvider` qui rend un changement de fournisseur trivial ;
- l'image Docker se construit (60 Mo, sans aucun secret dedans — vérifié en
  inspectant l'image) ;
- l'API NestJS produit un job quand un joueur franchit un niveau, en best-effort :
  une panne de Redis n'a aucun effet sur `POST /workouts`, y compris quand Redis
  n'a jamais été joignable — c'est l'objet du correctif `dd36349` ;
- le `/health` **du worker** répond 503 si Redis n'est pas joignable, donc un mot
  de passe Redis mal recopié s'y voit immédiatement. L'API n'a pas cet
  équivalent.

**Il ne reste rien de ce chantier.** Tout est déployé, et la chaîne est prouvée
de bout en bout jusqu'à l'email de palier — voir l'état en tête de document.

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

**Depuis le 2026-08-19, l'expéditeur est `notifications@grindrise.fr`** et le
domaine est authentifié chez Brevo (DKIM et DMARC posés dans la zone OVH).
L'adresse `@gmail.com` initiale a été supprimée.

Le détour valait la peine d'être compris : `gmail.com` publie une politique
DMARC, donc un `From:` en `@gmail.com` expédié par les serveurs de Brevo échoue
l'alignement — la signature ne peut pas porter sur un domaine qu'on ne contrôle
pas. Brevo le signalait lui-même : *« Le domaine Freemail n'est pas recommandé »*,
et *« non conforme aux nouvelles exigences de Google, Yahoo et Microsoft »*.
Authentifier le domaine ne sert à rien tant que l'expéditeur reste ailleurs.

Le changement a coûté **une seule variable**, `BREVO_SENDER_EMAIL`, sans toucher
au code : l'identité de l'expéditeur n'apparaît nulle part ailleurs. C'était la
promesse de la conception, elle a tenu.

Une adresse d'expédition n'a **pas besoin d'exister** comme boîte mail : Brevo
vérifie qu'on possède le domaine, pas qu'un courrier y arrive. En revanche une
réponse se perdrait, d'où `BREVO_REPLY_TO` renseigné avec une adresse réelle.

---

## 2. Pousser le service sur GitHub

**Fait.** Le dépôt est poussé en SSH sur
`git@github.com:AlexDDevv/grindrise-notifications.git`, branches `main` et `test`
à jour côté distant, et l'accès fonctionne.

**Décision prise, puis honorée** : on a déployé depuis `test` jusqu'à ce que le
test réel soit concluant, et `test` a été fusionné dans `main` le 2026-08-19.
C'est désormais `main` qui se déploie.

---

## 3. Valider la chaîne en local

**Fait le 2026-08-18** — email envoyé et reçu. C'était la seule étape prouvant
que tout fonctionne bout en bout, et le seul moyen de le faire sans serveur.

- [x] Renseigner `.env` à partir de `.env.example` (clé Brevo + adresse validée)
- [x] `pnpm install` si `node_modules` est absent
- [x] `pnpm run redis:up` — Redis local via Docker
- [x] `pnpm run dev` dans un terminal, attendre `Worker à l'écoute`
- [x] `pnpm run sample` dans un second terminal
- [x] Vérifier la réception de l'email
- [ ] `pnpm run redis:down` en fin de séance

La procédure reste valable pour rejouer la chaîne après toute modification du
worker, du template ou du contrat.

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

**Fait les 2026-08-17 et 18.** VPS commandé, durci, CapRover installé et servi
en HTTPS.

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
| Pare-feu | `ufw` actif : 22, 80, 443, 3000, 996, 7946, 4789, 2377 |
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
recommandé — voir « Pièges rencontrés — serveur et réseau ».

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

**L'installation exige d'ouvrir les ports d'abord**, sans quoi elle échoue sur
`Port timed out: 3000` :

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

**Domaine retenu : `grindrise.fr`**, acheté chez OVH le 2026-08-18 à 15h07 UTC,
expiration le 2027-08-18. `grindrise.com` était déjà pris par une marque de
vêtements ; les recherches INPI et EUIPO sur « grindrise » n'ont rien donné, donc
aucune marque enregistrée ne couvre la France sur ce nom.

Un `.fr` plutôt qu'un `.app` : ce dernier impose le HTTPS au niveau des
navigateurs (préchargement HSTS), donc aucun accès en HTTP clair — gênant
justement pendant l'installation, avant que Let's Encrypt ait délivré le
certificat. Le `.fr` est aussi moins cher.

État au 2026-08-18 en fin de journée :

| | |
|---|---|
| Enregistrement au registre | fait, statut « add period » |
| Serveurs de noms déclarés | `ns106.ovh.net`, `dns106.ovh.net` |
| Délégation publiée par l'AFNIC | **non** — résolveurs publics en `NXDOMAIN` |
| Zone chez OVH | par défaut : apex et `www` vers le parking `213.186.33.5` |
| Enregistrement `*.apps` | **absent** de la zone |

Reste donc à faire :

- [ ] **Vérifier la zone DNS** chez OVH — l'entrée `*.apps` n'y figurait pas.
      Type **A**, sous-domaine **`*.apps`** (ne pas retaper `.grindrise.fr`, le
      champ l'affiche déjà), cible **`92.222.80.54`**. OVH demande une
      confirmation en deux temps ; sans elle, rien n'est enregistré.
- [ ] Attendre la délégation AFNIC — quelques heures, rien à faire
- [ ] `npm install -g caprover` sur la machine de développement
- [ ] `caprover serversetup` avec **`apps.grindrise.fr`** comme domaine racine.
      Commande interactive : elle demande un mot de passe (**changer
      `captain42`**) et une adresse email pour Let's Encrypt. Activer HTTPS et la
      redirection forcée.
- [ ] Refermer le port 3000 une fois le tableau de bord servi en HTTPS

Les apps vivront sous `captain.apps.grindrise.fr`, `api.apps.grindrise.fr`, etc.
Le wildcard sur `*.apps` et non sur `*` laisse `grindrise.fr` et
`www.grindrise.fr` libres pour un futur site vitrine, et évite de repeindre le
DNS à chaque app ajoutée. Le worker `notifications` n'a besoin d'aucun
sous-domaine : il n'est joignable que par le réseau interne de Docker.

**Diagnostiquer le DNS sans dépendre de la propagation.** `dig` est installé sur
le VPS, ce qui permet d'interroger les serveurs d'OVH directement — la zone y est
consultable avant que l'AFNIC ne l'ait publiée :

```bash
ssh grindrise "dig +short @ns106.ovh.net captain.apps.grindrise.fr A"
```

Depuis une machine sans `dig`, un résolveur public en HTTPS suffit :

```bash
curl -s 'https://dns.google/resolve?name=captain.apps.grindrise.fr&type=A'
```

`"Status":3` signifie NXDOMAIN. Pour savoir si le domaine est enregistré malgré
tout — ce qui distingue une délégation en attente d'une erreur de saisie :

```bash
curl -s https://rdap.nic.fr/domain/grindrise.fr
```

### Pièges rencontrés — serveur et réseau

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

**Fait le 2026-08-19.** Les trois apps tournent.

**L'ordre compte.** Le worker doit consommer la queue avant que l'API n'y dépose
quoi que ce soit : un consommateur en avance sait traiter l'ancien format, un
producteur en avance empile des jobs que personne ne sait lire.

L'API se déploie pourtant en premier, et ce n'est pas une contradiction :
**sans `REDIS_URL`, elle ne produit rien** et le signale au démarrage. C'est
l'ajout de cette variable, en dernier, qui ouvre le robinet.

- [x] **Redis** — Apps → **One-Click Apps/Databases** → Redis, nommée `redis`.
      Noter le mot de passe. Les deux apps l'atteignent par
      `srv-captain--redis:6379` sur le réseau interne.
- [x] **API** — créer l'app, ses variables **sans `REDIS_URL`**, déployer
- [x] **App `notifications`**, sans « Has Persistent Data », avec
      « Do not expose as web-app » cochée
- [x] **Déployer le worker**, vérifier `Worker à l'écoute` dans les logs
- [x] **Seulement ensuite**, `REDIS_URL` sur l'API → Save & Update
- [ ] **Test réel** — depuis l'app mobile, voir l'état en tête de document

### Déployer depuis un sous-dossier du monorepo

`caprover deploy -b main` lancé depuis `~/GrindRise/backend` affiche
*« You are not in a git root directory »* et se rabat sur l'envoi du dossier tel
qu'il est sur le disque — état de travail, pas la branche commitée, et
potentiellement `node_modules`. Le réflexe a d'abord été de contourner par une
archive explicite du sous-arbre :

```bash
# Méthode historique. Marche, mais voir le piège ci-dessous.
git -C ~/GrindRise archive --format=tar.gz -o /tmp/api.tar.gz main:backend
caprover deploy -n grindrise -a api -t /tmp/api.tar.gz
```

**Mieux : laisser CapRover lire le monorepo.** Le champ
`captainDefinitionRelativeFilePath` de l'app (App Configs) accepte un chemin
dans l'arborescence. Réglé à `./backend/captain-definition`, on déploie depuis
la **racine** du monorepo, qui est bien une racine git, donc `-b` fonctionne :

```bash
cd ~/GrindRise
caprover deploy -n grindrise -a api -b main
```

Vérifié le 2026-08-19 sur `api-test` : le build passe et le contexte Docker est
bien `backend/`, pas la racine — le `COPY package.json pnpm-lock.yaml ./` du
Dockerfile prend donc les bons fichiers. Ça se vérifie tout seul : `backend/` a
son propre `pnpm-lock.yaml` (219 Ko) alors que celui de la racine ne contient
que la CLI Supabase (4,7 Ko), et il n'y a pas de `pnpm run build` à la racine —
si le contexte était la racine, le build échouerait bruyamment.

Le CLI affiche au passage *« No captain-definition was found in main
directory »*. C'est un **avertissement attendu**, et il le dit lui-même :
« unless you have specified a special path ». Le déploiement se poursuit.

Trois raisons de préférer cette méthode :

1. **Le commit est enregistré.** Le CLI journalise *« Using last commit on
   "main": 7089505… »* et CapRover garde le `gitHash` sur la version déployée.
   Un déploiement par archive le laisse **vide** — c'est pour ça qu'on ne peut
   pas savoir, après coup, quel code tourne dans l'app `api`, alors qu'on le
   sait pour `notifications`.
2. **Rien à regénérer**, donc rien qui puisse être périmé. Voir le piège
   ci-dessous.
3. Le surcoût est nul : l'archive du monorepo entier fait 294 Ko contre 132 Ko
   pour le seul `backend/`.

Depuis `~/grindrise-notifications`, qui est déjà une racine de dépôt, `-b main`
fonctionne sans réglage particulier.

### Piège — le CLI mémorise la source de déploiement, pas la branche

Le CLI garde dans `~/.config/configstore/caprover.json` (`DeployedDirs`) ce qu'on
lui a donné la dernière fois, **par répertoire courant**. C'est ce que rejoue
`caprover deploy -d`, et c'est aussi la valeur proposée par défaut aux invites.

Deux façons de se faire piéger, les deux silencieuses :

- **Une branche mémorisée.** Après la fusion de `test` dans `main`, l'entrée de
  `~/grindrise-notifications` portait encore `branchToPush: test`. Un
  `caprover deploy -d` aurait redéployé `test` en croyant livrer `main`. Corrigé
  le 2026-08-19, mais à revérifier après chaque changement de branche
  d'intégration.
- **Une archive mémorisée.** Pire : l'entrée de `~/GrindRise/backend` portait un
  `tarFilePath` pointant un fichier `/tmp` d'une session de travail terminée. Le
  fichier existait toujours, figé à son contenu de plusieurs heures plus tôt. Un
  `caprover deploy -d` y serait reparti **sans jamais lire le dépôt**. Ce
  jour-là le contenu était identique à `main:backend` — vérifié par extraction
  et comparaison fichier par fichier — donc sans conséquence ; au premier
  changement dans `backend/`, on aurait livré l'ancien code en croyant livrer
  `main`. Entrée supprimée le 2026-08-19.

D'où la préférence pour `-b <branche>` explicite : une branche ne peut pas être
périmée, une archive sur disque oui. Et régler
`captainDefinitionRelativeFilePath` à `./backend/captain-definition` transforme
en plus le piège restant en **échec de build bruyant** — une archive du seul
sous-arbre `backend` n'a pas de `./backend/captain-definition` à sa racine, donc
elle est refusée au lieu de livrer du code périmé.

**Appliqué sur l'app `api` de production le 2026-08-19.** Son
`captainDefinitionRelativeFilePath` vaut `./backend/captain-definition`, et le
premier déploiement par branche a produit la version `v2` portant
`gitHash=7089505bac77` — la première fois qu'on sait, sans rien extraire, quel
code tourne dans cette app. La méthode historique par archive du sous-arbre
**échoue désormais**, et c'est l'effet recherché.

Où se trouve le champ, parce qu'il n'est pas là où on le cherche : app → onglet
**Déploiement** (pas *Configurations de l'App*), **tout en bas**, sous
*« Method 6: Deploy via ImageName »*. Le champ est préfixé « chemin de
captain-definition » et **grisé** ; il faut cliquer **« Éditer »** à côté pour le
déverrouiller, puis **« Enregistrer & Redémarrer »**.

Ce bouton porte bien son nom : **il recrée le container**. Le réglage lui-même
n'est lu qu'au build, mais l'enregistrer relance l'app — quelques secondes
d'interruption. Sans gravité pour une API sans état, à condition de le savoir.

### Pièges rencontrés — apps CapRover

**Redis ne s'installe pas par « Create New App ».** Une app ainsi créée tourne
l'image `caprover/caprover-placeholder-app` — la page d'attente de CapRover — et
aucun serveur Redis n'existe derrière. Il faut le catalogue **One-Click
Apps/Databases**, qui déploie la vraie image et génère le mot de passe. Le
symptôme est trompeur : le worker démarre, échoue à se connecter, et rien ne dit
que Redis n'existe pas.

**`REDIS_URL` a produit trois pannes différentes pour un même symptôme.** Le log
`ECONNREFUSED 127.0.0.1:6379` signifie seulement qu'ioredis n'a pas su lire
l'adresse et s'est rabattu sur son défaut. Causes rencontrées, dans l'ordre :
la valeur locale du `.env` recopiée telle quelle ; Redis inexistant ; et surtout
un **mot de passe contenant `#`**, qui ouvre un fragment d'URL et rend l'adresse
illisible. D'où la règle : **générer le mot de passe Redis en alphanumérique
pur** (`openssl rand -hex 24`), plutôt qu'encoder des caractères spéciaux.

**Le port du container n'est pas celui qu'on croit.** CapRover proxie vers le
port **80** par défaut ; l'API écoute sur **3000**. Sans `Container HTTP Port`
réglé à `3000` dans App Configs, on obtient une 502 sans explication.

**Activer « Force HTTPS ».** Une app exposée répond en HTTP clair tant que la
case n'est pas cochée. Pour l'API, cela signifie l'en-tête
`Authorization: Bearer <jeton de session>` en clair sur le réseau.

**Des erreurs au démarrage sont normales.** Quand Redis et un consommateur
redémarrent ensemble, l'alias `srv-captain--redis` n'est pas immédiatement
résolvable et le worker journalise quelques `ENOTFOUND` avant de se connecter.
Elles tiennent dans la première seconde ; ce qui compte est qu'elles cessent.

### Vérifier sans se fier aux logs

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

### Variables de l'app `api`

D'après `backend/src/config/env.config.ts`, et non `.env.example` qui en liste
davantage. Requises — l'API crashe au boot si l'une manque :

| Variable | Note |
|---|---|
| `SUPABASE_URL` | URL nue, sans `/rest/v1` ni aucun suffixe de chemin |
| `SUPABASE_SERVICE_ROLE_KEY` | contourne la RLS, à traiter comme un mot de passe root |

Optionnelles :

| Variable | Défaut | Rôle |
|---|---|---|
| `REDIS_URL` | aucune | **à ajouter en dernier.** Absente, l'API ne produit rien et le signale au démarrage |
| `PORT` | `3000` | inutile de la déclarer |
| `NOTIFICATIONS_QUEUE_NAME` | `notifications` | seulement si le nom a changé côté worker |
| `REVENUECAT_WEBHOOK_SECRET` | aucune | seulement quand le webhook sera branché |

`REDIS_URL` est volontairement optionnelle côté API, contrairement à la règle du
crash au boot : l'imposer rendrait Redis obligatoire pour tout développement
local du backend.

Deux réglages hors variables, dans App Configs :

| Réglage | Valeur |
|---|---|
| Container HTTP Port | **`3000`** — sinon 502 |
| HTTP Settings | HTTPS sur `api.apps.grindrise.fr` + **Force HTTPS** |

---

## Corrigé : le blocage de `POST /workouts`

**Corrigé le 2026-08-19** par le commit `dd36349` du monorepo. Conservé ici
parce que le raisonnement resservira à chaque fois qu'un appel réseau entrera
dans le chemin d'une requête.

**Une `REDIS_URL` erronée figeait `POST /workouts`.** Mesuré le 2026-08-17, avec
les options exactes de `notifications.queue.ts` :

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
garde autour du `add`, l'appel étant best-effort de toute façon. Borner les
tentatives de connexion d'ioredis aurait été pire — la queue serait restée morte
après le retour de Redis.

La leçon générale : **un `try/catch` protège d'une erreur, pas d'une attente.**
Tout appel réseau placé dans le chemin d'une requête HTTP a besoin d'un délai de
garde explicite, faute de quoi la panne se manifeste par un silence plutôt que
par une exception.

---

## Ce qui reste en dette

Rien de bloquant pour un premier déploiement, mais à connaître.

- **Aucune intégration continue.** L'invariant central de l'architecture — les
  deux fichiers `contract.ts` identiques octet pour octet entre les deux dépôts —
  ne tient aujourd'hui que sur `pnpm run check:contract`, à lancer à la main. À
  automatiser avant de brancher le déploiement automatique sur push. Le script
  suppose le monorepo en `~/GrindRise` ; ailleurs, lui passer le chemin en
  argument ou par `GRINDRISE_API_PATH`.
- **L'URL de l'API n'est fournie à aucun build mobile.** `EXPO_PUBLIC_API_URL`
  est **inlinée dans le bundle au moment du build**, pas lue au démarrage :
  la changer n'a d'effet qu'après reconstruction. Elle ne vit aujourd'hui que
  dans le `.env` local, et **il n'existe pas de `eas.json`** — un build EAS
  produirait donc une app sans URL d'API, où `isApiConfigured` vaut `false` et
  toute écriture de jeu échoue en silence. À traiter avant le premier build de
  production.
- **Aucune boîte derrière `notifications@grindrise.fr`.** L'expédition n'en a
  pas besoin, mais un joueur qui écrirait à cette adresse n'atteindrait
  personne. `BREVO_REPLY_TO` couvre les réponses ; une redirection OVH gratuite
  rendrait l'adresse réellement joignable.
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
