#!/usr/bin/env bash
# Upload the simulator to the server from your own machine.
# Usage: DEPLOY_HOST=1.2.3.4 [DEPLOY_USER=root] [DEPLOY_PATH=/var/www/cx3] [DEPLOY_PORT=22] deploy/deploy.sh
set -euo pipefail
: "${DEPLOY_HOST:?set DEPLOY_HOST to the server IP or hostname}"
DEPLOY_USER="${DEPLOY_USER:-root}"
DEPLOY_PATH="${DEPLOY_PATH:-/var/www/cx3}"
DEPLOY_PORT="${DEPLOY_PORT:-22}"

cd "$(dirname "$0")/.."
rsync -avz --delete -e "ssh -p $DEPLOY_PORT" \
  index.html manifest.webmanifest css js img "$DEPLOY_USER@$DEPLOY_HOST:$DEPLOY_PATH/"
echo "Deployed to http://$DEPLOY_HOST/"
