#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
if [[ ! -f .env ]]; then
  umask 077
  cp .env.example .env
  for key in POSTGRES_PASSWORD TICKET_SECRET INTERNAL_SECRET; do
    value=$(openssl rand -hex 32)
    # Values are hex; no shell or sed metacharacters.
    sed "s/^${key}=.*/${key}=${value}/" .env > .env.new
    mv .env.new .env
  done
  echo 'Created deploy/.env with generated secrets. Set BOOTSTRAP_ADMIN_EMAIL, MAIL_FROM and RESEND_API_KEY, then run install.sh again.'
  exit 0
fi
./stack.sh config --quiet
./stack.sh build --pull
./stack.sh up -d --wait --wait-timeout 180
./stack.sh ps
