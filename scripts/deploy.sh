#!/bin/sh
# Pull the published images for IMAGE_TAG (default main) and start the production stack.
set -eu
cd "$(dirname "$0")/.."
# Read only the registry login from .env; Compose loads .env itself, so shell variables such as IMAGE_TAG keep precedence.
token=${GHCR_TOKEN:-$(sed -n 's/^GHCR_TOKEN=//p' .env)}
echo "${token:?set GHCR_TOKEN in .env}" | docker login ghcr.io -u "${GHCR_USER:-silverbucket}" --password-stdin
docker compose -f compose.prod.yml pull
docker compose -f compose.prod.yml up -d --build --wait --remove-orphans
