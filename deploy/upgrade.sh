#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
./backup.sh
# Build failure leaves the old service running. Build before replacement.
./stack.sh build --pull
./stack.sh up -d --wait --wait-timeout 180
