#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
umask 077
backup_dir="${1:-backups/$(date -u +%Y%m%dT%H%M%SZ)}"
mkdir -p "$backup_dir"
backup_dir=$(cd "$backup_dir" && pwd)
[[ ! -f "$backup_dir/complete" ]] || { echo 'Backup destination already complete' >&2; exit 1; }
# Keep the API alive while Blok drains; the app owns orderly shutdown.
./stack.sh stop app
trap './stack.sh start app >/dev/null' EXIT
app_container=$(./stack.sh ps -aq app)
[[ -n "$app_container" ]] || { echo 'App container missing; refusing incomplete backup' >&2; exit 1; }
app_exit=$(docker inspect --format '{{.State.ExitCode}}' "$app_container")
[[ "$app_exit" == 0 ]] || { echo 'App did not drain cleanly; inspect logs before backing up' >&2; exit 1; }
./stack.sh exec -T postgres pg_dump -U blok -d blok -Fc > "$backup_dir/database.dump"
./stack.sh run --rm --no-deps -T --entrypoint tar app -C /data -czf - . > "$backup_dir/state.tar.gz"
git -C .. rev-parse HEAD > "$backup_dir/source-commit"
./stack.sh ps -aq | while IFS= read -r container; do
  docker inspect --format '{"name":{{json .Name}},"image":{{json .Config.Image}},"id":{{json .Image}}}' "$container"
done > "$backup_dir/images.jsonl"
printf '%s\n' 'Restore requires the deployment .env secrets kept separately.' > "$backup_dir/README.txt"
touch "$backup_dir/complete"
echo "Backup completed: $backup_dir"
