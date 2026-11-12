#!/usr/bin/env bash
# Restores to an EMPTY installation only. Never overwrites an existing database.
set -euo pipefail
[[ $# == 1 ]] || { echo 'Usage: restore.sh /absolute/path/to/backup' >&2; exit 1; }
backup_dir=$(cd "$1" && pwd)
[[ -f "$backup_dir/complete" ]] || { echo 'Incomplete backup' >&2; exit 1; }
cd "$(dirname "$0")"
./stack.sh config --quiet
./stack.sh stop app web
./stack.sh up -d --wait postgres
count=$(./stack.sh exec -T postgres psql -U blok -d blok -Atc "SELECT count(*) FROM information_schema.tables WHERE table_schema='public'")
[[ "$count" == 0 ]] || { echo 'Destination database is not empty; refusing restore' >&2; exit 1; }
./stack.sh run --rm --no-deps -T --entrypoint sh app -c 'test -z "$(ls -A /data)"' || { echo 'Destination state volume is not empty; refusing restore' >&2; exit 1; }
./stack.sh exec -T postgres pg_restore -U blok -d blok --exit-on-error < "$backup_dir/database.dump"
./stack.sh run --rm --no-deps -T --entrypoint tar app -C /data -xzf - < "$backup_dir/state.tar.gz"
./stack.sh up -d --wait --wait-timeout 180
