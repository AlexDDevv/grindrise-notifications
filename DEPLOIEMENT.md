# Déploiement du service de notifications

Checklist de reprise, écrite le 2026-08-16. Le code est terminé et revu des deux
côtés ; ce qui reste demande un compte Brevo, des identifiants GitHub et un accès
à CapRover.

Ce document se lit sans rien avoir en tête : il rappelle où en est le chantier
avant de dire quoi faire.

---

## Où en est le chantier

Deux dépôts sont concernés.

| Dépôt | Chemin local | Branche | État |
|---|---|---|---|
| Service de notifications | `~/grindrise-notifications` | `main` | 14 commits, 48 tests verts, **jamais poussé** |
| Monorepo Grindrise | `~/GrindRise` | `test` | 4 commits ajoutés, 90 tests verts |

**Ce qui fonctionne déjà**, vérifié et non supposé :

- le service consomme une queue BullMQ et envoie par l'API Brevo, derrière une
  interface `EmailProvider` qui rend un changement de fournisseur trivial ;
- l'image Docker se construit (60 Mo, sans aucun secret dedans — vérifié en
  inspectant l'image) ;
- l'API NestJS produit un job quand un joueur franchit un niveau, en best-effort :
  Redis en panne n'a aucun effet sur `POST /workouts` ;
- `/health` répond 503 si Redis n'est pas joignable, donc un mot de passe Redis
  mal recopié se voit immédiatement au lieu de passer inaperçu.

**Ce qui n'a jamais été fait** : aucun email réel n'a été envoyé, le service n'a
jamais été poussé sur GitHub ni déployé.

---

## 1. Créer le compte Brevo

- [ ] Créer le compte sur [brevo.com](https://www.brevo.com)
- [ ] **Senders & IP → Senders → Add a sender** : renseigner une adresse
      personnelle, puis cliquer le lien de validation reçu par email
- [ ] **SMTP & API → API Keys → Generate a new API key**, copier la valeur —
      elle n'est affichée qu'une seule fois

Le plan gratuit plafonne à 300 emails/jour, largement suffisant. Il n'y a pas
d'expéditeur par défaut chez Brevo : sans domaine authentifié, les emails
partiront de l'adresse validée ci-dessus. Ils arriveront, mais une partie tombera
en indésirables tant qu'il n'y a ni SPF ni DKIM.

Le jour où un domaine authentifié existe, **seule la variable
`BREVO_SENDER_EMAIL` change** — aucun code à toucher : l'identité de l'expéditeur
n'apparaît nulle part ailleurs.

---

## 2. Pousser le service sur GitHub

Le dépôt distant existe et il est vide. Rien n'a encore été poussé, faute
d'identifiants GitHub sur la machine de développement.

```bash
cd ~/grindrise-notifications
git remote add origin https://github.com/AlexDDevv/grindrise-notifications.git
git push -u origin main
```

---

## 3. Valider la chaîne en local

Cette étape est la seule qui prouve que tout fonctionne bout en bout. Elle est
décrite en détail dans le plan (tâche 8) et n'a pas encore été faite : il manque
le script d'injection de job et une vraie clé Brevo.

- [ ] Renseigner `.env` à partir de `.env.example` (clé Brevo + adresse validée)
- [ ] `pnpm run redis:up` — Redis local via Docker
- [ ] `pnpm run dev` dans un terminal
- [ ] Pousser un job de test et vérifier la réception de l'email

Prérequis : l'intégration WSL doit être active dans les paramètres de Docker
Desktop, sinon `docker` reste introuvable dans la distribution.

---

## 4. Déployer sur CapRover

**L'ordre compte.** Le worker se déploie toujours avant l'API : un consommateur en
avance sait traiter l'ancien format, un producteur en avance empile des jobs que
personne ne sait lire.

- [ ] **Redis** — Apps → One-Click Apps → Redis, nommée `redis`. Noter le mot de
      passe généré, ne pas exposer publiquement. Les deux apps l'atteignent par
      `srv-captain--redis:6379` sur le réseau interne.
- [ ] **Créer l'app** — Create New App, nommée `notifications`, **sans** cocher
      « Has Persistent Data »
- [ ] **Variables** — App Configs, tableau ci-dessous, puis Save & Update
- [ ] **Cocher « Do not expose as web-app »** — ce service ne publie rien sur
      internet
- [ ] **Déployer** — `caprover deploy` depuis `~/grindrise-notifications`, en
      choisissant l'app `notifications`
- [ ] **Vérifier les logs** — le worker doit annoncer `Worker à l'écoute`
- [ ] **Seulement ensuite**, ajouter `REDIS_URL` sur l'app de l'API existante →
      Save & Update (l'API redémarre)
- [ ] **Test réel** — enregistrer une séance qui fait franchir un niveau, et
      vérifier la réception de l'email

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

## Ce qui reste en dette

Rien de bloquant pour un premier déploiement, mais à connaître.

- **Aucune intégration continue.** L'invariant central de l'architecture — les
  deux fichiers `contract.ts` identiques octet pour octet entre les deux dépôts —
  ne tient aujourd'hui que sur `pnpm run check:contract`, à lancer à la main. À
  automatiser avant de brancher le déploiement automatique sur push.
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
Settings. Le compte Brevo créé à l'étape 1 peut servir aux deux — c'est un sujet
séparé, à traiter quand le flux d'authentification sera stabilisé.

---

## Pour reprendre avec Claude

Le journal complet du chantier — chaque tâche, chaque revue, chaque constat
différé avec son arbitrage — est dans le monorepo, en
`.superpowers/sdd/2026-08-16-notifications-microservice/progress.md`. Il n'est pas
versionné (`.superpowers/` est ignoré par git), il ne vit donc que sur la machine
où le travail a été fait.

La spécification et le plan d'implémentation sont dans `docs/superpowers/` du
monorepo, également non versionnés.
