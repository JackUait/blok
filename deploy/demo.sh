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
# Une clé Resend dans .env.demo fait basculer la démo sur un vrai envoi : le
# répertoire de mail de développement doit alors être vide, sinon il est choisi
# en premier et aucun message ne part (mail.go, ordre de sélection).
if grep -qE '^RESEND_API_KEY=.+' .env.demo 2>/dev/null; then
  export DEV_MAIL_DIRECTORY=
  mail_backend='resend (envoi réel)'
else
  mail_backend='development (boîte locale sur :8089)'
fi
seed() {
  compose exec -T app mkdir -p /data/mail
  compose run --rm --no-deps seed
  compose exec -T app touch /data/.demo-seeded
}
action="${1:-start}"
[[ $# == 0 ]] || shift
setup_mode=0
[[ "${1:-}" == "--setup" ]] && { setup_mode=1; shift; }
case "$action" in
  start)
    compose build
    if [[ $setup_mode == 1 ]]; then
      # Instance vierge : pas d'amorçage par variable, donc l'assistant de
      # premier démarrage prend la main.
      BOOTSTRAP_ADMIN_EMAIL= BOOTSTRAP_WORKSPACE_SLUG= BOOTSTRAP_WORKSPACE_NAME= \
        compose up -d --wait --wait-timeout 180
      printf '%s\n' 'Blok: http://localhost:8088' "Backend mail : $mail_backend" \
        'Premier démarrage : ouvrez l’adresse, l’assistant prend la main.'
      exit 0
    fi
    compose up -d --wait --wait-timeout 180
    if [[ -z "${DEV_MAIL_DIRECTORY-unset}" ]]; then
      # Le semis lit les codes dans le répertoire de mail ; sans lui, les
      # comptes de démonstration ne peuvent pas être créés.
      printf '%s\n' 'Blok: http://localhost:8088' "Backend mail : $mail_backend" \
        'Comptes de démonstration non semés : ils naissent des codes lus dans la boîte locale.'
      exit 0
    fi
    if ! compose exec -T app test -f /data/.demo-seeded; then seed; fi
    printf '%s\n' 'Blok: http://localhost:8088' "Backend mail : $mail_backend" 'E-mails: http://localhost:8089' 'Admin: admin@example.test' 'Membre ajouté: membre@example.test' 'Demande d’accès: demandeur@example.test'
    ;;
  seed) seed ;;
  stop) compose stop ;;
  status) compose ps ;;
  logs) compose logs --tail 100 "$@" ;;
  compose) compose "$@" ;;
  *) echo 'Usage: demo.sh [start|stop|status|seed|logs|compose ...]' >&2; exit 1 ;;
esac
