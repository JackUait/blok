# Design: Migrate to size-limit for Bundle Size Tracking

## Overview

Replace ~600 lines of custom bundle tracking scripts with size-limit, a standard tool used by Material-UI, MobX, and PostCSS. Track three tiers (minimum/normal/maximum) by measuring source entry points. Store size history in a committed JSON file (git provides trend tracking).

## What Gets Deleted

### Scripts (5 files, ~600 lines)

- `scripts/track-bundle-size.mjs`
- `scripts/view-bundle-trends.mjs`
- `scripts/build-bundle-variants.mjs`
- `scripts/lib/bundle-utils.mjs`
- `scripts/verify-package/checks/bundle-size.mjs` (the bundle size check portion)

### Workflows

- `.github/workflows/bundle-size-check.yml` (entire file)
- `track-bundle-size` job in `.github/workflows/ci.yml`

### Artifacts/generated files

- `.bundle-size-history.json`
- `.bundle-variants.json`

### Package.json scripts

- `bundle:track`
- `bundle:variants`
- `bundle:trends`
- `bundle:history`

## What Gets Added

### Dependencies

- `@size-limit/preset-small-lib` - the preset for libraries (includes size-limit core + bundler)

### Configuration in package.json

```json
{
  "size-limit": [
    {
      "name": "Minimum (core only)",
      "path": "src/variants/blok-minimum.ts",
      "limit": "40 KB"
    },
    {
      "name": "Normal (with tools)",
      "path": "src/blok.ts",
      "limit": "55 KB"
    },
    {
      "name": "Maximum (all locales)",
      "path": "src/variants/blok-maximum.ts",
      "limit": "120 KB"
    }
  ],
  "scripts": {
    "size": "size-limit",
    "size:why": "size-limit --why"
  }
}
```

Note: The KB limits are estimates - measure real values before setting them.

### New workflow (`.github/workflows/size-limit.yml`)

```yaml
name: Size Limit

on:
  pull_request:
    branches: [master]
    paths:
      - 'src/**'
      - 'package.json'
      - 'yarn.lock'

permissions:
  contents: read
  pull-requests: write

jobs:
  size:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: ./.github/actions/setup-node-deps
      - uses: andresz1/size-limit-action@v1
        with:
          github_token: ${{ secrets.GITHUB_TOKEN }}
```

### History tracking

- `.size-limit.json` - committed file with current sizes (updated manually or via CI when limits change)

## Summary

### Before

- 5 custom scripts (~600 lines)
- 2 workflow files handling bundle size
- Artifact-based history (90-day retention)
- Manual comparison logic with chunk grouping

### After

- 1 devDependency (`@size-limit/preset-small-lib`)
- ~15 lines of config in package.json
- 1 simple workflow file (~20 lines)
- Git-based history (committed `.size-limit.json`)

### Trade-offs

**Lose:**
- Custom variant builds (size-limit bundles differently than Vite)
- Detailed chunk-by-chunk breakdown in reports

**Gain:**
- Industry-standard tool, less maintenance burden
- "Time to execute" metric option if needed later
- `--why` flag for debugging size increases
