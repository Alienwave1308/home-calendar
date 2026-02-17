#!/usr/bin/env sh
set -eu

cleanup() {
  docker compose -f docker-compose.yml -f docker-compose.e2e.yml down -v >/dev/null 2>&1 || true
}

trap cleanup EXIT INT TERM

npm run lint
npm test -- --no-coverage --runInBand
docker compose -f docker-compose.yml -f docker-compose.e2e.yml up --build --abort-on-container-exit --exit-code-from e2e e2e
