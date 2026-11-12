#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
if [[ ! -f .env.demo ]]; then
  umask 077
  for key in POSTGRES_PASSWORD TICKET_SECRET INTERNAL_SECRET; do
    printf '%s=%s\n' "$key" "$(openssl rand -hex 32)"
  done > .env.demo
fi
compose() { docker compose --env-file .env.demo -f compose.demo.yaml "$@"; }
seed() {
  compose exec -T app mkdir -p /data/mail
  compose run --rm --no-deps seed
  compose exec -T app touch /data/.demo-seeded
}
action="${1:-start}"
[[ $# == 0 ]] || shift
case "$action" in
  start)
    compose build
    compose up -d --wait --wait-timeout 180
    if ! compose exec -T app test -f /data/.demo-seeded; then seed; fi
    printf '%s\n' 'Blok: http://localhost:8088' 'E-mails de démonstration: http://localhost:8089' 'Admin: admin@example.test' 'Membre ajouté: membre@example.test' 'Demande d’accès: demandeur@example.test'
    ;;
  seed) seed ;;
  stop) compose stop ;;
  status) compose ps ;;
  logs) compose logs --tail 100 "$@" ;;
  compose) compose "$@" ;;
  *) echo 'Usage: demo.sh [start|stop|status|seed|logs|compose ...]' >&2; exit 1 ;;
esac
