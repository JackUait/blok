# Publishing Guide

## Overview

Blok uses **semantic-release** for automated version management and npm publishing. Releases are triggered **manually** via GitHub Actions.

## How to Release

### Via GitHub UI

1. Go to **Actions** tab
2. Click **"Release"** workflow
3. Click **"Run workflow"**
4. Select branch: `master` (stable), `beta`, or `alpha`
5. Optionally enable **"Dry run"** to preview without publishing
6. Click **"Run workflow"**

### Via GitHub CLI

```bash
# Release from current branch
gh workflow run release.yml

# Release from specific branch
gh workflow run release.yml --ref beta

# Preview without publishing
gh workflow run release.yml --ref beta -f dry_run=true
```

## Commit Message Format

semantic-release determines the version bump from your commit messages.

**Format:** `<type>(<scope>): <subject>`

### Release Types

| Commit Type | Version Bump | Example |
|-------------|--------------|---------|
| `feat` | Minor (0.x.0) | `feat: add undo/redo` |
| `fix` | Patch (0.0.x) | `fix: memory leak` |
| `perf` | Patch (0.0.x) | `perf: optimize rendering` |
| `BREAKING CHANGE` | Major (x.0.0) | See below |

### Breaking Changes

```bash
git commit -m "feat: redesign API

BREAKING CHANGE: config.tools now requires explicit type definitions"
```

### Non-Release Types

These **do not** trigger releases:
- `docs` - Documentation
- `test` - Tests
- `chore` - Maintenance
- `style` - Formatting
- `build` / `ci` - Build/CI changes

## Branches

- **master** → `v1.0.0` (npm tag: `latest`)
- **beta** → `v1.0.0-beta.1` (npm tag: `beta`)
- **alpha** → `v1.0.0-alpha.1` (npm tag: `alpha`)

## What Happens During Release

1. Runs tests (lint, unit, build, e2e)
2. Analyzes commits to determine version
3. Updates `package.json` and `CHANGELOG.md`
4. Creates git tag
5. Publishes to npm with OIDC provenance
6. Creates GitHub release
7. **Verifies published package** (post-publish validation)

If any step fails, the workflow fails. Post-publish verification runs after npm publish to ensure the published package works correctly.

## Examples

### Stable Release

```bash
git commit -m "fix: resolve toolbar positioning bug"
gh workflow run release.yml --ref master
```

Result: `v0.4.1-beta.5` → `v0.4.1`

### Beta Release

```bash
git commit -m "feat: add new drag handles"
gh workflow run release.yml --ref beta
```

Result: `v0.4.1` → `v0.5.0-beta.1`

### Preview Changes (Dry Run)

```bash
gh workflow run release.yml --ref beta -f dry_run=true
```

Shows what would be released without actually publishing.

## Troubleshooting

### No release created

**Cause:** No releasable commits since last release.

Only `docs`, `test`, or `chore` commits don't trigger releases. Add a `feat` or `fix` commit.

### Wrong version released

**Cause:** Incorrect commit type.

```bash
# Wrong (triggers minor bump)
fix: add new feature

# Correct
feat: add new feature
```

### Release failed

semantic-release has automatic rollback. If npm publish fails, no git tag is created.

To retry: Re-run the workflow after fixing the issue.

### Manual recovery

If a tag was created but publish failed:

```bash
git tag -d v1.0.0
git push --delete origin v1.0.0
# Re-run workflow
```

## Post-Publish Verification

After publishing to npm, the workflow automatically verifies the published package to catch potential issues:

### What Gets Verified

- **Installation**: Package installs without errors
- **Exports**: All entry points work (ESM, CommonJS, locales subpath)
- **Types**: TypeScript definitions are valid and accessible
- **Bin Script**: `migrate-from-editorjs` command is executable
- **Smoke Tests**: Editor can be instantiated (Node.js + browser)
- **Bundle Sizes**: Within expected ranges

### Verification Reports

After each release, a verification report is uploaded as a GitHub Actions artifact:
- Navigate to **Actions** → **Release** workflow run
- Download `package-verification-report` artifact
- Review `verification-report.json` for detailed results

### Local Verification

Test package verification before releasing:

```bash
# Test local build
yarn verify:package:local

# Test specific published version
yarn verify:package --version 1.0.0
```

### Verification Failure

If verification fails after publish:

1. **Unpublish** the broken version (if within 72 hours):
   ```bash
   npm unpublish @jackuait/blok@X.Y.Z
   ```

2. **Publish hotfix**: Fix the issue and trigger a new release

3. **Investigate**: Download the verification report artifact for details

## Configuration

**`.releaserc.json`** - semantic-release config
**`.github/workflows/release.yml`** - GitHub Actions workflow
**`scripts/verify-published-package.mjs`** - Verification script

## References

- [semantic-release docs](https://semantic-release.gitbook.io/)
- [Conventional Commits](https://www.conventionalcommits.org/)
- [npm provenance](https://docs.npmjs.com/generating-provenance-statements)
