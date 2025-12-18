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
2. **Pre-release verification** (staging environment - tests package before publishing)
3. Analyzes commits to determine version
4. Updates `package.json` and `CHANGELOG.md`
5. Creates git tag
6. Publishes to npm with OIDC provenance
7. Creates GitHub release
8. **Post-publish verification** (final safety check)

If any step fails, the workflow fails and publishing is aborted. The pre-release verification stage creates a local tarball and tests it in a clean environment before publishing to npm.

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

## Version Protection

To prevent manual version bumps that could break semantic-release, the project has **automated version verification**:

### CI Check

Every pull request and push to master runs a version check:
- Compares `package.json` version with the latest git tag
- Fails if a manual version bump is detected
- Allows version bumps only in semantic-release commits

### Pre-Commit Hook

A Husky pre-commit hook prevents accidental manual version changes:
```bash
# Automatically runs before every commit
node scripts/verify-version.mjs
```

### Manual Verification

Check version integrity manually:
```bash
yarn verify:version
```

### Why This Matters

Manual version bumps can cause:
- **Skipped releases** - If version is ahead of the last tag
- **Duplicate releases** - If version is behind
- **Broken changelog** - semantic-release loses track of history

**Always let semantic-release handle versioning.**

If you need a specific version, use commit message conventions to trigger the correct bump type.

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

### Version verification failed

**Cause:** Manual version change detected in `package.json`.

**Fix:**
```bash
# Check what version should be
yarn verify:version

# Revert to the correct version
git checkout HEAD -- package.json

# Or manually edit package.json to match the latest git tag
```

**Prevention:** The pre-commit hook should catch this before commit. If it didn't run, ensure Husky is installed:
```bash
yarn prepare
```

### Manual recovery

If a tag was created but publish failed:

```bash
git tag -d v1.0.0
git push --delete origin v1.0.0
# Re-run workflow
```

## Package Verification (Pre-Release + Post-Publish)

The release workflow includes **two verification stages** to ensure package quality:

### 1. Pre-Release Verification (Staging)

**Before** publishing to npm, the workflow:
1. Creates a local package tarball (`npm pack`)
2. Installs it in a clean test environment
3. Runs all verification checks against the local build

This catches issues **before** they reach npm users, such as:
- Missing files in `package.json` "files" array
- Incorrect exports configuration
- Bundler-specific issues (Webpack, Rollup, Vite)
- TypeScript definition problems
- Broken bin scripts

If pre-release verification fails, the workflow stops and **nothing is published**.

### 2. Post-Publish Verification (Safety Net)

After publishing to npm, the workflow:
1. Waits for npm registry propagation (120 seconds)
2. Installs the published package from npm
3. Re-runs all verification checks

This final safety check ensures the npm package is correctly published and accessible.

### What Gets Verified

Both stages verify:
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

Test package verification locally before releasing:

```bash
# Test local build (pre-release simulation)
npm pack
yarn verify:package:local

# Test specific published version
yarn verify:package --version 1.0.0

# Debug mode (keeps temp directory)
node scripts/verify-published-package.mjs --local --debug
```

This simulates the pre-release verification stage and helps catch issues early.

### Verification Failure

**Pre-Release Failure (Best Case)**

If pre-release verification fails:
1. The workflow stops before publishing to npm
2. No broken package reaches users
3. Fix the issue locally and re-run the workflow

**Post-Publish Failure (Rare)**

If post-publish verification fails (npm registry issue, network problem):
1. **Unpublish** the broken version (if within 72 hours):
   ```bash
   npm unpublish @jackuait/blok@X.Y.Z
   ```

2. **Publish hotfix**: Fix the issue and trigger a new release

3. **Investigate**: Download the verification report artifact for details

The two-stage verification approach minimizes the risk of broken packages reaching npm.

## Configuration

**`.releaserc.json`** - semantic-release config
**`.github/workflows/release.yml`** - GitHub Actions workflow
**`scripts/verify-published-package.mjs`** - Verification script

## References

- [semantic-release docs](https://semantic-release.gitbook.io/)
- [Conventional Commits](https://www.conventionalcommits.org/)
- [npm provenance](https://docs.npmjs.com/generating-provenance-statements)
