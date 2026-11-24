#!/usr/bin/env bash
# Runs the Playwright end-to-end suite against the Compose stack.
#
#   scripts/e2e.sh [--reset] [--docker] [playwright args]
#
# By default Playwright runs on the host (needs `npx playwright install chromium`
# and, on Ubuntu, `sudo apt-get install libnss3 libnspr4 libasound2t64`).
# --docker runs it in the official Playwright image instead (large download).
set -euo pipefail
cd "$(dirname "$0")/.."

RESET="" USE_DOCKER=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --reset) RESET=1; shift ;;
    --docker) USE_DOCKER=1; shift ;;
    *) break ;;
  esac
done

docker compose up -d --build db backend frontend
echo "Waiting for the API and the frontend..."
for _ in $(seq 1 60); do
  if curl -sf localhost:8000/api/v1/health >/dev/null && curl -sf localhost:5173 >/dev/null; then break; fi
  sleep 2
done

if [[ -n "$RESET" ]]; then
  docker compose exec -T backend python -m app.cli reset
fi

if [[ ! -d frontend/node_modules/@playwright/test ]]; then
  (cd frontend && npm install)
fi

if [[ -n "$USE_DOCKER" ]]; then
  docker compose --profile e2e run --rm e2e npx playwright test "$@"
else
  (cd frontend && npx playwright install chromium >/dev/null && E2E_BASE_URL=http://localhost:5173 npx playwright test "$@")
fi
