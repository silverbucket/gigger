#!/bin/sh
# Pull the published images for IMAGE_TAG (default main) and start the production stack.
set -eu
cd "$(dirname "$0")/.."
set -a; . ./.env; set +a
echo "${GHCR_TOKEN:?set GHCR_TOKEN in .env}" | docker login ghcr.io -u "${GHCR_USER:-silverbucket}" --password-stdin
docker compose -f compose.prod.yml pull
docker compose -f compose.prod.yml up -d --build --wait --remove-orphans
