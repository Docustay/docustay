#!/bin/sh
# Creates .env with fresh random secrets (once). Safe to re-run: it never overwrites an existing .env.
set -eu
cd "$(dirname "$0")"
if [ -f .env ]; then echo ".env already exists — leaving it alone."; exit 0; fi
rnd() { if command -v openssl >/dev/null 2>&1; then openssl rand -hex "$1"; else head -c "$1" /dev/urandom | od -An -tx1 | tr -d ' \n'; fi; }
cp .env.example .env
set_var() { tmp=$(mktemp); awk -v k="$1" -v v="$2" 'BEGIN{FS=OFS="="} $1==k{print k"="v; next} {print}' .env > "$tmp" && cat "$tmp" > .env && rm -f "$tmp"; }
set_var KEYSTONE_DB_PASSWORD "$(rnd 24)"
set_var KEYSTONE_S3_ACCESS_KEY_ID "dsk$(rnd 8)"
set_var KEYSTONE_S3_SECRET_ACCESS_KEY "$(rnd 24)"
set_var KEYSTONE_TOKEN_PEPPER "$(rnd 24)"
set_var KEYSTONE_LOCAL_AUTH_SECRET "$(rnd 24)"
TOKEN="$(rnd 12)"
set_var KEYSTONE_SETUP_TOKEN "$TOKEN"
chmod 600 .env
echo "Created .env with new secrets."
echo "Setup token (you will need it once, at /setup): $TOKEN"
echo "Next:  docker compose up -d   then open http://localhost:8080/setup"
