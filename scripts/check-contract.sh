#!/usr/bin/env bash
set -euo pipefail

# Vérifie que le contrat de la queue de notifications (src/queue/contract.ts)
# reste identique, octet pour octet, à sa copie dans le monorepo GrindRise
# (backend/src/modules/notifications/contract.ts). C'est la seule frontière
# entre les deux services déployés séparément ; sans ce script, rien ne
# protège cet invariant à part un commentaire dans le fichier lui-même.
#
# Usage :
#   pnpm run check:contract
#   ./scripts/check-contract.sh [chemin-du-monorepo-GrindRise]
#   GRINDRISE_API_PATH=/autre/chemin ./scripts/check-contract.sh
#
# Codes de sortie :
#   0 = les deux fichiers sont identiques
#   1 = les deux fichiers ont divergé
#   2 = le dépôt GrindRise (ou le contrat qu'il contient) est introuvable
#   3 = le contrat local (dans ce dépôt) est introuvable

WORKER_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOCAL_CONTRACT="$WORKER_ROOT/src/queue/contract.ts"

API_PATH="${1:-${GRINDRISE_API_PATH:-/home/alexis/GrindRise}}"
REMOTE_CONTRACT="$API_PATH/backend/src/modules/notifications/contract.ts"

if [ ! -f "$LOCAL_CONTRACT" ]; then
  echo "Erreur : contrat local introuvable ($LOCAL_CONTRACT)." >&2
  exit 3
fi

if [ ! -d "$API_PATH" ]; then
  echo "Dépôt GrindRise introuvable à \"$API_PATH\"." >&2
  echo "Indiquez le bon chemin en argument (./scripts/check-contract.sh /chemin/vers/GrindRise)" >&2
  echo "ou via la variable GRINDRISE_API_PATH. Si ce dépôt n'est simplement pas cloné sur cette" >&2
  echo "machine, cette vérification ne peut pas s'exécuter ici." >&2
  exit 2
fi

if [ ! -f "$REMOTE_CONTRACT" ]; then
  echo "Erreur : contrat introuvable côté API ($REMOTE_CONTRACT)." >&2
  exit 2
fi

if ! DIFF_OUTPUT="$(diff -u "$LOCAL_CONTRACT" "$REMOTE_CONTRACT")"; then
  echo "Erreur : les deux fichiers contract.ts ont divergé." >&2
  echo "  worker (ce dépôt) : $LOCAL_CONTRACT" >&2
  echo "  api (monorepo)    : $REMOTE_CONTRACT" >&2
  echo >&2
  echo "$DIFF_OUTPUT" >&2
  echo >&2
  echo "Corrigez le fichier d'un seul côté, puis copiez-le vers l'autre plutôt que de" >&2
  echo "réécrire les deux séparément :" >&2
  echo "  cp \"$LOCAL_CONTRACT\" \"$REMOTE_CONTRACT\"" >&2
  exit 1
fi

echo "OK : les deux contract.ts sont identiques ($LOCAL_CONTRACT)."
exit 0
