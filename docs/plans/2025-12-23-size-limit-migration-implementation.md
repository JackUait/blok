# Size-Limit Migration Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace ~600 lines of custom bundle tracking scripts with size-limit.

**Architecture:** Install size-limit preset, configure three entry points (minimum/normal/maximum), create simple GitHub Action workflow, remove old scripts and workflows.

**Tech Stack:** @size-limit/preset-small-lib, GitHub Actions (andresz1/size-limit-action)

---

### Task 1: Install size-limit and measure baseline

**Files:**
- Modify: `package.json`

**Step 1: Install size-limit preset**

Run:
```bash
yarn add -D @size-limit/preset-small-lib
```

**Step 2: Add initial size-limit config to package.json**

Add to package.json (after "devDependencies"):
```json
"size-limit": [
  {
    "name": "Minimum (core only)",
    "path": "src/variants/blok-minimum.ts",
    "limit": "999 KB"
  },
  {
    "name": "Normal (with tools)",
    "path": "src/blok.ts",
    "limit": "999 KB"
  },
  {
    "name": "Maximum (all locales)",
    "path": "src/variants/blok-maximum.ts",
    "limit": "999 KB"
  }
]
```

**Step 3: Add size scripts to package.json**

Add to "scripts":
```json
"size": "size-limit",
"size:why": "size-limit --why"
```

**Step 4: Run size-limit to measure actual sizes**

Run:
```bash
yarn size
```

Record the actual gzip sizes for each entry point.

**Step 5: Update limits with real values + 10% buffer**

Update the "limit" values in package.json with the measured sizes plus ~10% buffer (round to nice numbers).

**Step 6: Verify size-limit passes**

Run:
```bash
yarn size
```

Expected: All checks pass (green).

**Step 7: Commit**

```bash
git add package.json yarn.lock
git commit -m "feat: add size-limit for bundle size tracking"
```

---

### Task 2: Create size-limit GitHub Action workflow

**Files:**
- Create: `.github/workflows/size-limit.yml`

**Step 1: Create the workflow file**

Create `.github/workflows/size-limit.yml`:
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
    name: Check Bundle Size
    runs-on: ubuntu-latest
    timeout-minutes: 10
    steps:
      - name: Checkout code
        uses: actions/checkout@v4

      - name: Setup Node.js and Dependencies
        uses: ./.github/actions/setup-node-deps

      - name: Check bundle size
        uses: andresz1/size-limit-action@v1
        with:
          github_token: ${{ secrets.GITHUB_TOKEN }}
```

**Step 2: Commit**

```bash
git add .github/workflows/size-limit.yml
git commit -m "ci: add size-limit GitHub Action workflow"
```

---

### Task 3: Remove old bundle-size-check workflow

**Files:**
- Delete: `.github/workflows/bundle-size-check.yml`

**Step 1: Delete the file**

Run:
```bash
rm .github/workflows/bundle-size-check.yml
```

**Step 2: Commit**

```bash
git add -A
git commit -m "ci: remove old bundle-size-check workflow"
```

---

### Task 4: Remove track-bundle-size job from ci.yml

**Files:**
- Modify: `.github/workflows/ci.yml`

**Step 1: Remove the track-bundle-size job**

Delete lines 351-398 (the entire `track-bundle-size:` job) from `.github/workflows/ci.yml`.

**Step 2: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: remove track-bundle-size job from CI workflow"
```

---

### Task 5: Remove bundle size tracking from release.yml

**Files:**
- Modify: `.github/workflows/release.yml`

**Step 1: Remove bundle variant build step**

Delete lines 57-58:
```yaml
      - name: Build bundle variants
        run: node scripts/build-bundle-variants.mjs --verbose
```

**Step 2: Remove bundle size history download step**

Delete lines 67-76 (the `Download bundle size history from CI` step).

**Step 3: Remove bundle size report generation step**

Delete lines 78-91 (the `Generate bundle size report` step).

**Step 4: Remove bundle size report upload step**

Delete lines 93-98 (the `Upload bundle size report` step).

**Step 5: Commit**

```bash
git add .github/workflows/release.yml
git commit -m "ci: remove bundle size tracking from release workflow"
```

---

### Task 6: Delete custom bundle tracking scripts

**Files:**
- Delete: `scripts/track-bundle-size.mjs`
- Delete: `scripts/view-bundle-trends.mjs`
- Delete: `scripts/build-bundle-variants.mjs`
- Delete: `scripts/lib/bundle-utils.mjs`

**Step 1: Delete the scripts**

Run:
```bash
rm scripts/track-bundle-size.mjs
rm scripts/view-bundle-trends.mjs
rm scripts/build-bundle-variants.mjs
rm scripts/lib/bundle-utils.mjs
```

**Step 2: Check if lib directory is empty and remove if so**

Run:
```bash
rmdir scripts/lib 2>/dev/null || echo "lib dir not empty or already removed"
```

**Step 3: Commit**

```bash
git add -A
git commit -m "refactor: remove custom bundle tracking scripts"
```

---

### Task 7: Update bundle-size.mjs check to not use bundle-utils

**Files:**
- Modify: `scripts/verify-package/checks/bundle-size.mjs`

**Step 1: Replace import with inline formatBytes function**

Replace line 3:
```javascript
import { formatBytes } from '../../lib/bundle-utils.mjs';
```

With:
```javascript
/**
 * Format bytes to human readable string
 * @param {number} bytes
 * @returns {string}
 */
function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}
```

**Step 2: Remove the reference comment**

Delete lines 18-19:
```javascript
  // Bundle size reference values (informational, not enforced)
  // For trend-based tracking, see: scripts/track-bundle-size.mjs
```

Replace with:
```javascript
  // Bundle size reference values (informational, not enforced)
```

**Step 3: Commit**

```bash
git add scripts/verify-package/checks/bundle-size.mjs
git commit -m "refactor: inline formatBytes in bundle-size check"
```

---

### Task 8: Remove bundle scripts from package.json

**Files:**
- Modify: `package.json`

**Step 1: Remove old bundle scripts**

Remove these lines from "scripts":
```json
"bundle:track": "node scripts/track-bundle-size.mjs --verbose",
"bundle:variants": "node scripts/build-bundle-variants.mjs --verbose",
"bundle:trends": "node scripts/view-bundle-trends.mjs --trends",
"bundle:history": "node scripts/view-bundle-trends.mjs",
```

**Step 2: Commit**

```bash
git add package.json
git commit -m "chore: remove old bundle tracking scripts from package.json"
```

---

### Task 9: Update scripts/README.md

**Files:**
- Modify: `scripts/README.md`

**Step 1: Replace Bundle Size Tracking section**

Replace lines 5-47 (the entire "## Bundle Size Tracking" section) with:

```markdown
## Bundle Size Tracking

Bundle size is tracked using [size-limit](https://github.com/ai/size-limit).

**Usage:**
```bash
# Check current bundle sizes
yarn size

# Analyze what's contributing to size
yarn size:why
```

Configuration is in `package.json` under the `size-limit` key. Three tiers are tracked:
- **Minimum**: Core editor only (no bundled tools, no locales)
- **Normal**: Standard build (bundled tools + English locale)
- **Maximum**: All tools + all 68 locales bundled

On PRs, the size-limit GitHub Action compares bundle sizes against the base branch and posts a comment with the diff.
```

**Step 2: Update directory structure**

In the directory structure section (around line 175), remove these lines:
```
├── track-bundle-size.mjs              # Bundle size tracking
├── view-bundle-trends.mjs             # Historical trend viewer
```

And remove from the tree:
```
├── lib/
│   └── bundle-utils.mjs               # Bundle utilities
```

**Step 3: Remove bundle-related development section**

Remove lines 226-232 (the programmatic usage example):
```javascript
import { trackBundleSize } from './scripts/track-bundle-size.mjs';
import { loadHistory, displayTrends } from './scripts/view-bundle-trends.mjs';

// Use programmatically
await trackBundleSize();
const history = await loadHistory('.bundle-size-history.json');
```

**Step 4: Update troubleshooting section**

Remove the "No history file found" troubleshooting entry (lines 238-242).

**Step 5: Update CI/CD Integration section**

Replace the "Bundle size check" entry (around line 217) with:
```markdown
- **Size limit check** ([`.github/workflows/size-limit.yml`](../.github/workflows/size-limit.yml))
  - Runs on PRs
  - Compares bundle sizes with base branch
  - Posts comparison as PR comment
```

**Step 6: Commit**

```bash
git add scripts/README.md
git commit -m "docs: update scripts README for size-limit migration"
```

---

### Task 10: Clean up generated files

**Files:**
- Delete: `.bundle-size-history.json`
- Delete: `.bundle-variants.json` (if exists)
- Modify: `.gitignore`

**Step 1: Delete generated files**

Run:
```bash
rm -f .bundle-size-history.json .bundle-variants.json
```

**Step 2: Remove from .gitignore if present**

Check if these are in .gitignore and remove if so:
```bash
grep -n "bundle-size-history\|bundle-variants" .gitignore || echo "Not in gitignore"
```

**Step 3: Commit**

```bash
git add -A
git commit -m "chore: remove old bundle size tracking artifacts"
```

---

### Task 11: Final verification

**Step 1: Run size-limit to verify it works**

Run:
```bash
yarn size
```

Expected: All three tiers pass.

**Step 2: Run lint to verify no broken imports**

Run:
```bash
yarn lint
```

Expected: No errors.

**Step 3: Run package verification to ensure bundle-size check still works**

Run:
```bash
yarn build && npm pack && node scripts/verify-published-package.mjs --local --skip-browser
```

Expected: All checks pass including "Bundle sizes".

**Step 4: Summarize changes**

The migration is complete. Summary:
- Deleted: ~600 lines of custom scripts
- Added: ~20 lines of config in package.json + ~20 line workflow
- New commands: `yarn size`, `yarn size:why`
- PR comments now come from size-limit-action instead of custom script
