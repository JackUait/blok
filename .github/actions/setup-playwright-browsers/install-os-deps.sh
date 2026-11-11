#!/bin/bash
# Installs Playwright's apt OS deps for the given browsers.
# `playwright install-deps` always runs `apt-get update` first. When the
# mirror's DNS fails, each index waits about 20s, which adds minutes. So try
# the image's package lists plus the seeded .debs first, and fall back to the
# full install-deps (with update) when that is not enough.
# Usage: install-os-deps.sh <browser>...
# Keep it bash 3.2 safe: the unit test runs it on macOS.
set -uo pipefail

full_install() {
  echo "Falling back to the full playwright install-deps (runs apt-get update)"
  exec npx playwright install-deps "$@"
}

# The dry run simulates `apt-get install -s` with the current lists and exits
# non-zero when it would install anything, or when a package is unknown.
if out="$(npx playwright install-deps --dry-run "$@" 2>&1)"; then
  echo "$out"
  exit 0
fi
echo "$out"

# Playwright lists each missing package as "  <name>".
missing=()
while IFS= read -r name; do
  missing+=("$name")
done < <(sed -n 's/^  \([a-z0-9][a-z0-9.+:~-]*\)$/\1/p' <<<"$out")

if (( ${#missing[@]} == 0 )); then
  full_install "$@"
fi

# Never wrap this in `timeout`: killing dpkg mid-install leaves its lock held.
if ! sudo apt-get install -y --no-install-recommends "${missing[@]}"; then
  full_install "$@"
fi

if ! npx playwright install-deps --dry-run "$@"; then
  full_install "$@"
fi
