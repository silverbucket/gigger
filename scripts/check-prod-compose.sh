#!/bin/sh
# Validate production Compose renders and passes translator env through to the API.
set -eu
cd "$(dirname "$0")/.."
docker compose config --quiet
DOMAIN=example.com APP_ORIGIN=https://example.com docker compose -f compose.prod.yml config --quiet
DOMAIN=example.com APP_ORIGIN=https://example.com docker compose -f compose.prod.yml config --format json \
  | jq -e '
    .services.api.environment as $env
    | if ($env | type) == "object" then ($env | has("LIBRETRANSLATE_URL"))
      elif ($env | type) == "array" then any($env[]; test("^LIBRETRANSLATE_URL="))
      else false end
  ' >/dev/null
