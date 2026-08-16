# Build multi-stage : l'image finale ne contient ni sources TS, ni devDependencies.

# --- Étape 1 : compilation TypeScript ---------------------------------------
FROM node:22-alpine AS builder
WORKDIR /app

ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm run build

# --- Étape 2 : dépendances de production uniquement -------------------------
FROM node:22-alpine AS deps
WORKDIR /app

ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --prod && pnpm store prune

# --- Étape 3 : image d'exécution --------------------------------------------
FROM node:22-alpine AS runner
WORKDIR /app

# tini comme PID 1 : sans lui, Node ignore SIGTERM et CapRover tue le container
# de force à chaque redéploiement, coupant un envoi en cours.
RUN apk add --no-cache tini

ENV NODE_ENV=production
ENV PORT=3001

COPY --from=deps /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY package.json ./

USER node

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3001)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/main.js"]
