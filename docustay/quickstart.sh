#!/bin/sh
# One command to a running Docustay: creates .env with fresh secrets (once), starts the containers and waits until the app answers.
#   sh quickstart.sh
# Needs Docker with the compose plugin. Safe to re-run.
set -eu
cd "$(dirname "$0")"
command -v docker >/dev/null 2>&1 || { echo "Docker is not installed. Install Docker, then run this again."; exit 1; }
docker compose version >/dev/null 2>&1 || { echo "Docker is installed but the compose plugin is missing. Install it (docker compose), then run this again."; exit 1; }
sh ./init.sh
docker compose up -d --build
PORT="$(awk -F= '$1=="DOCUSTAY_PORT"{print $2}' .env 2>/dev/null || true)"; PORT="${PORT:-8080}"
printf "Waiting for Docustay on port %s " "$PORT"
i=0
until curl -fsS "http://localhost:$PORT/" >/dev/null 2>&1; do
  i=$((i + 1)); if [ "$i" -gt 90 ]; then echo; echo "It is taking longer than expected. Check:  docker compose ps   and   docker compose logs --tail 50"; exit 1; fi
  printf "."; sleep 2
done
echo
TOKEN="$(awk -F= '$1=="KEYSTONE_SETUP_TOKEN"{print $2}' .env)"
echo "Docustay is running: http://localhost:$PORT/setup"
echo "Setup token (needed once, at /setup): $TOKEN"
