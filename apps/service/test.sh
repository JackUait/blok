#!/usr/bin/env sh
# Lance la suite du service dans un conteneur Go, sans toolchain locale.
# Avec PostgreSQL, les tests d'intégration tournent ; sans, ils se sautent.
#
#   ./test.sh                      toute la suite
#   ./test.sh -run TestResolve     un sous-ensemble
#
# Un PostgreSQL jetable :
#   docker run -d --name blok-test-pg -e POSTGRES_PASSWORD=password \
#     -e POSTGRES_DB=blok_test -p 55432:5432 postgres:17-alpine
set -eu
root=$(cd "$(dirname "$0")/../.." && pwd)
version=$(sed -n 's/^go \([0-9.]*\)$/\1/p' "$root/apps/service/go.mod")
exec docker run --rm --network host \
  -v "$root":/src \
  -v blok-go-mod:/go/pkg/mod \
  -v blok-go-build:/root/.cache/go-build \
  -w /src/apps/service \
  -e TEST_DATABASE_URL="${TEST_DATABASE_URL:-postgres://postgres:password@127.0.0.1:55432/blok_test?sslmode=disable}" \
  "golang:${version%.*}" go test "$@" .
