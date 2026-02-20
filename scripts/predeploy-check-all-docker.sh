#!/usr/bin/env sh
set -eu

cleanup() {
  docker compose -f docker-compose.yml -f docker-compose.e2e.yml down -v >/dev/null 2>&1 || true
}

trap cleanup EXIT INT TERM

docker run --rm \
  --user "$(id -u):$(id -g)" \
  -e HOME=/tmp/home \
  -e NPM_CONFIG_CACHE=/tmp/npm-cache \
  -v "$PWD:/work" \
  -v home_calendar_node_modules:/work/node_modules \
  -w /work \
  node:20-bookworm \
  sh -lc "npm ci && npm run lint && npm test -- --no-coverage --runInBand"

HOST_UID="$(id -u)" HOST_GID="$(id -g)" docker compose -f docker-compose.yml -f docker-compose.e2e.yml up --build --abort-on-container-exit --exit-code-from e2e e2e
